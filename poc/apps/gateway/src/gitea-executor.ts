import { ProviderOperationUnavailableError } from "./errors.ts";
import type { GiteaClient } from "./gitea-client.ts";
import type { RunnerClient } from "./runner-client.ts";
import type {
  ExecutionPort,
  ExecutionResult,
  GiteaCreateBranchExecutionResult,
  GiteaCreateFileExecutionResult,
  GiteaCreatePullRequestExecutionResult,
  GiteaReadFileExecutionResult,
  GiteaUpdateFileExecutionResult,
  PreparedRequestRecord,
  RunnerExecutionResult
} from "./types.ts";

const MAIN_BRANCH = "main";
const FEATURE_BRANCH = "feature/account-suspension";

function commitMessage(
  tool: "create_file" | "update_file",
  path: string,
  requestId: string
): string {
  return `thesis-gateway: ${tool} ${path} [${requestId}]`;
}

function requireFeatureBranch(branch: string): void {
  if (branch !== FEATURE_BRANCH) {
    throw new ProviderOperationUnavailableError(
      "Phase 5B.2 Gitea file mutations are restricted to feature/account-suspension"
    );
  }
}

export class GiteaExecutor implements ExecutionPort {
  readonly provider = "gitea" as const;
  readonly #client: GiteaClient;
  readonly #runnerClient?: RunnerClient;
  readonly #runnerRepositoryUri?: string;

  constructor(
    client: GiteaClient,
    runnerClient?: RunnerClient,
    runnerRepositoryUri?: string
  ) {
    this.#client = client;
    this.#runnerClient = runnerClient;
    this.#runnerRepositoryUri = runnerRepositoryUri;
  }

  providerFor(record: PreparedRequestRecord): "gitea" | "runner" {
    return record.request.tool === "run_tests" ? "runner" : "gitea";
  }

  async execute(record: PreparedRequestRecord): Promise<ExecutionResult> {
    if (record.request.tool === "read_file") {
      const snapshot = await this.#client.readTextFile(
        record.request.arguments.branch,
        record.request.arguments.path
      );

      const result: GiteaReadFileExecutionResult = {
        provider: "gitea",
        performed: true,
        tool: "read_file",
        ...snapshot
      };
      return result;
    }

    if (record.request.tool === "create_branch") {
      const { base_branch, branch } = record.request.arguments;
      if (base_branch !== MAIN_BRANCH || branch !== FEATURE_BRANCH) {
        throw new ProviderOperationUnavailableError(
          "Phase 5B.1 Gitea provider only creates feature/account-suspension from main"
        );
      }

      const created = await this.#client.createBranch(base_branch, branch);
      const result: GiteaCreateBranchExecutionResult = {
        provider: "gitea",
        performed: true,
        tool: "create_branch",
        branch: created.name,
        base_branch: created.base_branch,
        revision: created.commit_sha,
        commit_sha: created.commit_sha
      };
      return result;
    }

    if (record.request.tool === "create_pull_request") {
      const { head_branch, base_branch, title, body } = record.request.arguments;
      if (head_branch !== FEATURE_BRANCH || base_branch !== MAIN_BRANCH) {
        throw new ProviderOperationUnavailableError(
          "Phase 5B.3 Gitea provider only creates feature/account-suspension -> main pull requests"
        );
      }

      const created = await this.#client.createPullRequest(
        head_branch,
        base_branch,
        title,
        body
      );
      const result: GiteaCreatePullRequestExecutionResult = {
        provider: "gitea",
        performed: true,
        tool: "create_pull_request",
        pull_request_id: created.id,
        pull_request_number: created.number,
        ...(created.url === undefined ? {} : { url: created.url }),
        head_branch: created.head_branch,
        base_branch: created.base_branch,
        revision: created.head_revision
      };
      return result;
    }

    if (record.request.tool === "create_file") {
      const { branch, path, content } = record.request.arguments;
      requireFeatureBranch(branch);
      const created = await this.#client.createFile(
        branch,
        path,
        content,
        commitMessage("create_file", path, record.request_id)
      );
      const result: GiteaCreateFileExecutionResult = {
        provider: "gitea",
        performed: true,
        tool: "create_file",
        branch: created.branch,
        path: created.path,
        revision: created.revision,
        commit_sha: created.commit_sha,
        blob_sha: created.blob_sha
      };
      return result;
    }

    if (record.request.tool === "update_file") {
      const { branch, path, content } = record.request.arguments;
      requireFeatureBranch(branch);
      const updated = await this.#client.updateFile(
        branch,
        path,
        content,
        commitMessage("update_file", path, record.request_id)
      );
      if (!updated.precondition_blob_sha) {
        throw new Error("Gitea update result is missing its blob precondition");
      }
      const result: GiteaUpdateFileExecutionResult = {
        provider: "gitea",
        performed: true,
        tool: "update_file",
        branch: updated.branch,
        path: updated.path,
        revision: updated.revision,
        commit_sha: updated.commit_sha,
        blob_sha: updated.blob_sha,
        precondition_blob_sha: updated.precondition_blob_sha
      };
      return result;
    }

    if (record.request.tool === "run_tests") {
      const { branch, profile } = record.request.arguments;
      requireFeatureBranch(branch);
      if (!this.#runnerClient || !this.#runnerRepositoryUri) {
        throw new ProviderOperationUnavailableError(
          "Controlled Test Runner is not configured"
        );
      }

      const branchMetadata = await this.#client.getBranchMetadata(branch);
      const run = await this.#runnerClient.run({
        request_id: record.request_id,
        repository: this.#runnerRepositoryUri,
        branch,
        commit_sha: branchMetadata.commit_sha,
        profile
      });

      const result: RunnerExecutionResult = {
        provider: "runner",
        performed: true,
        tool: "run_tests",
        branch,
        revision: run.tested_commit_sha,
        tested_commit_sha: run.tested_commit_sha,
        runner_profile: run.runner_profile,
        status: run.status,
        phases: run.phases,
        ...(run.project_tests === undefined
          ? {}
          : { project_tests: run.project_tests }),
        ...(run.researcher_acceptance === undefined
          ? {}
          : { researcher_acceptance: run.researcher_acceptance }),
        ...(run.log_reference === undefined
          ? {}
          : { log_reference: run.log_reference })
      };
      return result;
    }

    throw new ProviderOperationUnavailableError(
      `${record.request.tool} is not enabled in the current Phase 5B.3 Gitea provider mode`
    );
  }
}
