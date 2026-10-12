import { FunctionTool, LlmAgent, MCPToolset, type BaseLlm, type LlmAgentConfig, type StreamableHTTPConnectionParams } from "@google/adk";
import { normalizeMcpReadFileOutcome } from "./mcp-read-result.ts";
import { z } from "zod";
import type { SpecializedAgentRole } from "./contracts.ts";
import {
  ControlledToolError,
  controlledToolErrorPayload,
  type ControlledToolErrorKind
} from "./controlled-errors.ts";
import type { GatewayControlledToolClient, SpecializedToolName } from "./gateway-tool-client.ts";
import { SPECIALIZED_AGENT_PROFILES, type SpecializedAgentProfile } from "./specialized-agents.ts";
import { ControlledToolRegistry } from "./tool-registry.ts";

// These are only model-facing argument schemas. Gateway/Verifier/OPA remain authoritative.
// Strict schemas prevent ADK from silently stripping unknown fields (notably authority overrides).
const BRANCH = "feature/account-suspension";
const SCHEMAS = {
  read_file: z.object({
    branch: z.literal(BRANCH),
    path: z.string().min(1)
  }).strict(),
  update_file: z.object({
    branch: z.literal(BRANCH),
    path: z.string().min(1),
    content: z.string()
  }).strict(),
  create_file: z.object({
    branch: z.literal(BRANCH),
    path: z.string().min(1),
    content: z.string()
  }).strict(),
  run_tests: z.object({
    branch: z.literal(BRANCH),
    profile: z.literal("poc-default")
  }).strict()
} as const satisfies Record<SpecializedToolName, z.ZodObject<z.ZodRawShape>>;

export type AdkControlledToolOutcome = { name: SpecializedToolName; arguments: Record<string, unknown>; payload: {ok: true; result: unknown} | ReturnType<typeof controlledToolErrorPayload> }; 

/** Optional model generation parameters. Absent for every scripted baseline. */
/** Native ADK configuration. Keep output/temperature mandatory for our live probe. */
export type AdkGenerationConfig = NonNullable<LlmAgentConfig["generateContentConfig"]> & {
  maxOutputTokens: number;
  temperature: number;
};

export interface AdkSpecializedAgentConfig {
  onToolOutcome?: (outcome: AdkControlledToolOutcome) => void;
  signal?: AbortSignal;
  generateContentConfig?: AdkGenerationConfig;
  /** Model-facing enumerated path hints only; Gateway/OPA/DC remain authoritative. */
  scopeModelPaths?: boolean;
  role: SpecializedAgentRole;
  model: BaseLlm;
  gatewayClient: GatewayControlledToolClient;
  /** Only for the shared-MCP read_file spike. Credentials never enter model args. */
  mcpReadFile?: {
    endpoint: string;
    bearerForRequest: () => string;
  };
}

export interface AdkSpecializedAgent {
  profile: SpecializedAgentProfile;
  registry: ControlledToolRegistry;
  agent: LlmAgent;
  mcpToolset?: MCPToolset;
}

/**
 * Build a real Google ADK Agent, while retaining the already-tested Gateway wrapper.
 *
 * Only the profile's tool names are published to ADK. The client and its secret
 * Delegation Evidence Handler remain private closure state, never arguments,
 * prompt text, session state or tool results.
 *
 * A2A will invoke this factory in Phase 3; the existing A2A boundary is unchanged.
 */
export function createAdkSpecializedAgent(
  config: AdkSpecializedAgentConfig
): AdkSpecializedAgent {
  const profile = SPECIALIZED_AGENT_PROFILES[config.role];
  if (!profile) throw new Error("Unknown specialized agent role");
  // Path-scoped tool declarations are safe for every specialized role.
  // The model sees exactly the role's known paths. These enums are navigation
  // hints; the authoritative decision remains with the Gateway/Verifier/OPA.
  const readablePaths = [...new Set([...profile.writable_paths, ...profile.read_only_paths])];
  const modelPathEnum = (paths: readonly string[]) => {
    if (paths.length === 0) throw new Error("Scoped model tool needs nonempty paths");
    return z.enum(paths as [string, ...string[]]);
  };

  const registry = new ControlledToolRegistry(config.gatewayClient, profile.tools);
  const tools = registry.modelTools
    // MCP handles read_file only. All write/test FunctionTools stay unchanged.
    .filter(definition => !config.mcpReadFile || definition.name !== "read_file")
    .map((definition) => {
    const name = definition.name as SpecializedToolName;
    const parameters = config.scopeModelPaths && name === "read_file"
      ? SCHEMAS.read_file.extend({path: modelPathEnum(readablePaths)})
      : config.scopeModelPaths && name === "update_file"
        ? SCHEMAS.update_file.extend({path: modelPathEnum(profile.writable_paths)})
        : config.scopeModelPaths && name === "create_file"
          ? SCHEMAS.create_file.extend({path: modelPathEnum(profile.creatable_paths)})
          : SCHEMAS[name];
    return new FunctionTool({
      name,
      description: definition.description,
      parameters,
      execute: async (args) => {
        const started = performance.now();
        let success = false;
        let errorKind: ControlledToolErrorKind | null = null;
        try {
          config.signal?.throwIfAborted();
          const result = await registry.execute({
            call_id: "adk-controlled-tool",
            name,
            arguments: JSON.stringify(args)
          });
          config.signal?.throwIfAborted();
          const payload = { ok: true as const, result };
          success = true;
          config.onToolOutcome?.({ name, arguments: args as Record<string, unknown>, payload });
          return payload;
        } catch (error) {
          // Return a controlled result to the model. Denials cannot bypass Gateway.
          if (error instanceof ControlledToolError) {
            errorKind = error.kind;
            const payload = controlledToolErrorPayload(error);
            config.onToolOutcome?.({ name, arguments: args as Record<string, unknown>, payload });
            return payload;
          }
          // Fail closed on unexpected errors without leaking raw provider responses.
          errorKind = "tool_unavailable";
          const payload = controlledToolErrorPayload(new ControlledToolError("tool_unavailable", "Controlled tool failed"));
          config.onToolOutcome?.({ name, arguments: args as Record<string, unknown>, payload });
          return payload;
        } finally {
          // Fixed tool identifier, status and latency only: never log arguments,
          // file content, prompts, status-list tokens, DC or signed VP.
          process.stdout.write(JSON.stringify({
            event: "adk_tool_timing", role: config.role, tool: name,
            success, error_kind:errorKind,
            duration_ms: Math.round(performance.now() - started)
          }) + "\n");
        }
      }
    });
  });

  let mcpToolset: MCPToolset | undefined;
  if (config.mcpReadFile) {
    const endpoint = new URL(config.mcpReadFile.endpoint);
    if (endpoint.pathname !== "/mcp" || endpoint.search || endpoint.hash ||
        endpoint.username || endpoint.password ||
        !(endpoint.protocol === "https:" ||
          (endpoint.protocol === "http:" &&
           ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)))) {
      throw new Error("Shared MCP endpoint must be HTTPS or local-loopback HTTP /mcp");
    }
    // A fresh signed task bearer is fetched on EACH HTTP request.
    // It is not stored in ADK session or visible to Gemini.
    const authorizedFetch: typeof fetch = async (input, init) => {
      const requestedUrl = new URL(
        typeof input === "string" || input instanceof URL ? String(input) : input.url
      );
      if (requestedUrl.href !== endpoint.href) throw new Error("Unexpected shared MCP endpoint");
      const headers = new Headers(init?.headers);
      headers.set("authorization", "Bearer " + config.mcpReadFile!.bearerForRequest());
      return fetch(input, {...init, headers, redirect: "error"});
    };
    const params: StreamableHTTPConnectionParams = {
      type: "StreamableHTTPConnectionParams",
      url: endpoint.toString(),
      transportOptions: { fetch: authorizedFetch }
    };
    mcpToolset = new MCPToolset(params, ["read_file"]);
  }

  const agent = new LlmAgent({
    name: `account_suspension_${config.role}`,
    description: profile.skill,
    model: config.model,
    instruction: profile.system_prompt,
    tools: mcpToolset ? [...tools, mcpToolset] : tools,
    // Observe only the MCP read_file; existing FunctionTools already emit outcomes.
    ...(mcpToolset ? {afterToolCallback: ({tool, args, response}) => {
      if (tool.name === "read_file") {
        const payload = normalizeMcpReadFileOutcome(response, args);
        config.onToolOutcome?.({name: "read_file", arguments: args, payload});
      }
      return undefined;
    }} : {}),
    // Opt in only for the explicitly configured live Gemini Backend.
    ...(config.generateContentConfig
      ? {generateContentConfig: config.generateContentConfig} : {}),
    disallowTransferToParent: true,
    disallowTransferToPeers: true
  });
  return { profile, registry, agent, ...(mcpToolset ? {mcpToolset} : {}) };
}
