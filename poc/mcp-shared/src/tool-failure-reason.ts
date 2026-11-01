/** Diagnostic only: never changes authorization or retry eligibility. */
export const TOOL_FAILURE_REASONS = [
  "invalid_arguments", "branch_mismatch", "path_outside_signed_scope",
  "operation_not_granted", "gateway_prepare_rejected", "upstream_unavailable", "request_validation_rejected", "task_binding_rejected", "signed_permission_rejected", "dependency_rejected", "task_inactive_or_expired", "runtime_scope_rejected", "source_witness_missing", "gateway_prepare_unclassified"
] as const;
export type ToolFailureReason = typeof TOOL_FAILURE_REASONS[number];
export function safeToolFailureReason(value: unknown): ToolFailureReason | undefined {
  return typeof value === "string" &&
    (TOOL_FAILURE_REASONS as readonly string[]).includes(value)
    ? value as ToolFailureReason : undefined;
}
export function toolFailureReasonFields(value: unknown): {reason?: ToolFailureReason} {
  const reason = value && typeof value === "object"
    ? safeToolFailureReason((value as {reason?:unknown}).reason) : undefined;
  return reason ? {reason} : {};
}
