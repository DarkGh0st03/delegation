import { FunctionTool, LlmAgent, type BaseLlm } from "@google/adk";
import { z } from "zod";
import type { SpecializedAgentRole } from "./contracts.ts";
import {
  ControlledToolError,
  controlledToolErrorPayload
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

export interface AdkSpecializedAgentConfig {
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

  const registry = new ControlledToolRegistry(config.gatewayClient, profile.tools);
  const tools = registry.modelTools.map((definition) => {
    const name = definition.name as SpecializedToolName;
    return new FunctionTool({
      name,
      description: definition.description,
      parameters: SCHEMAS[name],
      execute: async (args) => {
        try {
          const result = await registry.execute({
            call_id: "adk-controlled-tool",
            name,
            arguments: JSON.stringify(args)
          });
          return { ok: true, result };
        } catch (error) {
          // Return a controlled result to the model. Denials cannot bypass Gateway.
          if (error instanceof ControlledToolError) {
            return controlledToolErrorPayload(error);
          }
          // Fail closed on unexpected errors without leaking raw provider responses.
          return { ok: false, error: { kind: "provider_unavailable", message: "Controlled tool failed" } };
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
    disallowTransferToParent: true,
    disallowTransferToPeers: true
  });
  return { profile, registry, agent };
}
