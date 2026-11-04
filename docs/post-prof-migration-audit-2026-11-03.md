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

## R193 — fix false-positive retirement audit configured command matching

R192/R192.1 failed the R6 audit because the former `configuredMatch`
used `command.includes(leaf)`: active `operation-catalog.test.ts`
was incorrectly classified as a caller of the deleted file
`catalog.test.ts`. It now requires an **exact command token or
slash-delimited path leaf**, with a Fast CI regression for the suffix
collision and for genuine configured launchers. This preserves
fail-closed checks without falsely blocking safe removal.

## R194 — ADK A2A handler cannot opt into retired repository MCP

Removed `mcpSharedUrl`, `mcpUpdateFile`, `mcpCreateFile` and
`mcpRunTests` from the A2A Task handler contract and all forwarding
paths. Any JavaScript caller supplying one of these retired keys now
fails closed, including a falsely disabled flag. The general server
applies the same guard before serving a request. The signed Test Task
continues to use a Gateway FunctionTool with bounded Docker timeout.
Crypto-only MCP proof generation still requires the trusted per-Task
registry and is never exposed as a repository/Runner MCP tool.

The standalone ADK specialized-agent MCPToolset implementation remains
in the source and has dedicated historical tests; remove it separately
after migrating its signed-path denial tests to the canonical FunctionTools.

## R195 — remove standalone ADK MCPToolset

`createAdkSpecializedAgent` no longer imports or instantiates
`MCPToolset`, constructs a model-facing repository/Runner MCP tool, or
calls the obsolete timed repository MCP Runner. All model tool requests
are direct Gateway FunctionTools. Signed dynamic-branch permission
enums, the one-failed-Test terminal latch and redacted tool telemetry
remain unchanged. Stale JavaScript config keys now fail closed.

The historical MCP-enabled agent tests have been migrated to the direct
Gateway path, including preparatory Test withholding `run_tests`
and exact signed file/branch grants. Crypto-only VP signing remains in
the separate trusted Task MCP bridge; this is not a live Gemini pilot.

## R196 — delete orphaned repository MCP transport and normalization modules

Following R195's removal of the only runtime import graph, the six
old repository/Runner MCP helper modules and their six coupled unit
test files are deleted: `mcp-read-result`, `mcp-write-result`,
`mcp-create-result`, `mcp-run-tests-result`,
`mcp-task-fetch` and `timed-mcp-run-tests`.
The transport/callback code had previously been removed from the ADK
model-facing agent, and current Gateway direct tools and Runner
diagnostics remain in their active modules and test suites.

R6 explicitly checks these twelve removed files have no executable
callers, while the R180 Fast CI boundary checks their absence.
The crypto-only MCP SDK client, private proof-ref and signed Task
bearer are NOT part of this deletion. This does not establish
real-model autonomous D1 success or revalidate the full CI on this SHA.

## R197 — source-level MCP retirement audit closeout and free release gate

**Current production architecture:** direct ADK FunctionTools →
Gateway + Rust + OPA for repository/Runner effects, with the
crypto-only MCP `delegation_create_presentation` path available to
a trusted VP signer. R186–R196 physically removed the seven obsolete
ADK/A2A repository MCP smoke scripts, old shared read smoke, factory
repository router, repository tool catalog, private repository HTTP
route, private registry repository invoker, model-facing ADK
`MCPToolset`, and orphaned transport/result normalization helpers.
The remaining `PrivateMcpTaskRegistry` provides signed Task bearer,
private challenge staging, and one-shot proof custody. Any residual
compatibility fields within the trusted registry do **not** dispatch
repository operations or provide a model tool; they can be considered
separate cleanup, not a production routing path.

**Docs corrected:** the shared MCP README no longer instructs users
to set `MCP_TOOL_PROFILE=legacy`, which is now rejected, and no
longer describes deleted `TaskRouter`/`MCPToolset` components as
running code. Older entries in this chronological handoff are historical
and must not be read as the newest architecture.

**Evidence:** R193 Fast CI, R194 Fast/crypto/prebound-A2A tests, R195
Fast/prebound-A2A tests, R196 Fast CI are green on their respective
SHAs. The older R179 3/3 Full CI success was on SHA `23ce3411`.
Those historical runs do NOT attest the full R197 revision.

**Verdict:** the identified executable repository MCP routing path
and its attached legacy fixtures are physically retired, subject to
the final R197 *same-SHA free* Full CI release gate. This is a bounded
source/entrypoint audit; it is not a proof of zero undiscovered
runtime dependencies or a paid-model autonomous recovery success.
No production `main` change or paid inference is authorized here.

## R198–R214 — canonical task-local cryptographic MCP and native Rust issuer (4 November 2026)

**Branch:** `refactor/post-prof-plan-contracts-20261021`. This is a
constrained migration of the architecture presented to the professor.
Keep `main` unchanged; no Gemini model calls or paid pilot are
authorized by the work described here.

- **R198–R199:** the approved signed A2A agents now use generic,
  reusable Backend/Frontend/Test role profiles and default Agent Cards.
  Account Suspension descriptions remain explicitly isolated historical
  fixtures, not the approved role baseline or the Task source of truth.
- **R200–R210:** approved execution uses ADK FunctionTools directly
  against the Gateway for repository and Runner effects. A task-bound
  **in-process MCP SDK** provides only cryptographic VP creation to the
  trusted runtime. The signed DAG no longer starts the Shared MCP HTTP
  listener or a CryptoWorkerRouter/private HTTP worker; confirmed VP
  proofs, not HTTP requests, are recorded by the private host.
  Legacy standalone crypto-only HTTP server and worker modules still
  exist for explicit compatibility tests and must not be mistaken for
  part of the canonical signed DAG.
- **R201–R205:** the *same* Rust `CryptoRuntime` that handles
  Software Engineer roots now exposes role-authenticated native Unix
  socket commands for approved Orchestrator Child DC issuance and
  specialist VP signing. The Engineer's root issue/revoke remains
  Engineer-only; Orchestrator child issuance and specialist VP signing
  are role- and capability-restricted. This does NOT add a second
  issuer, private key store or revocation registry.
- **R206–R213:** private Node IPC and local MCP SDK unit tests verify
  one-shot challenge binding, denial/cancellation, redaction and the
  lack of HTTP Adapter fallback **when the native socket is selected**.
  The native Rust unit test issues a root and a Child DC, signs a
  specialist VP and verifies it in the same Rust trust state. It also
  denies cross-role issuance. Rust Multipermission CI #41822750909
  and Fast CI #41823385281 were SUCCESS after these corrections.
  Earlier R210 Fast CI #41821407153 also passed.

**Rust Gateway:** `services/delegation-core-node` is an already
implemented native Node-API addon calling the Rust verifier, with
independent public/EVM credential sources. Do not rebuild it.
`direct-core-loader.ts` now accurately describes this behavior.

**Important boundaries still pending final proof:**
(1) The canonical full signed DAG/Runner/Gitea/OPA/EVM validation
must pass on one SHA with task-local MCP and the native Rust issue/VP
path. (2) Compatibility code still permits the older HTTP Adapter
transport when the native signer socket is not configured; an
architecture-complete deployment must explicitly configure and
enforce the native path before the HTTP issuing API can be retired.
(3) Physical deletion of the separately executable legacy
crypto-only HTTP service and worker is deferred until no CI or
explicit compatibility entrypoint needs them. Their mere existence
does not imply the canonical DAG invokes them. (4) Signed D1
scripted success is not real Gemini autonomous software repair.

## R214 — full same-SHA integration gate

The free release candidate will trigger the three canonical checks
on **one commit**: `cumulative-refactoring-offline.yml`,
`functional-signed-dag-e2e.yml`, and
`ts2724-signed-d1-targeted.yml`. None calls Gemini/OpenAI API.
The gate checks whether canonical signed ADK/Task → Gateway/OPA →
public-only native Rust verifier and private local crypto signer
can complete Account Suspension and the signed D1 recovery in real
Gitea/Docker, without Shared MCP repository or crypto HTTP routing.
Do not assert completion before all checks finish successfully;
no paid Gemini pilot is authorized.

## R215–R218 — native Rust presentation route and canonical fail-closed gates (4 November 2026)

The following **source changes are committed**, but do not constitute a passing
same-SHA CI result until the canonical release checks finish:

- R215: Orchestrator create-branch and pull-request VP signing uses the
  authenticated native Unix socket in the canonical DAG; a native denial
  never falls back to issuing Adapter HTTP.
- R216–R217: the trusted Planning Gateway transport and owner-side root VP
  checks (including pre-revocation proofs and denied provider operations)
  select the same native CryptoRuntime. Historical, explicitly noncanonical
  offline fixtures retain their former HTTP compatibility path.
- R218: canonical mode `APPROVED_RUNNER_NATIVE_MCP=1` fails closed if
  `ADAPTER_ENGINEER_NATIVE_SOCKET` is missing for Engineer root DC,
  approved Child DC, Orchestrator Gateway VP or Agent VP. The canonical
  ADK A2A handler additionally requires its task-local MCP registry and
  forbids a remote crypto-MCP endpoint in this mode.
- R218 adds tests for missing native root/Child/Agent signers and a loopback
  Unix-socket Orchestrator prepare -> signed VP -> Gateway execute positive
  and negative regression. Fast CI now includes the Orchestrator regression.

**Evidence limitations:** GitHub Actions push-run state has not been established
from the available commit status API. No Fast CI or Full CI is declared green
for R218. The three zero-billing full workflows must all report SUCCESS for
the *same new checkpoint SHA*. Source checks alone do not prove Gitea/Docker
acceptance, and scripted D1 does not prove autonomous Gemini repair.

**Remaining compatibility boundary:** HTTP Adapter root/Child/VP and the
separately executable old crypto-only HTTP services are retained only for
noncanonical fixtures; do not physically delete them before checking their
remaining executable callers. No main merge or paid model run is authorized.

## R220 — production A2A cannot silently restore the remote crypto-MCP hop

The canonical full-ci request at R219 remains a historical checkpoint for
that exact SHA. Subsequent source changes require new, separate validation.

The deployable `poc/apps/a2a-agent/src/main.ts` ADK launcher is now
**native-only and task-local by construction**: it rejects a missing/invalid
`ADAPTER_ENGINEER_NATIVE_SOCKET`, any
`ADK_MCP_CRYPTO_URL` (including an empty value), and explicitly disabled
canonical mode. It provisions only a per-process in-memory MCP Task signer
and enables `APPROVED_RUNNER_NATIVE_MCP=1` before constructing an ADK
server. Direct repository/Runner FunctionTools still pass through Gateway;
no root/child cryptographic authority is exposed as a model tool.

Deterministic historical A2A fixtures remain possible without a native Rust
socket, but even those production launchers reject a stale remote
crypto-MCP URL. Standalone crypto HTTP compatibility sources are intentionally
not deleted here: their remaining explicit tests must be handled separately,
and they are no longer activated by the production A2A launcher.

Fast CI includes the updated `mcp-tool-flags.test.ts` and
`r180-production-mcp-boundary.test.mjs` checks. These enforce the
negative startup boundary and non-reachability via the production
launcher; they do not themselves prove running native EVM/Gitea/Docker,
nor do they establish a paid Gemini autonomous repair success.

**Gate:** Fast CI on the R220 source must pass before a new
same-SHA zero-billing Full CI release request. Avoid treating prior
R219 (or R214) results as evidence for the new source SHA. No paid
workflow is authorized, and `main` is unchanged.
