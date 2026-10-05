import { ProviderOperationUnavailableError } from "./errors.ts";
import type { GiteaClient } from "./gitea-client.ts";
import type {
  ExecutionPort,
  GiteaReadFileExecutionResult,
  PreparedRequestRecord
} from "./types.ts";

export class GiteaReadOnlyExecutor implements ExecutionPort {
  readonly provider = "gitea" as const;
  readonly #client: GiteaClient;

  constructor(client: GiteaClient) {
    this.#client = client;
  }

  async execute(record: PreparedRequestRecord): Promise<GiteaReadFileExecutionResult> {
    if (record.request.tool !== "read_file") {
      throw new ProviderOperationUnavailableError(
        `${record.request.tool} is intentionally unavailable in Phase 5A read-only provider mode`
      );
    }

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
}
