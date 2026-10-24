/**
 * Historical Phase 9B Account Suspension Gateway conveniences ONLY.
 *
 * This opt-in module retains the fixed feature/account-suspension branch and
 * Pull Request helpers for historical offline/paid-comparison scripts.
 * The canonical approved DAG uses its separately authorized Task/Gateway
 * path. Importing this file does not grant any delegated permission.
 */
export {OrchestratorProtectedGatewayClient}
  from "./orchestrator-gateway-client.ts";
export type {
  OrchestratorProtectedGatewayClientConfig,
  OrchestratorCreateBranchResult,
  OrchestratorCreatePullRequestResult
} from "./orchestrator-gateway-client.ts";
