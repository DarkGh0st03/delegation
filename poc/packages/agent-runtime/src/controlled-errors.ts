import {safeToolFailureReason, toolFailureReasonFields, type ToolFailureReason} from "../../../mcp-shared/src/tool-failure-reason.ts";
export type ControlledToolErrorKind =
  | "authorization_denied"
  | "tests_failed"
  | "tool_unavailable"
  | "invalid_tool_call"
  | "iteration_limit"
  /** The proposed update equals the file read in this Task: nothing to write. */
  | "no_change";

export class ControlledToolError extends Error {
  readonly kind: ControlledToolErrorKind;
  readonly statusCode?: number;
  readonly details?: unknown;
  readonly reason?: ToolFailureReason;

  constructor(
    kind: ControlledToolErrorKind,
    message: string,
    options: { statusCode?: number; details?: unknown; reason?: ToolFailureReason } = {}
  ) {
    super(message);
    this.name = "ControlledToolError";
    this.kind = kind;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.reason = safeToolFailureReason(options.reason);
  }
}

export function controlledToolErrorPayload(error: unknown): {
  ok: false;
  error: {
    kind: ControlledToolErrorKind;
    message: string;
    details?: unknown;
    reason?: ToolFailureReason;
  };
} {
  if (error instanceof ControlledToolError) {
    return {
      ok: false,
      error: {
        kind: error.kind,
        ...toolFailureReasonFields(error),
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    };
  }

  return {
    ok: false,
    error: {
      kind: "tool_unavailable",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}
