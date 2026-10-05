import type {
  RunnerExecutor,
  RunnerRunRequest,
  RunnerRunResult
} from "./types.ts";

export class RunnerExecutionUnavailableError extends Error {
  constructor(message = "Runner execution is not enabled until Phase 6B") {
    super(message);
    this.name = "RunnerExecutionUnavailableError";
  }
}

export class DisabledRunnerExecutor implements RunnerExecutor {
  async run(_request: RunnerRunRequest): Promise<RunnerRunResult> {
    throw new RunnerExecutionUnavailableError();
  }
}
