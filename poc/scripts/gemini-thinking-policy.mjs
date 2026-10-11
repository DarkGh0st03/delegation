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

/**
 * Manual adk-gemini-full uses one explicitly selected model/effort for ALL
 * specialized roles. Default: Gemini 3.6 Flash + MINIMAL. This keeps the
 * previous standalone Backend/Frontend/Test probes on their own validated
 * Gemini 3.8 Flash + LOW defaults.
 *
 * The full-mode override is configurable for a later 3.8 Flash + LOW
 * fallback without changing any security profiles or code generation limits.
 */
export function resolveRoleGeminiConfiguration({
  role, roleMode="", geminiModel="gemini-3.8-flash",
  geminiThinking="LOW", fullModel="gemini-3.6-flash",
  fullThinking="MINIMAL"
}) {
  if(!["backend","frontend","test"].includes(role))
    throw new Error("Unsupported specialized Agent role");
  const useFullModel = roleMode==="all";
  const model=useFullModel?fullModel:geminiModel;
  const thinking=useFullModel?fullThinking:geminiThinking;
  return {
    model, thinkingLevel:thinking,
    ...resolveGeminiThinkingConfig(model,thinking)
  };
}
