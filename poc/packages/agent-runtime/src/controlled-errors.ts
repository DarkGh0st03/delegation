export type ControlledToolErrorKind =
  | "authorization_denied"
  | "tests_failed"
  | "tool_unavailable"
  | "invalid_tool_call"
  | "iteration_limit";

export class ControlledToolError extends Error {
  readonly kind: ControlledToolErrorKind;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(
    kind: ControlledToolErrorKind,
    message: string,
    options: { statusCode?: number; details?: unknown } = {}
  ) {
    super(message);
    this.name = "ControlledToolError";
    this.kind = kind;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

export function controlledToolErrorPayload(error: unknown): {
  ok: false;
  error: {
    kind: ControlledToolErrorKind;
    message: string;
    details?: unknown;
  };
} {
  if (error instanceof ControlledToolError) {
    return {
      ok: false,
      error: {
        kind: error.kind,
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
