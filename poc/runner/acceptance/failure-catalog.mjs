/** Fixed researcher-owned labels only. Diagnostic data never grants authority. */
export const ACCEPTANCE_CHECKS = Object.freeze([
  ["account-suspension.spec.ts", "researcher acceptance: administrator can suspend an ACTIVE account", "admin_suspend"],
  ["account-suspension.spec.ts", "researcher acceptance: administrator can reactivate a SUSPENDED account", "admin_reactivate"],
  ["account-suspension.spec.ts", "researcher acceptance: repeated state transitions are rejected", "duplicate_transitions"],
  ["account-suspension.spec.ts", "researcher acceptance: UI exposes the action matching account state", "ui_state_actions"],
  ["account-suspension.spec.ts", "researcher acceptance: suspend and reactivate actions cannot be double-submitted while pending", "ui_pending_actions"],
  ["backend-contract.spec.ts", "researcher backend contract: shared account status exposes both lifecycle states", "shared_lifecycle_states"],
  ["backend-contract.spec.ts", "researcher backend contract: transitions persist status and preserve email", "service_persistence"],
  ["backend-contract.spec.ts", "researcher backend contract: REST transitions require authentication and isolate unknown users", "rest_auth_isolation"]
].map(row => Object.freeze(row)));
export const ACCEPTANCE_FAILURE_PREFIX = "[researcher-acceptance] failure_summary ";
const ids = new Set(ACCEPTANCE_CHECKS.map(row => row[2]));

/** Reject unknown labels/fields; never forward assertion text, URLs or paths. */
export function safeAcceptanceFailureSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "failed_checks,timed_out,unclassified_failure" ||
      !Array.isArray(value.failed_checks) || value.failed_checks.length > ids.size ||
      value.failed_checks.some(id => typeof id !== "string" || !ids.has(id)) ||
      new Set(value.failed_checks).size !== value.failed_checks.length ||
      value.failed_checks.some((id, i) => i > 0 && value.failed_checks[i-1] >= id) ||
      typeof value.timed_out !== "boolean" || typeof value.unclassified_failure !== "boolean" ||
      (value.failed_checks.length === 0 && !value.timed_out && !value.unclassified_failure)) return null;
  return Object.freeze({failed_checks: Object.freeze([...value.failed_checks]),
    timed_out: value.timed_out, unclassified_failure: value.unclassified_failure});
}
