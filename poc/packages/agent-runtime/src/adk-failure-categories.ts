/**
 * Static, non-sensitive labels for ADK/provider failures.
 * NEVER return or log raw provider response, error.message, arguments,
 * prompts, Delegation Credentials, authorization evidence or API tokens.
 */
export type AdkFailureCategory =
  | "model_turn_budget"
  | "api_rate_limit_or_quota"
  | "api_authentication"
  | "api_permission_denied"
  | "api_model_not_found"
  | "api_invalid_request"
  | "api_service_unavailable"
  | "api_inference_timeout"
  | "api_network_failure"
  | "tool_schema_or_validation"
  | "sdk_model_exception"
  | "adk_event_error";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Inspects errors internally but produces only predefined safe categories. */
export function classifyAdkFailure(
  error: unknown,
  fallback: AdkFailureCategory = "sdk_model_exception"
): AdkFailureCategory {
  const e = record(error);
  const status = typeof e.status === "number" ? e.status :
    typeof e.statusCode === "number" ? e.statusCode : undefined;
  if (status === 429) return "api_rate_limit_or_quota";
  if (status === 401) return "api_authentication";
  if (status === 403) return "api_permission_denied";
  if (status === 404) return "api_model_not_found";
  if (status === 400 || status === 422) return "api_invalid_request";
  if (typeof status === "number" && status >= 500) return "api_service_unavailable";
  const diagnostic = [
    typeof e.code === "string" ? e.code : "",
    typeof e.errorCode === "string" ? e.errorCode : "",
    typeof e.message === "string" ? e.message : "",
    typeof error === "string" ? error : ""
  ].join(" ").toLowerCase();
  if (/resource.exhausted|quota|rate.limit|too many requests|429/.test(diagnostic))
    return "api_rate_limit_or_quota";
  if (/api.key.invalid|unauthenticated|authentication|401|invalid.api.key/.test(diagnostic))
    return "api_authentication";
  if (/permission.denied|403|not authorized|forbidden/.test(diagnostic))
    return "api_permission_denied";
  if (/404|not.found|model.*not (?:found|available)|unsupported model/.test(diagnostic))
    return "api_model_not_found";
  if (/invalid.argument|invalid.request|bad.request|400|422/.test(diagnostic))
    return "api_invalid_request";
  if (/schema|function.call|validation|tool.args|zod/.test(diagnostic))
    return "tool_schema_or_validation";
  if (/service.unavailable|503|internal.server|500|502|504/.test(diagnostic))
    return "api_service_unavailable";
  if (/timed?out|econn|enotfound|network|socket|dns/.test(diagnostic))
    return "api_network_failure";
  return fallback;
}
