# Delegation — post-professor architecture migration audit

Repository: `DarkGh0st03/delegation` · branch `refactor/post-prof-plan-contracts-20261021`  
Baseline inspected: `7032f5dee0b5005564c2fa3758005c69641352d4` · 2026-11-03

This inventory is about **live entry-point reachability**, not filename heuristics.
It does not claim paid Gemini E2E success, or that every milestone is finished.

| Area / actual entry point | Decision | Verified implementation and remaining gap |
| --- | --- | --- |
| `poc/apps/gateway/src/runtime.ts` / direct Core loader | KEEP | `core-rust` calls native verification and fails closed; Adapter verifier remains a separately selectable legacy mode |
| `poc/apps/gateway/src/composite-authorization.ts` | MODIFY | Real `verifyMultiple` + per-action OPA all-or-nothing authorization. **Authorization-only**: no provider batch execution yet; do not treat its receipt as executable authority |
| `poc/packages/orchestrator-runtime/src/trusted-engineer-authority.ts` | MODIFY | Distinct preliminary/operational roots and trusted signed approval exist; actual issuing transport still goes to issuing Adapter HTTP, not native trusted Engineer Rust issuance |
| `poc/packages/orchestrator-runtime/src/trusted-approved-child-issuer.ts` | MODIFY | Signed-plan-bound attenuated child issuance exists but goes through trusted Adapter transport; not yet migrated to crypto MCP |
| `poc/mcp-shared/src/crypto-catalog.ts` + `trusted-crypto-mcp-bridge.ts` | MODIFY | Crypto-only MCP creates task-bound signed VP via authenticated private Agent worker; issuance/revocation MCP operations still need an explicit trusted authority design |
| `poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs` | KEEP, MIGRATED TOOL PATH | Approved DAG now starts **only crypto MCP**, using ADK FunctionTools → Gateway directly for repository and Runner; no repository-routing MCP server in this canonical entry point |
| `poc/packages/agent-runtime/src/adk-specialized-agents.ts` | KEEP, GENERALIZED FOR SIGNED TASKS | Approved signed role tool capability list and prompt are independent of static IAM Console template; signed file/path/operation ceiling remains Task/Gateway-derived |
| `poc/packages/agent-runtime/src/specialized-agents.ts` | REPLACE AFTER PROOF | Still contains legacy Account Suspension prompts and fixed path profiles for historical, non-signed tasks. Do not delete while historical regression entry points import it |
| `poc/mcp-shared/src/http-server.ts`, `task-router.ts`, `private-mcp-worker-http.ts` | SPLIT / REMOVE LEGACY ROUTE AFTER PROOF | Two profiles remain in source, but canonical approved DAG starts only crypto profile. Keep the private crypto worker until child presentation is securely transferred. Remove the repository tool routing and old worker route after signed free E2E is proven and historical tests are migrated |
| `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs` | HISTORICAL, REPLACE CI ENTRY POINT | Old real-Docker Shared MCP suite still uses the sequential Account Suspension Coordinator, legacy authority bootstrap, and repository MCP. A successful run of **that** suite alone is not proof of the new architecture |
| `poc/packages/orchestrator-runtime/src/trusted-adk-planner.ts`, signed A2A dispatcher | KEEP | Read-only Gemini proposal, signed Task DAG, Agent Card binding. Do not modify immutable plan or grants as part of migration |
| D1 recovery, signed Task / Gateway plan checks | KEEP | Existing fail-closed read/revision gates preserved; remaining Gemini autonomous repair efficacy is separate from infrastructure migration |
| IAM Console / Account Suspension fixtures and independent acceptance | KEEP AS EXPERIMENT | Scenario-specific tests are legitimate fixtures; application-specific enforcement must not be part of the reusable framework |
| `.github/workflows/gemini-paid-shared-mcp-final.yml` | KEEP WITHOUT BILLING | Paid entry point must not be dispatched without explicit authorization. Its signed child path uses the migrated native approved DAG from the free smoke |
| `.github/workflows/functional-signed-dag-e2e.yml` | VALIDATE | Integrated free signed-DAG runtime is the relevant proof for FunctionTools → Gateway + crypto-only MCP, separate from the historical sequential MCP smoke |

## Ordered migration gates

- **R0:** structural and reachable-entry-point audit above; captured.
- **R1:** keep native verification; complete actual read-only composite execution only after SHA-pinned read and full Task binding design, not by misusing authorization-only receipts.
- **R2:** move Engineer root issuance to trusted native Rust and Child DC issuance to scoped crypto-MCP flows without granting model authority; verify separate approval and revocation.
- **R3:** approved signed DAG now uses direct Gateway FunctionTools plus crypto-only MCP; Fast CI is green. Free integrated signed E2E still required before removing old routing.
- **R4:** approved signed Tasks use generic capabilities and prompts; legacy Account Suspension profile still used by historical path.
- **R5:** retain Planner/Executor signed binding and D1, then verify their behavior using only the migrated path.
- **R6:** after integrated proof, remove old repository-MCP routing, private repo worker, and duplicate historical CI entry points together with references. Preserve historical artifacts.
- **R7:** one consolidated no-AI same-SHA Full CI checkpoint, plus explicit evidence that **Functional Signed DAG** used crypto-only MCP and direct Gateway tools. Cumulative and historical Shared MCP suites alone cannot establish this.

## Safety rules

Do not merge to main, allow a model to issue root DCs, bypass OPA/native Rust, turn a failure report into authority, claim a human approval in CI, or invoke paid Gemini without fresh consent. The check is offline and uses scripted models.
