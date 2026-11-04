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

## R166 — historical entrypoint isolation (2026-11-03)

- The canonical signed-DAG path still uses `profile:"crypto"` and direct ADK FunctionTools → Gateway; existing signed-plan and D1 recovery tests remain intact.
- Repository/Runner MCP registrations (`read_file`, `update_file`, `create_file`, `run_tests`) have been moved to `poc/mcp-shared/src/legacy-repository-tools.ts`. The shared HTTP factory imports this module but invokes it **only** after an explicit `profile:"legacy"` selection; no implicit fallback is permitted.
- Historical ADK/A2A scripts and tests explicitly select legacy, so older reproducibility remains available. Their workflow `shared-mcp-real-positive-e2e.yml` remains a historical baseline in the three-workflow release gate; its PASS must not be mistaken for the canonical signed DAG proof.
- **Not yet deletion-safe:** `sequential-coordinator.ts`, `legacy-authority-client.ts`, the private repository worker and legacy routing tests still have known real imports and CI callers. Physical removal before migrating those historical tests would destroy reproducibility, not improve the canonical path.
- R166 requires zero-billing Fast CI and crypto-only MCP tests. The next consolidated free Full CI should specifically verify the Functional Signed DAG's `approved_shared_mcp_enabled:false`, `direct_gateway_function_tools_enabled:true`, `approved_crypto_mcp_enabled:true` and real provider evidence on a single SHA. A historical Shared MCP PASS is corroboration only.

## R168 — canonical three-workflow gate replaces legacy requirement

Following successful R167 verification on SHA `9513944e`, the paid Gemini
preflight no longer requires a successful run of the *historical sequential*
Shared MCP Real Docker baseline as one of the three independent CI proofs.

The exact-SHA release gate now requires **all three**:
1. `cumulative-refactoring-offline.yml` — offline architectural regression.
2. `functional-signed-dag-e2e.yml` — signed approved DAG with direct
   FunctionTools → Gateway, native Rust/OPA/Gitea/Docker and crypto-only MCP.
3. `ts2724-signed-d1-targeted.yml` — real Docker TypeScript failure through
   newly authorized Backend D1 and independent fresh acceptance PASS.

The signed D1 workflow now listens to the same explicit `full-ci-request.json`
checkpoint marker. Ordinary development commits do not trigger expensive
full suites. The legacy Shared MCP suite is still retained for **main/spike,
PR, or explicit workflow_dispatch** but is not counted as proof of canonical
signed-DAG operation, and no longer runs as a refactor branch push gate.

The proof is scripted/no-AI only: it establishes that infrastructure and
signed recovery authorization work, **not** that a live Gemini model autonomously
derives a semantic fix. The manual paid workflow, human approval limitations,
consent guard and cost risks remain unchanged.

## R169 — obsolete sequential paid-Gemini executable physically deleted

Deleted `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs` after the signed-DAG paid workflow
replaced its capability. Updated the two offline workflow syntax checks and
the protected-merge workflow to use the signed manual-consent and exact-SHA
CI-gate tests instead. Updated both R6 audit inventories. The canonical
Gemini workflow is still exclusively manual; no billed inference was invoked.

**R2 blocker identified in real Rust source**: `CryptoRuntime.credentials`
is a process-local `HashMap` in
`services/delegation-adapter/src/crypto.rs`. `issue_child`,
`update_credential_status` and `create_presentation` all resolve their
parent/target credentials from that same map. Creating an isolated
Engineer-only native Rust signer while leaving child issuance and VP signing
in a separate Adapter would break the chain. Native migration must transfer
the **single** issuer/state owner, not merely duplicate root-signing keys.
R169 does not claim an unsafe Engineer-native switch.

## R172 — physically retire the hard-coded sequential Orchestrator and workflows

After the successful R167/R168 same-SHA canonical scripted signed-DAG gates,
the old fixed Backend→Frontend→Test `AccountSuspensionSequentialCoordinator`,
its dedicated workflow state machine, three executable old MCP smoke scripts,
their two GitHub Actions workflows and two unit test files were **deleted**.
The historical paid-Gemini sequential script was already deleted at R169.

The exact archived experiment remains reconstructible from Git commit history;
current executable entry points are the signed approved-plan DAG and D1 tests.
The R6 source inventory now marks removed executables as **expected absent**,
but still errors if any tracked runnable module imports or configures them.
Remaining legacy repository MCP per-tool test fixtures and static template
issuer wrappers are handled separately; they must not re-enter canonical code.

## R173 — frozen IAM Console delegation and protected-Gateway wrappers retired

Deleted the old static `LegacySoftwareEngineerAuthorityBootstrap` /
`DeterministicOrchestratorAuthorityIssuer` module and its fixed
`permission-templates.ts` matrix. The legacy fixed branch/PR
`OrchestratorProtectedGatewayClient` wrapper and its no-longer-invoked
real-Adapter authority-boundary probe were also removed. The canonical
`TrustedEngineerAuthoritySession`, immutable signed Task DAG, direct
Gateway FunctionTools, Rust verifier, OPA and generic Planner remain intact.

Updated legacy regression tests to exercise the current scoped Engineer
contracts and read-only Planning Gateway boundary rather than asserting
obsolete behavior. The R6 executable inventory marks all physically
removed files as **required absent** and still denies live imports/commands
to those paths. Account Suspension's scripted signed acceptance remains.
