import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {inspectAdkFailure} from "../src/adk-failure-categories.ts";

/**
 * Allowlisted Google RPC error statuses. Untrusted error.message, details,
 * reason, metadata, and unknown status strings NEVER enter logs or results.
 */
const GOOGLE_ERROR_STATUSES = new Set([
  "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED",
  "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED",
  "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE",
  "DATA_LOSS", "UNAUTHENTICATED"
]);
function safeGoogleError(body, httpStatus) {
  const error = body && typeof body === "object" && !Array.isArray(body)
    ? body.error : null;
  const e = error && typeof error === "object" && !Array.isArray(error)
    ? error : null;
  const status = e && typeof e.status === "string" &&
    GOOGLE_ERROR_STATUSES.has(e.status) ? e.status : null;
  const code = e && typeof e.code === "number" && Number.isInteger(e.code) &&
    e.code >= 100 && e.code <= 599 && e.code === httpStatus
    ? e.code : null;
  return {google_error_status:status, google_error_code:code};
}
const NO_GOOGLE_ERROR = Object.freeze({
  google_error_status:null, google_error_code:null
});

/**
 * Diagnostic-only metadata requests for the existing Gemini Developer API key.
 * Exactly two GET requests: models.list and models.get. No content generation,
 * no retries, no ADK or delegated-authorization infrastructure.
 * Never log response bodies, headers, request headers or caught exceptions.
 */
export async function inspectGeminiModelMetadata({
  apiKey,
  model = "gemini-3.8-flash",
  timeoutMs = 15_000,
  fetchFn = fetch
}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini API key is required");
  }
  if (!/^gemini-[a-z0-9.-]+$/u.test(model)) {
    throw new Error("Invalid Gemini model identifier");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) {
    throw new Error("Metadata timeout must be 1..20000 ms");
  }

  const base = "https://generativelanguage.googleapis.com/v1beta/models";
  async function request(endpoint) {
    const started = performance.now();
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchFn(endpoint, {
        method:"GET",
        headers:{"x-goog-api-key":apiKey},
        signal:timeout
      });
      const diagnostic = inspectAdkFailure({status:response.status});
      if (!response.ok) {
        // Inspect ONLY the structured error.status/error.code; discard the
        // entire provider response before producing the safe telemetry.
        // Never copy message, details, reason, headers, or raw JSON to logs.
        let safeError = NO_GOOGLE_ERROR;
        try {
          const body = await response.json();
          safeError = safeGoogleError(body, diagnostic.http_status);
        } catch {
          // Malformed/non-JSON error bodies must not leak into telemetry.
        }
        return {http_status:diagnostic.http_status,
          category:diagnostic.category,
          ...safeError,
          duration_ms:Math.round(performance.now()-started),
          data:null};
      }
      try {
        const data = await response.json();
        return {http_status:diagnostic.http_status,
          category:null, ...NO_GOOGLE_ERROR,
          duration_ms:Math.round(performance.now()-started),
          data};
      } catch {
        return {http_status:diagnostic.http_status,
          category:"invalid_response", ...NO_GOOGLE_ERROR,
          duration_ms:Math.round(performance.now()-started),
          data:null};
      }
    } catch (error) {
      const d = inspectAdkFailure(error);
      return {http_status:timeout.aborted ? null : d.http_status,
        category:timeout.aborted ? "api_inference_timeout" :
          d.error_type === "type_error" && d.http_status === null
            ? "api_network_failure" : d.category,
        ...NO_GOOGLE_ERROR,
        duration_ms:Math.round(performance.now()-started),
        data:null};
    }
  }
  // A single models.list page is normally sufficient (pageSize=1000).
  // If nextPageToken exists, absence from the page is NOT absence from the API.
  const list = await request(base+"?pageSize=1000");
  const get = await request(base+"/"+encodeURIComponent(model));
  const target = "models/"+model;
  const listModels = Array.isArray(list.data?.models) ? list.data.models : null;
  const matching = listModels?.find(x=>x?.name===target) ?? null;
  const getModel = get.data && typeof get.data === "object" ? get.data : null;
  const methodFlag = x=>Array.isArray(x?.supportedGenerationMethods)
    ? x.supportedGenerationMethods.includes("generateContent") : null;
  const safeLimit = x=>Number.isSafeInteger(x) && x>=0 ? x : null;
  return {
    result:"gemini-model-metadata-checked",
    model,
    requests:2,
    list:{
      http_status:list.http_status,
      category:list.category,
      google_error_status:list.google_error_status,
      google_error_code:list.google_error_code,
      duration_ms:list.duration_ms,
      valid_payload:list.data !== null && listModels !== null,
      count:listModels?.length ?? null,
      complete:listModels !== null ? !Boolean(list.data.nextPageToken) : null,
      target_listed:listModels !== null ? Boolean(matching) : null,
      generate_content_advertised:matching ? methodFlag(matching) : null
    },
    get:{
      http_status:get.http_status,
      category:get.category,
      google_error_status:get.google_error_status,
      google_error_code:get.google_error_code,
      duration_ms:get.duration_ms,
      valid_payload:getModel !== null && typeof getModel.name === "string",
      target_matches:getModel !== null && typeof getModel.name === "string"
        ? getModel.name===target : null,
      generate_content_advertised:getModel ? methodFlag(getModel) : null,
      input_token_limit:getModel ? safeLimit(getModel.inputTokenLimit) : null,
      output_token_limit:getModel ? safeLimit(getModel.outputTokenLimit) : null
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await inspectGeminiModelMetadata({
      apiKey:process.env.GEMINI_API_KEY,
      model:process.env.GEMINI_MODEL??"gemini-3.8-flash"
    });
    process.stdout.write(JSON.stringify(result)+"\n");
    if (result.list.http_status!==200 || result.get.http_status!==200 ||
      result.get.target_matches!==true) process.exitCode=1;
  } catch {
    console.error(JSON.stringify({result:"gemini-model-metadata-configuration-error"}));
    process.exitCode=1;
  }
}
