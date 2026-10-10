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

const BRANCH = "feature/account-suspension";

function prompt(
  roleLabel: string,
  skill: string,
  writable: readonly string[],
  creatable: readonly string[],
  readOnly: readonly string[],
  canRunTests: boolean
): string {
  const sections = [
    `You are the ${roleLabel} in the Account Suspension thesis PoC.`,
    `Skill: ${skill}.`,
    `Work only on branch ${BRANCH}.`,
    "Use only the controlled tools exposed by the runtime.",
    "The following file lists describe the intended least-privilege workflow. They are guidance, not the security boundary; Delegation Credentials, the Gateway, verifier and OPA enforce authority.",
    "",
    "Writable existing files:",
    ...(writable.length === 0 ? ["- none"] : writable.map((path) => `- ${path}`)),
    "",
    "Creatable files:",
    ...(creatable.length === 0 ? ["- none"] : creatable.map((path) => `- ${path}`)),
    "",
    "Read-only context files:",
    ...(readOnly.length === 0 ? ["- none"] : readOnly.map((path) => `- ${path}`)),
    "",
    canRunTests
      ? "You may invoke the fixed run_tests profile after the test changes are ready."
      : "You do not have a test-execution tool in this role.",
    "Never attempt to bypass an authorization denial or write to files outside the assigned role.",
    "Efficiency and completion: the writable files relevant to your subtask are deliverables. Read those target files first and implement them; read-only context files are optional references, not a checklist.",
    "Never request a read_file or update_file path outside the explicitly listed readable/writable files. Do not guess new paths or explore the repository beyond this delegated scope.",
    "Once sufficient context is available, use update_file to implement the requested changes. Do not use all model turns reading optional references.",
    "A successful read_file returns the file content. Reuse that result; do not reread an unchanged file just to reconfirm it.",
    "The update_file tool REPLACES the entire target file; provide complete valid UTF-8 file content, not a unified diff, code fragment or patch.",
    "Prefer a small number of coherent authorized writes over endless reconnaissance. Verify tool responses and do not claim a commit unless update_file/create_file confirms it.",
    "If you cannot implement the task safely within your assigned paths, stop and report the limitation rather than guessing, bypassing permissions or fabricating success."
  ];

  return sections.join("\n");
}

const BACKEND_WRITABLE = [
  "packages/shared/src/account-status.ts",
  "apps/backend/src/users/user.service.ts",
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts"
] as const;

const BACKEND_READ_ONLY = [
  "apps/backend/src/users/user.model.ts",
  "apps/backend/src/users/user.repository.ts",
  "packages/shared/src/user-contracts.ts",
  "apps/backend/src/app.ts"
] as const;

const FRONTEND_WRITABLE = [
  "apps/frontend/src/api/users-api.ts",
  "apps/frontend/src/pages/UserDetailPage.tsx",
  "apps/frontend/src/styles.css"
] as const;

const FRONTEND_READ_ONLY = [
  "packages/shared/src/account-status.ts",
  "packages/shared/src/user-contracts.ts",
  "apps/frontend/src/components/UserStatusBadge.tsx"
] as const;

const TEST_WRITABLE = [
  "tests/backend/user.service.test.ts",
  "tests/backend/user.routes.test.ts",
  "tests/frontend/UserDetailPage.test.tsx"
] as const;

const TEST_CREATABLE = ["tests/e2e/account-suspension.spec.ts"] as const;

const TEST_READ_ONLY = [
  "tests/e2e/user-profile.spec.ts",
  "packages/shared/src/account-status.ts",
  "packages/shared/src/user-contracts.ts",
  "apps/backend/src/users/user.model.ts",
  "apps/backend/src/users/user.repository.ts",
  "apps/backend/src/users/user.service.ts",
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts",
  "apps/frontend/src/api/users-api.ts",
  "apps/frontend/src/pages/UserDetailPage.tsx",
  "apps/frontend/src/styles.css",
  "apps/frontend/src/components/UserStatusBadge.tsx"
] as const;

export const SPECIALIZED_AGENT_PROFILES: Readonly<
  Record<SpecializedAgentRole, SpecializedAgentProfile>
> = {
  backend: {
    role: "backend",
    skill: "Implement the backend Account Suspension lifecycle and shared status contract.",
    tools: ["read_file", "update_file"],
    writable_paths: BACKEND_WRITABLE,
    creatable_paths: [],
    read_only_paths: BACKEND_READ_ONLY,
    can_run_tests: false,
    system_prompt: prompt(
      "Backend Development Agent",
      "Implement the backend Account Suspension lifecycle and shared status contract.",
      BACKEND_WRITABLE,
      [],
      BACKEND_READ_ONLY,
      false
    )
  },
  frontend: {
    role: "frontend",
    skill: "Integrate Account Suspension into the administrative user interface.",
    tools: ["read_file", "update_file"],
    writable_paths: FRONTEND_WRITABLE,
    creatable_paths: [],
    read_only_paths: FRONTEND_READ_ONLY,
    can_run_tests: false,
    system_prompt: prompt(
      "Frontend Development Agent",
      "Integrate Account Suspension into the administrative user interface.",
      FRONTEND_WRITABLE,
      [],
      FRONTEND_READ_ONLY,
      false
    )
  },
  test: {
    role: "test",
    skill: "Validate Account Suspension without modifying application source.",
    tools: ["read_file", "update_file", "create_file", "run_tests"],
    writable_paths: TEST_WRITABLE,
    creatable_paths: TEST_CREATABLE,
    read_only_paths: TEST_READ_ONLY,
    can_run_tests: true,
    system_prompt: prompt(
      "Software Testing Agent",
      "Validate Account Suspension without modifying application source.",
      TEST_WRITABLE,
      TEST_CREATABLE,
      TEST_READ_ONLY,
      true
    )
  }
};

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
