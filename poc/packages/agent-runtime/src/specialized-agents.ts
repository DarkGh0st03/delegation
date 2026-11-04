import type { SpecializedAgentRole } from "./contracts.ts";
import type { ModelClient } from "./llm-client.ts";
import { AgentController, type AgentRuntimeAuditSink } from "./agent-controller.ts";
import { ControlledToolRegistry } from "./tool-registry.ts";
import type { GatewayControlledToolClient, SpecializedToolName } from "./gateway-tool-client.ts";

export interface SpecializedAgentProfile {
  role: SpecializedAgentRole;
  skill: string;
  tools: readonly SpecializedToolName[];
  writable_paths: readonly string[];
  creatable_paths: readonly string[];
  read_only_paths: readonly string[];
  can_run_tests: boolean;
  system_prompt: string;
}

// Compatibility only for explicitly historical, unsigned fixture tests.
// Engineer-approved A2A Tasks use scenario-neutral approved role profiles.
import {LEGACY_ACCOUNT_SUSPENSION_PROFILES}
 from "./fixtures/account-suspension-agent-profiles.ts";

export const SPECIALIZED_AGENT_PROFILES:Readonly<
 Record<SpecializedAgentRole,SpecializedAgentProfile>
>=LEGACY_ACCOUNT_SUSPENSION_PROFILES;

export interface SpecializedAgentControllerConfig {
  role: SpecializedAgentRole;
  modelClient: ModelClient;
  gatewayClient: GatewayControlledToolClient;
  maxIterations?: number;
  audit?: AgentRuntimeAuditSink;
}

export function createSpecializedAgentController(
  config: SpecializedAgentControllerConfig
): {
  profile: SpecializedAgentProfile;
  registry: ControlledToolRegistry;
  controller: AgentController;
} {
  const profile = SPECIALIZED_AGENT_PROFILES[config.role];
  const registry = new ControlledToolRegistry(config.gatewayClient, profile.tools);
  const controller = new AgentController({
    modelClient: config.modelClient,
    toolRegistry: registry,
    instructions: profile.system_prompt,
    ...(config.maxIterations === undefined
      ? {}
      : { maxIterations: config.maxIterations }),
    ...(config.audit === undefined ? {} : { audit: config.audit })
  });

  return { profile, registry, controller };
}
