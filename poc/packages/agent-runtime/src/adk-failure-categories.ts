/**
 * Static, non-sensitive labels for ADK/provider failures.
 * Inspect untrusted errors locally; NEVER log raw errors, messages, model
 * output, file content, credentials, Delegation Evidence, or API keys.
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

export type AdkFailureSource =
  | "http_status"
  | "error_code"
  | "message_pattern"
  | "runtime_timeout"
  | "fallback";

export type AdkSafeErrorType =
  | "api_error" | "abort_error" | "timeout_error"
  | "type_error" | "network_error" | "generic_error" | "other";

export interface AdkSafeFailureDiagnostic {
  category: AdkFailureCategory;
  http_status: number | null;
  classification_source: AdkFailureSource;
  error_type: AdkSafeErrorType;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function validHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= 100 && value <= 599 ? value : null;
}

/**
 * Only structured numeric status/statusCode values can become http_status.
 * A "503" appearing in an error message must NEVER be reported as HTTP 503.
 * Check common SDK wrapping shapes without following arbitrary deep objects.
 */
function structuredHttpStatus(error: unknown): number | null {
  const outer = record(error);
  const candidates = [
    outer.status, outer.statusCode,
    record(outer.response).status,
    record(outer.cause).status, record(outer.cause).statusCode
  ];
  for (const candidate of candidates) {
    const status = validHttpStatus(candidate);
    if (status !== null) return status;
  }
  return null;
}

function safeErrorType(error: unknown): AdkSafeErrorType {
  const kind = record(error).name;
  if (kind === "ApiError" || kind === "ClientError" || kind === "ServerError")
    return "api_error";
  if (kind === "AbortError") return "abort_error";
  if (kind === "TimeoutError") return "timeout_error";
  if (kind === "TypeError") return "type_error";
  if (kind === "FetchError") return "network_error";
  if (kind === "Error") return "generic_error";
  return "other";
}

function httpCategory(status: number): AdkFailureCategory | null {
  if (status === 429) return "api_rate_limit_or_quota";
  if (status === 401) return "api_authentication";
  if (status === 403) return "api_permission_denied";
  if (status === 404) return "api_model_not_found";
  if (status === 408) return "api_network_failure";
  if (status >= 400 && status < 500) return "api_invalid_request";
  if (status >= 500) return "api_service_unavailable";
  return null;
}

function textCategory(value: string): AdkFailureCategory | null {
  const diagnostic = value.toLowerCase();
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
  if (/service.unavailable|503|internal.server|500|502|504|unavailable/.test(diagnostic))
    return "api_service_unavailable";
  if (/timed?out|econn|enotfound|network|socket|dns/.test(diagnostic))
    return "api_network_failure";
  return null;
}

/** Diagnostics contain ONLY finite numeric HTTP status and fixed enum values. */
export function inspectAdkFailure(
  error: unknown,
  fallback: AdkFailureCategory = "sdk_model_exception"
): AdkSafeFailureDiagnostic {
  const e = record(error);
  const http_status = structuredHttpStatus(error);
  const error_type = safeErrorType(error);
  if (http_status !== null) {
    const category = httpCategory(http_status);
    if (category !== null)
      return {category, http_status, error_type, classification_source:"http_status"};
  }
  const codes = [e.code, e.errorCode]
    .filter((value): value is string => typeof value === "string").join(" ");
  const fromCode = textCategory(codes);
  if (fromCode !== null)
    return {category:fromCode, http_status, error_type, classification_source:"error_code"};

  // Raw text is inspected transiently, never returned in the diagnostic.
  const messages = [e.message, typeof error === "string" ? error : ""]
    .filter((value): value is string => typeof value === "string").join(" ");
  const fromMessage = textCategory(messages);
  if (fromMessage !== null)
    return {category:fromMessage, http_status, error_type, classification_source:"message_pattern"};

  return {category:fallback, http_status, error_type, classification_source:"fallback"};
}

/** Backward-compatible one-label API for the existing fail-closed behavior. */
export function classifyAdkFailure(
  error: unknown,
  fallback: AdkFailureCategory = "sdk_model_exception"
): AdkFailureCategory {
  return inspectAdkFailure(error, fallback).category;
}
