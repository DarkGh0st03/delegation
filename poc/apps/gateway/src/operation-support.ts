import { isRustOperation, type Operation } from "./operation-catalog.ts";
import { TOOL_NAMES, type ToolName } from "./types.ts";

/**
 * Rust recognizes all 31 operations, but only this smaller explicitly
 * implemented subset has a Gateway argument schema and execution adapter.
 * Provider support and authorization are still separate later checks.
 */
export type OperationSupport = "unknown" | "unavailable" | "supported";

export function classifyGatewayOperation(value: unknown): OperationSupport {
  if (!isRustOperation(value)) return "unknown";
  return (TOOL_NAMES as readonly string[]).includes(value)
    ? "supported"
    : "unavailable";
}

export function gatewaySupportsOperation(value: Operation): value is ToolName {
  return classifyGatewayOperation(value) === "supported";
}
