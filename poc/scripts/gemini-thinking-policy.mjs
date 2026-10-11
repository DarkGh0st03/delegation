// Offline-checkable Gemini thinking control. No API calls or agent tools.
const MINIMAL_SUPPORTED = new Set([
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview"
]);
export function resolveGeminiThinkingConfig(model,requested="LOW") {
  if(typeof model!=="string"||model.trim()==="")throw new Error("Missing Gemini model");
  if(!["LOW","MINIMAL"].includes(requested)) {
    throw new Error("Unsupported Gemini thinking level (choose LOW or MINIMAL)");
  }
  if(requested==="MINIMAL"&&!MINIMAL_SUPPORTED.has(model)) {
    throw new Error("MINIMAL thinking is unsupported for "+model+
      "; use LOW or explicitly select a MINIMAL-compatible model such as gemini-3.6-flash");
  }
  return {thinkingConfig:{thinkingLevel:requested}};
}
