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

## R174 — static 11-file Account Suspension authority preflight removed

`check-account-suspension-reference-scope.mjs` and
`permission-templates.test.ts` were the two remaining imports of the
physically retired `permission-templates.ts`. They encoded a fixed
eleven-file role/permission ceiling, unsuitable for generic signed Tasks.
Both are physically deleted. Cumulative, disposable-merge and PoC-baseline
workflows now run `trusted-engineer-authority.test.ts`, covering the
Engineer-derived approval and delegation boundaries instead. Current signed
DAG and researcher Account Suspension acceptance remain untouched.

## R175 — make legacy retirement audit executable

The R6 audit now enumerates **every** physically retired sequential
Coordinator, old paid Gemini script, static-template credential issuer,
fixed branch/PR writer and obsolete authority-boundary probe. Previous
negative checks accidentally excluded some deleted modules from
`R6_LEGACY_CANDIDATES` or `R6_RETIRED_TARGETS`.
The old allowlists for sequential, workflow and legacy Gateway static
imports have been emptied: no new executable may silently revive them.
The audit is part of the free Cumulative Offline workflow.

## R176 — final retired-script references removed

The historical `disposable-simulated-approval-merge.yml` workflow still
contained TWO live commands pointing at the deleted sequential ADK/MCP
positive script. It is retired: the signed-DAG Functional and native
D1 Docker workflows already provide the modern approval/acceptance path,
without simulated approval or merge of user resources.

The old `gemini-live-no-synthetic-merge` test read a physically deleted
billed sequential script. It now inspects the real signed/manual-only Gemini
workflow, exact pinned SHA guard and synthetic-merge exclusions.
The signed Gemini CI-gate negative test uses a deliberately unknown
workflow path rather than referencing the deleted historical workflow.
The R6 retired-asset audit is the single source of truth for absence.

## R184–R185 — MCP legacy reachability audit closure (4 November 2026)

**Verified branch**: `refactor/post-prof-plan-contracts-20261021`.
**R184 proof commit**: `60d886aab8294c5c22128f6a3383f4e61efc7a9c`.
On that SHA, Fast CI `41802434175` and Trusted Crypto MCP Gateway
Bridge `41802434220` both completed **SUCCESS**. The earlier consolidated
R179 baseline (`23ce3411`) also has the three free signed-DAG, cumulative
and signed-D1 runs **SUCCESS** on that historical SHA. Do not claim those
three runs validate a newer SHA.

### Reachable production entrypoints and dispositions

| Component | Decision | Observed actual route / constraint |
| --- | --- | --- |
| `poc/mcp-shared/src/main.ts` | **KEEP** | `requireProductionCryptoMcpProfile` rejects `legacy`; instantiates `CryptoWorkerRouter`, not `TaskRouter`. |
| `poc/mcp-shared/src/crypto-worker-router.ts` | **KEEP** | Routes only `delegation_create_presentation` to authenticated `/internal/mcp-crypto-call`. |
| `poc/apps/a2a-agent/src/main.ts` and `mcp-tool-flags.ts` | **KEEP** | Production A2A refuses `ADK_MCP_SHARED_URL` and legacy write/create/run-test flags. Agent repository/Runner operations use FunctionTools → Gateway. |
| `poc/packages/agent-runtime/src/server.ts` | **MODIFIED R185** | Trusted `approved-plan` instances now explicitly refuse `mcpSharedUrl` even if invoked directly as a library, preventing an accidental switch back to the archived worker route. |
| `poc/packages/agent-runtime/src/private-mcp-task-registry.ts` and `private-mcp-worker-http.ts` | **KEEP crypto half; ARCHIVE legacy half** | The registry's short-lived Task bearer and one-shot private VP lookup are needed. Production mounts crypto endpoint; repository endpoint is registered only in explicitly opted-in legacy fixtures. |
| `poc/mcp-shared/src/http-server.ts` | **KEEP split factory** | Only the `crypto` profile is deployable through `main.ts`; historical `legacy` registration is a dynamic import isolated from the production process. |
| `poc/mcp-shared/src/legacy-repository-tools.ts`, `task-router.ts` | **ARCHIVE / REMOVE AFTER FIXTURE MIGRATION** | Remain reachable from explicitly opted-in historical tests, but not from the production launcher. Do not mistake source-file presence for runtime reachability or claim physical R6 deletion. |
| `poc/packages/agent-runtime/src/adk-specialized-agents.ts` | **KEEP canonical FunctionTools; MIGRATE legacy MCPToolset option** | Signed Tasks expose Gateway-controlled operations. Legacy MCP configuration still exists for archived ADK regression fixtures; the production A2A launcher does not supply it. |

### R184 positive security proof

The prior signed invoice Task test still ran repository `update_file`
through historical MCP. It was rewritten to issue `update_file` through
the signed Gateway client while using only crypto-MCP for a private VP.
It asserts: the only MCP tool visible is
`delegation_create_presentation`; the private repository worker route is
**404**; the signed Gateway allows the approved operation exactly once and
blocks unauthorized branch/path/operation changes, an OPA deny and a
closed review session. The two R184 free CI workflows passed on the same SHA.

### Audit verdict and bounded remaining work

**Deployment/runtime reachability audit: CLOSED** for the identified canonical
A2A launcher, MCP launcher and approved-plan library route. Crypto-only MCP
and direct Gateway are now the permitted route; the old repository mode is
not a production option. **Physical legacy deletion: NOT FINISHED**:
historical ADK/MCP test harnesses still depend on archived `TaskRouter`,
`legacy-repository-tools` and private legacy worker route. Removing them
without migrating those fixtures would eliminate regressions rather than
prove the signed pipeline. This is a scoped inventory verdict, not a blanket
security certification or a live Gemini autonomous-repair success.

**Next gate**: validate the new R185 guard in Fast CI, then migrate/delete the
remaining historical fixtures in a separate bounded change. Re-run the
consolidated three zero-billing Full CI on a common SHA only after those
runtime/test changes. No paid Gemini workflow is authorized by this audit.

## R186 — archived ADK/A2A repo-MCP smoke launchers physically retired

Removed **eight historical executable smoke files** (7 ADK/A2A script
launchers plus shared MCP `real-read-smoke.mjs`) and their npm commands.
The last active workflows no longer reference these scripts. All eight now
appear in both the R6 candidate and required-absent retirement inventories,
which inspect remaining executable references. Git history preserves their
previous implementation and reproduction details; the signed DAG's direct
FunctionTools, the crypto-only MCP bridge and independent Runner/Gateway
tests remain the required test path.

This is an intentionally **bounded R186 stage**, not a claim that the legacy
repository-MCP source or historical test routes have been deleted:
`mcp-shared/src/task-router.ts`, `legacy-repository-tools.ts`,
`private-mcp-worker-http.ts`'s opted-in repo route, and opt-in ADK
MCPToolset fixtures still need targeted migration. Do not remove the
crypto-only private worker, one-shot proof ref or Task bearer registry.

## R187 — remove deployable legacy A2A MCP flag resolver

Removed `resolveMcpToolFlags`, a dormant selector which could previously
return model-facing repository `mcpUpdateFile`/`mcpCreateFile`/
`mcpRunTests` capabilities. The production launcher calls only
`requireProductionDirectGatewayTools` and continues to reject
`ADK_MCP_SHARED_URL` or any enabled legacy repository flag. Explicit
`false` remains accepted to avoid breaking configurations that still
supply disabled flags; unknown values fail closed. The `ADK_MCP_CRYPTO_URL`
VP-only bridge remains supported. The old resolver is not an agent API.

This stage removes an obsolete production-facing configuration surface,
not the remaining internal `TaskRouter`/legacy ADK MCPToolset test fixtures.

## R188 — physical removal of Shared MCP repository routing

Deleted `poc/mcp-shared/src/task-router.ts` and
`poc/mcp-shared/src/legacy-repository-tools.ts` together with their
obsolete repository HTTP fixtures (6 tests) and old native ADK MCPToolset
integration fixtures (4 tests). The Shared MCP HTTP factory now has
**only** the `crypto` profile; the production selector rejects legacy.
Signed Task→Gateway FunctionTool and crypto-MCP private VP tests remain
active, including negative authorization and permission-boundary checks.
The R6 inventory requires all removed files absent; R165 rejects any
new legacy Shared MCP factory call in tracked JS/TS.

**Not yet removed**: the separate optional ADK legacy `mcpSharedUrl`
MCPToolset branch, the unused private repository worker endpoint and
`PrivateMcpTaskRegistry.invoke`. These require migration/removal of
legacy unit fixtures without touching the crypto task token/proof reference
path. This does not demonstrate a billed Gemini E2E pilot.

## R189 — remove private MCP repository/Runner HTTP worker route

Deleted the optional `/internal/mcp-tool-call` route from
`private-mcp-worker-http.ts`. `startSpecializedAgentServer` now
always mounts the authenticated, VP-only
`/internal/mcp-crypto-call` endpoint when its trusted Task registry is
present, regardless of any old internal MCP configuration. The old
worker-side parser and Runner failure-hint forwarding were removed from
this HTTP bridge; the canonical Gateway/Runner diagnostic code is kept
elsewhere. A valid signed bearer cannot reach the deleted repository
endpoint (404); forged crypto bearers fail closed (401). Fast CI now
tests these negative properties directly.

`PrivateMcpTaskRegistry.invoke` remains as an unexposed legacy unit-test
method; the present patch removes its HTTP reachability, not yet that
internal implementation. The crypto proof_ref lifecycle is unchanged.

## R190 — private Task registry no longer dispatches legacy repository tools

Removed the now unreachable `PrivateMcpTaskRegistry.invoke` method and
its legacy repository argument parsers, leaving only the crypto-only
`invokeCrypto`, signed-task bearer verification, Gateway challenge
staging and one-shot in-memory `proof_ref` retrieval. Existing tests
which dispatched arbitrary repository/Runner MCP tools were replaced
with task/role isolation, forged identity, cancellation and proof replay
checks against the cryptographic interface. The concurrency/one-shot
12+ proofs regression is preserved. Legacy direct Gateway permission
ceiling remains tested in approved-plan/Gateway suites, not in this
removed repository MCP entry point.

The `begin` method still accepts historical scope-option fields for
compatibility with old internal ADK config. Those inert options and the
dormant ADK `mcpSharedUrl`/MCPToolset code are separate cleanups; this
stage does not change the trusted Gateway Task authorization itself.

## R191 — retire three obsolete private repository MCP opt-in fixtures

The final legacy `PrivateMcpTaskRegistry.invoke`-dependent opt-in
tests for `create_file`, `run_tests` and `update_file` were deleted
after R190 physically removed that method. Their negative requirements
are tested through the **signed Gateway FunctionTool** and approved-Task
suites, and the crypto worker now directly proves it has no repository
HTTP route. The R6 inventory requires those three old fixture files
to remain absent. Do not reinstate the dead registry method to satisfy
the old test suites.

## R192 — remove archived repository MCP argument catalog

Removed the old `mcp-shared/src/catalog.ts` (repository/Runner
`read_file`/`update_file`/`create_file`/`run_tests` MCP tool schemas)
and its three isolated parser-test fixtures. The corresponding HTTP
factory, TaskRouter and private worker invoker were retired in R188–R190.
No model-facing repository MCP endpoint or named caller remains in the
canonical path. Gateway operation validation, the signed approved-plan
contract and the **separate** `crypto-catalog.ts` remain intact.

All four removed paths are checked by the R6 negative-reference inventory.
This is a historical code deletion, not evidence of Gemini model success.
