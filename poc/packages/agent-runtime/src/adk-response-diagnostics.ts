import type {LlmResponse} from "@google/adk";

/** Only static, known Gemini/ADK finish labels may enter CI logs. */
const ALLOWED_FINISH_REASONS = new Set([
  "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "LANGUAGE", "OTHER",
  "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL",
  "UNEXPECTED_TOOL_CALL", "NO_IMAGE", "FINISH_REASON_UNSPECIFIED"
]);

export type SafeAdkResponseShape = {
  finish_reason: string | null;
  function_call_parts: number;
  text_parts: number;
};

/**
 * No text, reasoning traces, function names, file paths or tool arguments.
 * Unknown untrusted provider labels are never copied into the logs.
 */
export function safeAdkResponseShape(response: LlmResponse): SafeAdkResponseShape {
  const raw: unknown = response.finishReason;
  const finish_reason = raw === undefined || raw === null
    ? null
    : typeof raw === "string" && ALLOWED_FINISH_REASONS.has(raw)
      ? raw : "UNKNOWN";
  let function_call_parts = 0;
  let text_parts = 0;
  for (const part of response.content?.parts ?? []) {
    if (part.functionCall) function_call_parts++;
    if (typeof part.text === "string") text_parts++;
  }
  return {finish_reason, function_call_parts, text_parts};
}
