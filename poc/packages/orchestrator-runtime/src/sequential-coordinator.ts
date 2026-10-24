import type { SpecializedAgentRole } from "@thesis/agent-runtime";
import type {
  DelegatedA2ARoleTaskInput,
  DelegatedA2ARoleTaskResult
} from "./a2a-workflow.ts";
// Account Suspension's fixed branch and PR result contracts live in
// the explicitly historical Gateway writer, never the trusted read client.
import type {
  OrchestratorCreateBranchResult,
  OrchestratorCreatePullRequestResult
} from "./legacy-orchestrator-gateway-client.ts";
import {
  AccountSuspensionWorkflow,
  type AccountSuspensionWorkflowSnapshot
} from "./workflow.ts";

export interface SequentialGatewayPort {
  createFeatureBranch(
    taskId: string
  ): Promise<OrchestratorCreateBranchResult>;
  createAccountSuspensionPullRequest(
    taskId: string
  ): Promise<OrchestratorCreatePullRequestResult>;
}

export interface SequentialRoleRunnerPort {
  issueAndRun(
    input: DelegatedA2ARoleTaskInput
  ): Promise<DelegatedA2ARoleTaskResult>;
}

export interface AccountSuspensionSequentialCoordinatorConfig {
  gateway: SequentialGatewayPort;
  roleRunner: SequentialRoleRunnerPort;
  rootCredentialId: string;
  agentBaseUrls: Record<SpecializedAgentRole, string>;
  statusListCredential: string;
  childValiditySeconds?: number;
  now?: () => Date;
}

export interface AccountSuspensionSequentialRunResult {
  workflow: AccountSuspensionWorkflowSnapshot;
  branch: OrchestratorCreateBranchResult;
  delegated_tasks: Record<
    SpecializedAgentRole,
    DelegatedA2ARoleTaskResult
  >;
  pull_request: OrchestratorCreatePullRequestResult;
}

const ROLE_ORDER = ["backend", "frontend", "test"] as const;

/**
 * Functional, cross-role acceptance contract; NOT generated source code.
 * Keeping one shared API vocabulary prevents independent agent roles from
 * implementing incompatible endpoints such as /unsuspend vs /reactivate.
 * Delegation Credentials and path permissions remain completely unchanged.
 */
export const ACCOUNT_SUSPENSION_INTERFACE_CONTRACT = [
  "Account states must be ACTIVE and SUSPENDED.",
  "The administrator suspends an account with POST /api/users/:id/suspend",
  "and reactivates it with POST /api/users/:id/reactivate.",
  "Both endpoints return the updated UserDetails after success,",
  "preserve profile fields, enforce existing administrator authorization,",
  "and reject repeated transitions with HTTP 409.",
  "The UI must show accessible actions named Suspend account when ACTIVE",
  "and Reactivate account when SUSPENDED; disable each action while pending."
].join(" ");

export const ACCOUNT_SUSPENSION_TASK_PLAN = Object.freeze({
  backend: Object.freeze({
    subtask_id: "account-suspension-backend",
    instruction:
      "Implement the backend Account Suspension lifecycle and shared status contract. " +
      ACCOUNT_SUSPENSION_INTERFACE_CONTRACT,
    relevant_paths: Object.freeze([
      "packages/shared/src/account-status.ts",
      "apps/backend/src/users/user.service.ts",
      "apps/backend/src/users/user.controller.ts",
      "apps/backend/src/users/user.routes.ts"
    ])
  }),
  frontend: Object.freeze({
    subtask_id: "account-suspension-frontend",
    instruction:
      "Integrate Account Suspension into the administrative user interface after the Backend task completes. " +
      "Use the existing shared UserDetails contract and the SAME API routes implemented by Backend. " +
      ACCOUNT_SUSPENSION_INTERFACE_CONTRACT,
    relevant_paths: Object.freeze([
      "packages/shared/src/account-status.ts",
      "packages/shared/src/user-contracts.ts",
      "apps/frontend/src/api/users-api.ts",
      "apps/frontend/src/pages/UserDetailPage.tsx",
      "apps/frontend/src/styles.css"
    ])
  }),
  test: Object.freeze({
    subtask_id: "account-suspension-test",
    instruction:
      "Validate Account Suspension and invoke the controlled exact-SHA test gate after Backend and Frontend complete. " +
      "Write tests for the shared API and UI interface contract, including 409 duplicate transitions. " +
      "If the controlled Runner reports any failure, do not claim success or fabricate acceptance. " +
      ACCOUNT_SUSPENSION_INTERFACE_CONTRACT,
    relevant_paths: Object.freeze([
      "tests/backend/user.service.test.ts",
      "tests/backend/user.routes.test.ts",
      "tests/frontend/UserDetailPage.test.tsx",
      "tests/e2e/account-suspension.spec.ts"
    ])
  })
} as const);

const STATUS_INDEX_BY_ROLE: Record<SpecializedAgentRole, string> = {
  backend: "9601",
  frontend: "9602",
  test: "9603"
};

function nonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

export class AccountSuspensionSequentialCoordinator {
  readonly #gateway: SequentialGatewayPort;
  readonly #roleRunner: SequentialRoleRunnerPort;
  readonly #rootCredentialId: string;
  readonly #agentBaseUrls: Record<SpecializedAgentRole, string>;
  readonly #statusListCredential: string;
  readonly #childValiditySeconds: number;
  readonly #now: () => Date;

  constructor(config: AccountSuspensionSequentialCoordinatorConfig) {
    this.#gateway = config.gateway;
    this.#roleRunner = config.roleRunner;
    this.#rootCredentialId = nonEmpty(
      config.rootCredentialId,
      "Root credential id"
    );
    this.#statusListCredential = nonEmpty(
      config.statusListCredential,
      "Status List credential"
    );
    this.#childValiditySeconds = positiveInteger(
      config.childValiditySeconds ?? 1800,
      "Child validity seconds"
    );
    this.#now = config.now ?? (() => new Date());
    this.#agentBaseUrls = {
      backend: nonEmpty(
        config.agentBaseUrls.backend,
        "Backend Agent base URL"
      ),
      frontend: nonEmpty(
        config.agentBaseUrls.frontend,
        "Frontend Agent base URL"
      ),
      test: nonEmpty(
        config.agentBaseUrls.test,
        "Test Agent base URL"
      )
    };
  }

  async run(): Promise<AccountSuspensionSequentialRunResult> {
    const workflow = new AccountSuspensionWorkflow();
    const delegatedTasks = {} as Record<
      SpecializedAgentRole,
      DelegatedA2ARoleTaskResult
    >;

    try {
      const branch = await this.#gateway.createFeatureBranch(
        "account-suspension-create-branch"
      );
      workflow.markBranchReady(branch.revision);

      for (const role of ROLE_ORDER) {
        const plan = ACCOUNT_SUSPENSION_TASK_PLAN[role];
        const taskResult = await this.#roleRunner.issueAndRun({
          role,
          parent_credential_id: this.#rootCredentialId,
          credential_id: `urn:thesis:dc:account-suspension:${role}`,
          valid_from: this.#now().toISOString(),
          validity_seconds: this.#childValiditySeconds,
          credential_status: {
            type: "BitstringStatusListEntry",
            statusPurpose: "revocation",
            statusListIndex: STATUS_INDEX_BY_ROLE[role],
            statusListCredential: this.#statusListCredential
          },
          agent_base_url: this.#agentBaseUrls[role],
          subtask: {
            subtask_id: plan.subtask_id,
            instruction: plan.instruction,
            branch: "feature/account-suspension",
            relevant_paths: [...plan.relevant_paths]
          }
        });

        delegatedTasks[role] = taskResult;
        workflow.recordCompletedTask(taskResult.artifact);
      }

      if (workflow.state !== "test_completed") {
        throw new Error(
          "Pull Request gate requires a completed Test task"
        );
      }

      const pullRequest =
        await this.#gateway.createAccountSuspensionPullRequest(
          "account-suspension-create-pr"
        );

      workflow.markPullRequestCreated({
        number: pullRequest.pull_request_number,
        head_revision: pullRequest.revision
      });

      return {
        workflow: workflow.snapshot(),
        branch,
        delegated_tasks: delegatedTasks,
        pull_request: pullRequest
      };
    } catch (error) {
      if (
        workflow.state !== "failed" &&
        workflow.state !== "pr_created"
      ) {
        workflow.fail(
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    }
  }
}
