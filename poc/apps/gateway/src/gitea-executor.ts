import { ProviderOperationUnavailableError } from "./errors.ts";
import type { GiteaClient } from "./gitea-client.ts";
import type {
  ExecutionPort,
  GiteaCreateBranchExecutionResult,
  GiteaReadFileExecutionResult,
  PreparedRequestRecord
} from "./types.ts";

const MAIN_BRANCH = "main";
const FEATURE_BRANCH = "feature/account-suspension";

export class GiteaExecutor implements ExecutionPort {
  readonly provider = "gitea" as const;
  readonly #client: GiteaClient;

  constructor(client: GiteaClient) {
    this.#client = client;
  }

  async execute(
    record: PreparedRequestRecord
  ): Promise<GiteaReadFileExecutionResult | GiteaCreateBranchExecutionResult> {
    if (record.request.tool === "read_file") {
      const snapshot = await this.#client.readTextFile(
        record.request.arguments.branch,
        record.request.arguments.path
      );

      return {
        provider: "gitea",
        performed: true,
        tool: "read_file",
        ...snapshot
      };
    }

    if (record.request.tool === "create_branch") {
      const { base_branch, branch } = record.request.arguments;
      if (base_branch !== MAIN_BRANCH || branch !== FEATURE_BRANCH) {
        throw new ProviderOperationUnavailableError(
          "Phase 5B.1 Gitea provider only creates feature/account-suspension from main"
        );
      }

      const created = await this.#client.createBranch(base_branch, branch);
      return {
        provider: "gitea",
        performed: true,
        tool: "create_branch",
        branch: created.name,
        base_branch: created.base_branch,
        revision: created.commit_sha,
        commit_sha: created.commit_sha
      };
    }

    throw new ProviderOperationUnavailableError(
      `${record.request.tool} is not enabled in Phase 5B.1 Gitea provider mode`
    );
  }
}
