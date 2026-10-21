import { ProviderOperationUnavailableError } from "./errors.ts";
import type { GiteaClient } from "./gitea-client.ts";
import type {
  ExecutionPort,
  ExecutionResult,
  PreparedRequestRecord
} from "./types.ts";

/** Read-only provider: no write operations can reach Gitea. */
export class GiteaReadOnlyExecutor implements ExecutionPort {
  readonly provider = "gitea" as const;
  readonly #client: GiteaClient;

  constructor(client: GiteaClient) {
    this.#client = client;
  }

  async execute(record: PreparedRequestRecord): Promise<ExecutionResult> {
    if (record.request.tool === "read_repository") {
      const snapshot = await this.#client.readRepository();
      return {
        provider:"gitea", performed:true, tool:"read_repository", ...snapshot
      };
    }
    if (record.request.tool === "list_directory") {
      const snapshot = await this.#client.listDirectory(
        record.request.arguments.branch,
        record.request.arguments.path
      );
      return {
        provider:"gitea", performed:true, tool:"list_directory", ...snapshot
      };
    }
    if (record.request.tool === "read_file") {
      const snapshot = await this.#client.readTextFile(
        record.request.arguments.branch,
        record.request.arguments.path
      );
      return {
        provider:"gitea", performed:true, tool:"read_file", ...snapshot
      };
    }
    throw new ProviderOperationUnavailableError(
      `${record.request.tool} is intentionally unavailable in read-only provider mode`
    );
  }
}
