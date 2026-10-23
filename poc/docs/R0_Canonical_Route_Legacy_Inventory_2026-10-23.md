# R0 — Canonical route, integration ownership and legacy inventory

**Work branch:** `refactor/post-prof-plan-contracts-20261021`  
**Starting baseline:** `242b4d15626e3db1e1b267f2bbe3e35b285b0ffd`  
**`main` reference:** `62c5c2f4c81c92218a262204a3f1a5acb00f8867`  
**Approved roadmap:** `Tesi_Delegation_Handoff_Completo_Roadmap_e_Pulizia_23-10-2026.pdf` (R0→R7).  
**Safety rule:** no merge; no Gemini Developer API calls without explicit user authorization.

This is the *source-of-truth integration inventory* for R0, not evidence
that a single full generative run already completed. File classifications
are **initial** and must be revised using actual runtime callers before R6
removes anything. Verification evidence must distinguish real-provider CI,
local process integrations and simulated/model-scripted tests.

## Canonical architecture, in execution order

```text
Requirement + pinned Gitea snapshot
  -> Engineer read-only Planning root
  -> ADK Planner read_repository/list_directory/read_file
     -> Gateway Prepare -> Adapter VP -> Rust verification/OPA -> Gitea
  -> Backend-signed Planning checkpoint (session, Gitea SHA, digest)
  -> authenticated Engineer console + independent signed permission subset
  -> trusted Coordinator: revoke Planning, journal, issue independent root
  -> Gateway activates same signed plan; timed lease via HMAC private IPC
  -> approved A2A dispatcher: bind Task/role/permissions before child DC
  -> Backend / Frontend / Test ADK handler with Task-minimal context
  -> approved MCP tools + PRIVATE cryptographic MCP proof path
  -> Gateway Prepare + signed VP + native Rust verification + OPA
  -> Gitea, Docker Runner, exact-commit acceptance, PR (no automatic merge)
  -> Gateway close, Rust root revocation, durable reconciliation
```

## Critical files and trust boundaries

| Boundary | Authoritative source (relative to repository) | Verified behavior / still missing |
|---|---|---|
| Preliminary and operational roots | `poc/packages/orchestrator-runtime/src/trusted-engineer-authority.ts`, `trusted-execution-coordinator.ts` | Independent root issuance, revocation, plan digest; actual persistence handled separately |
| Planning read transport | `poc/packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts`, `orchestrator-gateway-client.ts` | Exact Gitea SHA, scope and Gateway Prepare→signed VP→Execute. R1 test covers **two file reads plus repository metadata and two directory listings** with five VP/OPA checks; simulated Adapter verifier/policy in this specific test |
| ADK plan compilation | `poc/packages/orchestrator-runtime/src/trusted-adk-planner.ts` | Trusted file list, read budgets and structured **unapproved** plan; no real Gemini Planning E2E yet |
| Checkpoint signature and persistent import | `poc/packages/orchestrator-runtime/src/trusted-planning-checkpoint.ts`, `trusted-planning-checkpoint-store.ts` | Pinned backend Ed25519 signature, session/digest/SHA, no model-owned key; new canonical driver still needed |
| Engineer console + review | `poc/apps/orchestrator/src/engineer-approval-server.mjs`, `poc/packages/orchestrator-runtime/src/signed-approval-store.ts`, `trusted-planning-review-gate.ts` | Password/CSRF, independent Engineer Ed25519 permission subset; offline cross-process test |
| Trusted handoff and crash recovery | `poc/apps/orchestrator/src/trusted-engineer-host.mjs`, `poc/packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts`, `trusted-manual-gemini-handoff.ts` | Revoke before activation; fail-closed journaling; live remote installation not yet shown |
| Signed Task scheduling | `poc/packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts`, `trusted-approved-child-issuer.ts` | Task prebinding, DAG, role, child DC; generic three-agent pipeline in one E2E still pending |
| Three ADK roles | `poc/packages/agent-runtime/src/adk-a2a-handler.ts`, `adk-specialized-agents.ts`, `server.ts` | Generic signed-task path exists; legacy Account Suspension branch/opt-ins remain |
| Shared operational MCP | `poc/mcp-shared/src/catalog.ts`, `http-server.ts`, `task-router.ts` | Tool catalog/validated bearer, not independently security-authoritative; branch assumptions must be migrated |
| Private cryptographic MCP | `poc/packages/agent-runtime/src/trusted-crypto-mcp-bridge.ts`, `poc/mcp-shared/src/crypto-catalog.ts`, `poc/packages/agent-runtime/src/private-mcp-task-registry.ts` | Opaque proof reference; VP not returned to the model. Opt-in today; R1 must connect universally where required |
| Core enforcement | `poc/apps/gateway/src/approved-execution-plans.ts`, `prepare.ts`, `execute.ts` | Signed plan/task/resource/digest checks independent from DC/VP native Rust and OPA; provider checked before effects |
| Deployment control | `poc/apps/gateway/src/main.ts`, `trusted-plan-deployment.ts`, `trusted-plan-ipc.ts` | Single registry instance for HTTP Gateway and owner-only private control, lease renewal |
| GitHub trust boundary | `poc/packages/orchestrator-runtime/src/trusted-github-oidc-intake.ts`, `trusted-admitted-github-handoff.ts`, `trusted-github-oidc-submit.ts` | OIDC real JWT test, HMAC admission, live run recheck; secure deployed runner-host network path NOT present |
| Real provider & acceptance | Gitea and Docker execution scripts under `poc/packages/agent-runtime/scripts/`; cumulative GitHub Actions | Rust/EVM/Gitea/Docker CI tested separately; all-new-architecture single scripted run R3 **pending** |

No module in this table can be retired without checking its importers,
runtime entrypoints, Docker/CI setup, exports and regression tests.

## Early cleanup classification (C0/C1 now; removal only at R6)

| Component | Class / decision | Evidence needed to migrate or remove |
|---|---|---|
| Planning → checkpoint → review → coordinator → signed A2A dispatcher | **A / KEEP** | Core new path. Consolidate call sites, do not duplicate |
| `adk-specialized-agents.ts` approved-Task route | **A + B / KEEP, MIGRATE callers** | Verify tool selection and private signed task constraints with two non-Account-Suspension requirements |
| Opt-in shared/crypto MCP flags and fallback FunctionTools | **B / MIGRATE** | Test same signed Task with MCP/Gateway path; prove no legacy bypass before pruning |
| Legacy fixed `feature/account-suspension` source assumptions | **B / MIGRATE** | Remove only after generic work-branch and file scopes are tested through real provider |
| `.github/workflows/gemini-paid-shared-mcp-final.yml` | **C / RETAIN AS PRIOR EXPERIMENT** | Old paid Gemini proof uses different flow; do not call it the new approved workflow; preserve until R5/R6 comparative analysis |
| `a2a-production-coordinator-mcp-gemini-live.mjs` | **B+C / LEGACY DEMO** | Must not become canonical entrypoint without review/porting of planning+approval |
| `.github/workflows/trusted-gemini-dispatch-preflight.yml` | **A / INPUT VALIDATION ONLY** | No active Planning or Engineer approval implied; not executable E2E |
| `workflow-ui/mock-plan.js` and scripted models | **C / TEST ONLY** | Keep until replacement tests verify same production path |
| `poc/apps/gateway/src/composite-authorization.ts` | **A / KEEP AS AUTHORIZATION-ONLY** | `authorization_only:true` is *not* an atomic provider batch; no batch implementation required for R3 |
| Other possibly unused files | **F / UNVERIFIED** | Not safe to classify as dead using filename or grep alone |
| Build outputs, temporary keys/secrets and local fixtures | **E / ENVIRONMENT** | Exclude from version control; audit CI scripts/.gitignore in R6 |

## Required sequence of next gates

**R0 — Route ownership:** This critical-file map, execution-order diagram and
legacy candidates are documented. The legacy paid workflow remains explicitly
separate. Close R0 after CI verifies new multi-read regression.

**R1 — One authoritative tool/authority route:** Audit ADK FunctionTool and
MCP callers, normalize Task/branch scopes, wire existing crypto MCP bridge
through the real agent runtime, preserve Gateway/Rust/OPA enforcement.
Run positive and denial tests against real Gateway. The completed R1 multi-read
test verifies five authorizations with two distinct file contents; it does
not alone satisfy the complete R1 gate.

**R2 — Generic Planner and agents:** Two distinct application requirements,
real ADK scripted planning, the *same* immutable signed checkpoint and
Engineer subset approval, generic Backend/Frontend/Test dispatch. No
hard-coded transformations that predetermine the code changes.

**R3 — Single unified offline E2E:** Disposable Gitea+OPA+Anvil+Rust Adapter,
Gateway native Rust verifier, approved MCP, three ADK agents, real Docker
tests, PR left open. Models can be scripted **only as decision sources**; the
same runner/handler/provider must be used for a future paid Gemini run.

**R4 — Negative tests and bounded threat model:** Plan/digest/role/permissions,
main write deny, replay, revoked VP, OPA refusal, lease expiry and
reconciliation. Technical Go/No-Go before any billable inference.

**R5 — Gemini real (explicit opt-in):** No API calls without user approval.
Separate GitHub OIDC admission from human Engineer approval and costs.
Evaluate generated plan, implementation, acceptance, safety and billing.

**R6 — Mandatory cleanup:** Build a full dependency graph (imports, dynamic
loads, workspace scripts, workflow files, Docker and env, docs, routes),
migrate active callers, remove dead files **in coherent batches**, run all
regressions and real-provider acceptance after each batch. Preserve only
justified compatibility or experimental evidence. Mark every removed file
with replacement/evidence; fail if unwanted legacy imports remain.

**R7 — Freeze final reproducible thesis:** Final commit, test receipts,
diagrammed trust boundaries, architecture comparison, defense presentation,
remaining explicit limitations and branch protection/merge decision.

## Mandatory operating rules

1. Keep `main` untouched, no automatic PR merge.
2. Test offline autonomously; Gemini only on an explicit user request.
3. A JWT authenticates a GitHub job, *not* software permissions or a human.
4. Tool availability and ADK callbacks never replace Gateway/Core Rust/OPA.
5. Do not delete legacy before the new flow has proven its replacement.
6. Every block must end with a specific SHA, relevant CI jobs, negative-case
   coverage and honest scope of mocks vs. real providers.

**Current blocker for R2/R3:** a canonical executable driver connecting
the existing ADK Planner → signed checkpoint → Engineer review →
TrustedApprovedA2ADispatcher → approved three-agent path, without using
the older preprogrammed Account Suspension workflow.


## R1 branch migration: syntax at MCP, authorization at trusted worker

The common MCP catalog, router and Streamable HTTP handler now accept
syntactically valid `feature/*` branches. This does **not** grant authority:
the private A2A task worker requires the exact active task's trusted branch,
signed operation/path grants and role; Gateway Rust/DC/VP, plan checks,
OPA and provider checks remain independent. A dynamic branch is accepted
only when the trusted A2A handler supplies explicit approved file grants
and scoped file paths. The old Account Suspension branch and static paths
remain locked down for legacy tasks without those grants. The Docker test
profile remains `poc-default`. The signed task worker, not the MCP tool
schema or ADK callback, enforces all branch and file restrictions.
The new tests exercise signed generic Backend read/write and Test create
plus run_tests, and reject different branches, operations and paths.
These are integration regressions, NOT a claim of completed R3 E2E.


## R1 cross-boundary regression: approved generic MCP → Gateway → private VP

A composed offline regression now uses `feature/invoice-sort` through an
actual MCP Streamable HTTP server, authenticated TaskRouter, active private
Agent worker, Gateway normal Prepare/Execute HTTP routes, an independently
activated `TrustedApprovedExecutionPlans` session and the PRIVATE crypto-only
MCP VP path. The immutable approved plan pins Task, agent DID, path,
operation, branch, SHA, digest and lease. A valid call completes one provider
operation; wrong branch, path or tool cannot reach the Gateway/provider.
A denied OPA decision and trusted plan closure both block provider effects.
The Gateway verifier, OPA decision, VP-issuing Adapter and provider execution
are instrumented **test doubles**; actual plan/Gateway/MCP/HTTP/task logic is
used unchanged. This is the R1 composition evidence, NOT the final R3
Gitea+OPA+native Rust+EVM+Docker unified E2E or independent human signature.


### Independent Engineer signature used in R1 composition

The composed R1 test now loads its plan and permission subset through the
actual owner-only SignedEngineerApprovalFileStore: a disposable Ed25519
Engineer key signs the canonical plan and receipt, and the Gateway verifies
its signature, key pin, session and validity window before activation.
The test does not simulate an authenticated human GUI click and must not be
reported as human consent. Browser login/CSRF/approval are separately tested.


## R2 composition gate: ADK proposal to signed DAG (offline)

The new `trusted-reviewed-adk-dag.test.ts` exercises the **same actual** ADK
Planner, signed backend Planning checkpoint, immutable Review Gate, owner-only
Engineer Ed25519 receipt, real TrustedExecutionCoordinator, Gateway
ApprovedExecutionPlans, signed plan A2A dispatcher, DAG dependency checks,
Gateway Prepare/Execute and normal task-completion evidence, sequentially in
one session. Two entirely distinct requirements (`invoice-sort` and
`audit-dashboard`) prove work-branch and file selection are not pinned to
Account Suspension. A third scenario denies a partially Engineer-approved
DAG before provider effects. Only the LLM decisions are scripted; credential
issuing/revocation, VP Rust verifier, OPA and provider operations remain
bounded offline fixtures (and role A2A transport remains stubbed), so R3 still
requires real native Rust/OPA/Gitea/Docker and A2A in ONE run. This test
provides an integration contract, not an automatic human approval capability.


### R2: shared Planner output driving the existing real A2A/ADK transport

Rather than creating a parallel mock A2A implementation, the existing
`trusted-approved-three-adk-a2a-offline.test.ts` now accepts an optional
**genuine ADK Planner-generated, grounded, unapproved Task plan**. It signs
that output with a separate Planning backend Ed25519 key, verifies its
pinned checkpoint, then feeds the same plan to the existing independent
Engineer Ed25519 receipt store and the existing signed approved-DAG
Dispatcher. The *same three live* Backend, Frontend and Test Node agent
servers communicate over the A2A SDK/HTTP transport and their own ADK
Runners. An out-of-scope Backend tool call stops the DAG before Frontend/Test.
The model decisions are offline scripted. The old test fixture still mocks
Adapter/VP, Rust/OPA, Gitea and Docker provider operations and simulates the
Coordinator; a real Planning-to-Execution root lifecycle is separately
verified in `trusted-reviewed-adk-dag.test.ts`. These two slices converge
on the same production dispatcher, but R3 still requires one run joining
**both** slices and real providers with the same entrypoint.


### R2: canonical scoped child issuer + live three-Agent A2A

The new composite R2 case additionally calls the existing production
`TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority` factory rather
than a bespoke fixture issuer. The real `TrustedApprovedPlanChildAuthorityIssuer`
derives each delegated child's *exact operations/resources* from the
Engineer-signed plan and the trusted operational parent. A small HTTP
Adapter response fixture stands in for real Rust issuance; the returned
credential is checked for permission amplification. The same actual
HTTP A2A SDK, ADK models and Backend/Frontend/Test agent servers are used
without duplicating their implementations. A malicious Adapter response
that expands a child's scope fails before Backend A2A execution; Frontend
and Test never start. Rust issuance/VP, policy and provider remain test
doubles, and the trusted root coordinator in this test is a minimal fixture.
The next R3 milestone is to replace those fixtures with real services in a
single disposable CI topology, not to rewrite the A2A transport.


### R3 bridge: same native Gateway for read-only ADK Planning and three-Agent EVM execution

The native EVM 3-role script now obtains a *real Rust-issued preliminary
Planning root first*, registers the Gitea SHA in TrustedPlanningRevisions,
and runs the existing TrustedAdkReadOnlyPlanner with a source read through
the real TrustedPlanningGatewayReadPort and SAME GatewayRuntime's Prepare/
Execute, Adapter-signed VP, native Core Rust verification and live OPA.
The underlying repository contents are **pinned fixture data** in this job,
not actual Gitea. After ADK produces an unapproved plan, a distinct backend
Ed25519 key signs its checkpoint and TrustedPlanningReviewGate verifies it.
An independently signed Engineer receipt is then verified and the real
Coordinator revokes the preliminary root before issuing the operational
root. The existing three real ADK/A2A agent servers execute that SAME plan
through native Rust-signed task child credentials and OPA; Gitea/Docker
write results are still fixture-backed here. A model-directed wrong Backend
path and a closed operational root must fail, exactly as before. This
*reduces* the number of independent fixture boundaries but is not the final
R3 real-provider E2E. It makes no paid API calls.


### R3 Planning invariant: branch creation is a real protected Task

The initial native EVM CI revealed a genuine contract mismatch: the ADK
Planner correctly rejected a three-Agent DAG lacking the required initial
Orchestrator `create_branch` Task. The native integration now uses a FOUR
Task DAG: branch → Backend → Frontend → Test. Its first Task is executed
through normal Gateway Prepare, the real operational Rust DC signed VP,
Core Rust verification and live OPA, and its mocked provider produces a
corroboratable Gitea-shaped branch effect. The signed DAG cannot advance
to Backend without that successful trusted provider observation. The
negative Backend test now expects only branch completion; Frontend/Test
must still never run. These contract rules were not weakened to make the
test pass, and `main` is never modified.


### R3 integration: ONE positive real-provider E2E now uses shared MCP

The existing native EVM+Gitea+Docker positive DAG offers an explicit
`APPROVED_RUNNER_NATIVE_MCP=1` mode. It retains the **same** signed
Planner proposal, Engineer receipt, Rust-issued EVM root and task children,
trusted Dispatcher, three live ADK/A2A servers, normal Gateway Prepare/
Execute, native Rust verifier, OPA, disposable Gitea, controlled Docker
Runner and independently mounted acceptance suite. Only the tool transport
changes: model-facing read/update/create/run_tests use the shared MCP server,
a private signed-Task worker per Agent and a separate private crypto-only
MCP service to request the signed VP. Private signing material stays in the
Agent runtime and Adapter closures, never an LLM tool argument. The offline
cumulative workflow enables this mode for its existing real positive test;
no new pipeline, paid Gemini invocation, or unconditional legacy deletion.
The real-provider acceptance still uses the historical Account Suspension
reference fixture, rather than demonstrating generation of arbitrary code.
The separate R2 scenarios exercise generalized work branches and requirements.
