import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {inspectAdkFailure} from "../src/adk-failure-categories.ts";

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
          generationConfig: {temperature:0,maxOutputTokens:16}
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
      duration_ms:elapsed(),
      requests:1
    };
  }
  const diagnostic = inspectAdkFailure({status:response.status});
  if (!response.ok) {
    // Do not read or log provider error payload, response headers, or request.
    return {
      result:"gemini-api-health-fail",
      model,
      http_status:diagnostic.http_status,
      category:diagnostic.category,
      classification_source:diagnostic.classification_source,
      error_type:"http_response",
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
      duration_ms:elapsed(),
      requests:1
    };
  }
  const parts = data?.candidates?.[0]?.content?.parts;
  const answer = Array.isArray(parts)
    ? parts.filter(p=>typeof p?.text==="string").map(p=>p.text).join("").trim() : "";
  // A success requires an actual response, not merely HTTP 200.
  if (answer !== "READY") {
    return {
      result:"gemini-api-health-fail",
      model,
      http_status:diagnostic.http_status,
      category:"invalid_response",
      classification_source:"response_validation",
      error_type:"http_response",
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
