/**
 * Historical Phase 9A/9B Account Suspension experiment ONLY.
 * This intentionally exports the frozen role/skill-template child issuer
 * outside the canonical Orchestrator API. No trusted signed-approval path
 * imports this module. Do not use it in approved DAG Execution.
 */
export {DeterministicOrchestratorAuthorityIssuer}
  from "./authority-client.ts";
