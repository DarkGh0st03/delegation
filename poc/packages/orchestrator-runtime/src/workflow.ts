import type {
  AgentArtifactPayload,
  SpecializedAgentRole
} from "@thesis/agent-runtime";
import {
  validateWorkflowArtifact,
  type ValidatedWorkflowArtifact
} from "./artifact-validation.ts";

export const ACCOUNT_SUSPENSION_REQUIREMENT =
  "Allow an administrator to suspend and reactivate a user account from the administration interface." as const;

export const ACCOUNT_SUSPENSION_BRANCH =
  "feature/account-suspension" as const;

export type AccountSuspensionWorkflowState =
  | "initialized"
  | "branch_ready"
  | "backend_completed"
  | "frontend_completed"
  | "test_completed"
  | "pr_created"
  | "failed";

export interface PullRequestCheckpoint {
  number: number;
  head_revision: string;
}

export interface AccountSuspensionWorkflowSnapshot {
  requirement: typeof ACCOUNT_SUSPENSION_REQUIREMENT;
  branch: typeof ACCOUNT_SUSPENSION_BRANCH;
  state: AccountSuspensionWorkflowState;
  current_revision: string | null;
  completed_roles: SpecializedAgentRole[];
  artifacts: Partial<Record<SpecializedAgentRole, ValidatedWorkflowArtifact>>;
  pull_request: PullRequestCheckpoint | null;
  failure_reason: string | null;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function requireCommitSha(value: string, label: string): string {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA`);
  }
  return value;
}

function cloneArtifact(
  artifact: ValidatedWorkflowArtifact
): ValidatedWorkflowArtifact {
  return {
    ...artifact,
    files_modified: [...artifact.files_modified],
    files_created: [...artifact.files_created],
    errors: [...artifact.errors]
  };
}

function expectedRoleForState(
  state: AccountSuspensionWorkflowState
): SpecializedAgentRole | null {
  if (state === "branch_ready") return "backend";
  if (state === "backend_completed") return "frontend";
  if (state === "frontend_completed") return "test";
  return null;
}

export class AccountSuspensionWorkflow {
  #state: AccountSuspensionWorkflowState = "initialized";
  #currentRevision: string | null = null;
  readonly #artifacts = new Map<
    SpecializedAgentRole,
    ValidatedWorkflowArtifact
  >();
  #pullRequest: PullRequestCheckpoint | null = null;
  #failureReason: string | null = null;

  get state(): AccountSuspensionWorkflowState {
    return this.#state;
  }

  get currentRevision(): string | null {
    return this.#currentRevision;
  }

  markBranchReady(revision: string): void {
    if (this.#state !== "initialized") {
      throw new Error(
        `Cannot mark branch ready from workflow state ${this.#state}`
      );
    }

    this.#currentRevision = requireCommitSha(
      revision,
      "Feature branch revision"
    );
    this.#state = "branch_ready";
  }

  recordCompletedTask(payload: AgentArtifactPayload | unknown): void {
    const expectedRole = expectedRoleForState(this.#state);
    if (expectedRole === null) {
      throw new Error(
        `Workflow state ${this.#state} does not accept a specialized Agent artifact`
      );
    }

    const artifact = validateWorkflowArtifact(payload, expectedRole, {
      requireTestPass: expectedRole === "test"
    });

    this.#artifacts.set(expectedRole, cloneArtifact(artifact));
    this.#currentRevision = artifact.revision;

    if (expectedRole === "backend") {
      this.#state = "backend_completed";
    } else if (expectedRole === "frontend") {
      this.#state = "frontend_completed";
    } else {
      this.#state = "test_completed";
    }
  }

  markPullRequestCreated(checkpoint: PullRequestCheckpoint): void {
    if (this.#state !== "test_completed") {
      throw new Error(
        `Cannot create Pull Request checkpoint from workflow state ${this.#state}`
      );
    }
    if (!Number.isSafeInteger(checkpoint.number) || checkpoint.number <= 0) {
      throw new Error("Pull Request number must be a positive safe integer");
    }

    const headRevision = requireCommitSha(
      checkpoint.head_revision,
      "Pull Request head revision"
    );
    if (headRevision !== this.#currentRevision) {
      throw new Error(
        "Pull Request head revision must match the tested workflow revision"
      );
    }

    this.#pullRequest = {
      number: checkpoint.number,
      head_revision: headRevision
    };
    this.#state = "pr_created";
  }

  fail(reason: string): void {
    if (this.#state === "pr_created" || this.#state === "failed") {
      throw new Error(
        `Cannot fail workflow from terminal state ${this.#state}`
      );
    }
    if (reason.trim().length === 0) {
      throw new Error("Workflow failure reason cannot be empty");
    }

    this.#failureReason = reason;
    this.#state = "failed";
  }

  snapshot(): AccountSuspensionWorkflowSnapshot {
    const artifacts: Partial<
      Record<SpecializedAgentRole, ValidatedWorkflowArtifact>
    > = {};
    for (const [role, artifact] of this.#artifacts.entries()) {
      artifacts[role] = cloneArtifact(artifact);
    }

    return {
      requirement: ACCOUNT_SUSPENSION_REQUIREMENT,
      branch: ACCOUNT_SUSPENSION_BRANCH,
      state: this.#state,
      current_revision: this.#currentRevision,
      completed_roles: ["backend", "frontend", "test"].filter((role) =>
        this.#artifacts.has(role as SpecializedAgentRole)
      ) as SpecializedAgentRole[],
      artifacts,
      pull_request:
        this.#pullRequest === null ? null : { ...this.#pullRequest },
      failure_reason: this.#failureReason
    };
  }
}
