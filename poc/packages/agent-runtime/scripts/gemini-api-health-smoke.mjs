import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {inspectAdkFailure} from "../src/adk-failure-categories.ts";
import {safeGoogleError, NO_GOOGLE_ERROR} from "./gemini-model-metadata.mjs";

/**
 * Output-only, fixed-shape diagnostics for synthetic generateContent results.
 * No provider text, unknown reason, freeform metadata or credentials escape.
 */
const ALLOWED_FINISH_REASONS = new Set([
  "FINISH_REASON_UNSPECIFIED", "STOP", "MAX_TOKENS", "SAFETY",
  "RECITATION", "LANGUAGE", "OTHER", "BLOCKLIST",
  "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL",
  "IMAGE_SAFETY", "UNEXPECTED_TOOL_CALL", "TOO_MANY_TOOL_CALLS"
]);
function safeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function safeGenerationResponse(body) {
  const candidates = Array.isArray(body?.candidates) ? body.candidates : null;
  const first = candidates?.[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : null;
  const texts = parts?.filter(x => typeof x?.text === "string")
    .map(x => x.text) ?? [];
  const reply = texts.join("").trim();
  const reason = first?.finishReason;
  const usage = body?.usageMetadata;
  return {
    exact_ready: reply === "READY",
    diagnostic: {
      candidate_count: candidates?.length ?? null,
      part_count: parts?.length ?? null,
      text_part_count: parts ? texts.length : null,
      has_text: reply.length > 0,
      finish_reason: typeof reason === "string" &&
        ALLOWED_FINISH_REASONS.has(reason) ? reason : null,
      prompt_token_count: safeTokenCount(usage?.promptTokenCount),
      candidate_token_count: safeTokenCount(usage?.candidatesTokenCount),
      total_token_count: safeTokenCount(usage?.totalTokenCount),
      thoughts_token_count: safeTokenCount(usage?.thoughtsTokenCount)
    }
  };
}

/**
 * One Gemini Developer API request, WITHOUT ADK, A2A, Gateway, repository or
 * tools. Synthetic prompt only. Neither provider bodies nor errors are logged.
 * No retries, no Vertex AI, no paid-provider fallback.
 */
export async function runGeminiApiHealthSmoke({
  apiKey,
  model = "gemini-3.8-flash",
  timeoutMs = 20_000,
  fetchFn = fetch
}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini API key is required");
  }
  if (!/^gemini-[a-z0-9.-]+$/u.test(model)) {
    throw new Error("Invalid Gemini model identifier");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) {
    throw new Error("Gemini smoke timeout must be 1..20000 milliseconds");
  }
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{role:"user",parts:[{text:"Reply with exactly READY."}]}],
          generationConfig: {temperature:0,maxOutputTokens:256}
        }),
        signal: timeout
      }
    );
  } catch (error) {
    const inspected = inspectAdkFailure(error);
    const timedOut = timeout.aborted;
    return {
      result:"gemini-api-health-fail",
      model,
      http_status:timedOut ? null : inspected.http_status,
      category: timedOut ? "api_inference_timeout" :
        inspected.error_type === "type_error" && inspected.http_status === null
          ? "api_network_failure" : inspected.category,
      classification_source:timedOut ? "runtime_timeout" :
        inspected.error_type === "type_error" && inspected.http_status === null
          ? "network_exception" : inspected.classification_source,
      error_type:inspected.error_type,
      ...NO_GOOGLE_ERROR,
      generation_diagnostic:null,
      duration_ms:elapsed(),
      requests:1
    };
  }
  const diagnostic = inspectAdkFailure({status:response.status});
  if (!response.ok) {
    // Inspect only allowlisted Google RPC error.status and numeric error.code.
    // Never log raw messages, response details, headers, or other provider data.
    let safeError = NO_GOOGLE_ERROR;
    try {
      safeError = safeGoogleError(await response.json(), diagnostic.http_status);
    } catch {
      // Non-JSON responses remain safely classified by numeric HTTP status.
    }
    return {
      result:"gemini-api-health-fail",
      model,
      http_status:diagnostic.http_status,
      category:diagnostic.category,
      classification_source:diagnostic.classification_source,
      error_type:"http_response",
      ...safeError,
      generation_diagnostic:null,
      duration_ms:elapsed(),
      requests:1
    };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return {
      result:"gemini-api-health-fail",
      model,
      http_status:diagnostic.http_status,
      category:"invalid_response",
      classification_source:"response_validation",
      error_type:"http_response",
      ...NO_GOOGLE_ERROR,
      generation_diagnostic:null,
      duration_ms:elapsed(),
      requests:1
    };
  }
  // Validate READY privately; expose only fixed-shape, content-free metrics.
  const generation = safeGenerationResponse(data);
  if (!generation.exact_ready) {
    return {
      result:"gemini-api-health-fail",
      model,
      http_status:diagnostic.http_status,
      category:"invalid_response",
      classification_source:"response_validation",
      error_type:"http_response",
      ...NO_GOOGLE_ERROR,
      generation_diagnostic:generation.diagnostic,
      duration_ms:elapsed(),
      requests:1
    };
  }
  return {
    result:"gemini-api-health-pass",
    model,
    http_status:diagnostic.http_status,
    category:null,
    classification_source:"http_status",
    error_type:"http_response",
    ...NO_GOOGLE_ERROR,
    generation_diagnostic:generation.diagnostic,
    duration_ms:elapsed(),
    requests:1
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runGeminiApiHealthSmoke({
      apiKey:process.env.GEMINI_API_KEY,
      model:process.env.GEMINI_MODEL ?? "gemini-3.8-flash"
    });
    console.log(JSON.stringify(result));
    if (result.result !== "gemini-api-health-pass") process.exitCode = 1;
  } catch {
    // In particular, NEVER dump configuration, stack or secrets.
    console.error(JSON.stringify({
      result:"gemini-api-health-fail",
      category:"invalid_configuration",
      requests:0
    }));
    process.exitCode = 1;
  }
}
