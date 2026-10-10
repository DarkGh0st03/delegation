import { FunctionTool, LlmAgent, type BaseLlm, type LlmAgentConfig } from "@google/adk";
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
  /** Model-facing hints only for the explicit live Backend probe; never security authority. */
  scopeModelPaths?: boolean;
  role: SpecializedAgentRole;
  model: BaseLlm;
  gatewayClient: GatewayControlledToolClient;
}

export interface AdkSpecializedAgent {
  profile: SpecializedAgentProfile;
  registry: ControlledToolRegistry;
  agent: LlmAgent;
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
  if (config.scopeModelPaths && config.role !== "backend") {
    throw new Error("Model path scoping is enabled only for the live Backend role");
  }
  // The model sees exactly the role's known paths. These enums are navigation
  // hints; the authoritative decision remains with the Gateway/Verifier/OPA.
  const readablePaths = [...new Set([...profile.writable_paths, ...profile.read_only_paths])];
  const modelPathEnum = (paths: readonly string[]) => {
    if (paths.length === 0) throw new Error("Scoped model tool needs nonempty paths");
    return z.enum(paths as [string, ...string[]]);
  };

  const registry = new ControlledToolRegistry(config.gatewayClient, profile.tools);
  const tools = registry.modelTools.map((definition) => {
    const name = definition.name as SpecializedToolName;
    const parameters = config.scopeModelPaths && name === "read_file"
      ? SCHEMAS.read_file.extend({path: modelPathEnum(readablePaths)})
      : config.scopeModelPaths && name === "update_file"
        ? SCHEMAS.update_file.extend({path: modelPathEnum(profile.writable_paths)})
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

  const agent = new LlmAgent({
    name: `account_suspension_${config.role}`,
    description: profile.skill,
    model: config.model,
    instruction: profile.system_prompt,
    tools,
    // Opt in only for the explicitly configured live Gemini Backend.
    ...(config.generateContentConfig
      ? {generateContentConfig: config.generateContentConfig} : {}),
    disallowTransferToParent: true,
    disallowTransferToPeers: true
  });
  return { profile, registry, agent };
}
