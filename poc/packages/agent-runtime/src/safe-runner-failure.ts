/**
 * Fixed-vocabulary, source-free Docker failure feedback for a delegated Test
 * Agent. Never pass full Runner responses, logs, paths or error messages to
 * the model. Provider evidence remains separately checked by the Gateway.
 */
const PHASES=new Set([
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
]);
export function safeRunnerFailureDetails(execution:unknown):
  {first_failed_phase:string}|undefined {
  if(!execution||typeof execution!=="object")return undefined;
  const phases=(execution as {phases?:unknown}).phases;
  if(!Array.isArray(phases))return undefined;
  const first=phases.find(x=>x&&typeof x==="object"&&
    x.status==="fail"&&PHASES.has(x.phase));
  return first?{first_failed_phase:first.phase}:undefined;
}
