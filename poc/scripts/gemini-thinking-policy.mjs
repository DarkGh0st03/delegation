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
 * Every full workflow uses the verified 3.8 Flash + LOW for Backend and Test,
 * with an independent, explicit Frontend economy configuration.
 * Standalone role probes remain on the general Gemini selection.
 */
export function resolveRoleGeminiConfiguration({
  role, roleMode="", geminiModel="gemini-3.8-flash",
  geminiThinking="LOW", frontendModel="gemini-3.6-flash",
  frontendThinking="MINIMAL"
}) {
  if(!["backend","frontend","test"].includes(role))
    throw new Error("Unsupported specialized Agent role");
  const useFrontendEconomy = roleMode==="all" && role==="frontend";
  const model=useFrontendEconomy?frontendModel:geminiModel;
  const thinking=useFrontendEconomy?frontendThinking:geminiThinking;
  return {
    model, thinkingLevel:thinking,
    ...resolveGeminiThinkingConfig(model,thinking)
  };
}
