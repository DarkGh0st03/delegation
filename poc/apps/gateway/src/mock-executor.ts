import type {
  ExecutionPort,
  MockExecutionResult,
  PreparedRequestRecord
} from "./types.ts";

export class MockExecutor implements ExecutionPort {
  readonly provider = "mock" as const;
  callCount = 0;

  async execute(record: PreparedRequestRecord): Promise<MockExecutionResult> {
    this.callCount += 1;
    return {
      provider: "mock",
      performed: false,
      tool: record.request.tool,
      request_fingerprint: record.request_fingerprint
    };
  }
}
