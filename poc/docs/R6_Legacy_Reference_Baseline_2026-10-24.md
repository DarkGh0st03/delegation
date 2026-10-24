# R6 — Legacy reference baseline and conservative cleanup gate

**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**Inspection baseline:** `eca214b5f44f073730ef9e4956fee53d464acf37` (24 October 2026).  
**Main unchanged:** `62c5c2f4c81c92218a262204a3f1a5acb00f8867`.  
**Deletion decision:** **NO FILES REMOVED IN THIS PASS.** Every historical
entrypoint listed below has a known reason to retain it, or still requires
full source/dynamic-caller audit. Never run Gemini to test cleanup.

## Evidence snapshot

- Git tree at the inspection commit has **497 tracked blobs**, no truncated
  tree response, and **27 workflow definitions** under `.github/workflows/`.
- The new signed flow uses `trusted-adk-planner.ts`,
  `trusted-planning-checkpoint-store.ts`, `trusted-planning-review-gate.ts`,
  `trusted-execution-coordinator.ts`,
  `trusted-approved-a2a-dispatcher.ts`, `trusted-approved-child-issuer.ts`,
  the shared MCP Gateway path, and the Rust Adapter/Core verifier + OPA.
- `.github/workflows/cumulative-refactoring-offline.yml` runs approved-plan,
  Node/ADK/A2A/MCP, Core Rust, signed/native EVM, Gitea and real Docker
  acceptance; its legacy references remain intentional compatibility tests.
  It **does not** call a model provider.
- `.github/workflows/gemini-paid-shared-mcp-final.yml` still invokes
  `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`
  and the historical Account Suspension scope check. It is **NOT** the
  new Engineer-approved trusted Planning/Execution driver. Do not dispatch
  it as the final R5 proof, even though its historical consent-input guard
  exists. Both script and workflow are historical experiment evidence.
- `.github/workflows/shared-mcp-production-coordinator.yml`,
  `shared-mcp-real-positive-e2e.yml`, and
  `disposable-simulated-approval-merge.yml` invoke separate legacy smoke
  scripts and therefore still have active CI/workflow consumers. The latter
  simulates merge approval in disposable Gitea; this is NOT an instruction
  to merge the actual thesis branch.

## Cleanup classification from observed callers

| File group | Decision today | Evidence / unblock requirement |
|---|---|---|
| `poc/packages/orchestrator-runtime/src/trusted-*.ts` plus signed review stores | **KEEP — canonical** | Signed checkpoint/Engineer/authorized DAG flow, current dedicated and cumulative test callers |
| Gateway/Rust/Core/OPA, `poc/mcp-shared`, private IPC and Docker/Gitea runner | **KEEP — security/provider boundary** | A2A callbacks do not authorize tools without Gateway; CI exercises these providers |
| `sequential-coordinator.ts` and `sequential-coordinator.test.ts` | **MIGRATE/RETAIN TEST** | Historical 11-file Account Suspension flow; check all imports, dynamic loaders and old scripts before migration |
| `a2a-production-coordinator-mcp-gemini-live.mjs` plus paid workflow | **RETAIN AS HISTORICAL, NEVER R5 ENTRYPOINT** | Old paid workflow invokes it; protect evidence while designing separate approved-plan Gemini driver |
| `a2a-production-coordinator-mcp-isolated-{smoke,pr-open-smoke,real-positive}.mjs` | **RETAIN UNTIL HISTORICAL CI RETIRED** | Several configured workflows still execute them; preserve real-provider comparison |
| `check-account-suspension-reference-scope.mjs` and Account Suspension fixture | **RETAIN, FLAG GENERICITY DEBT** | Invoked from cumulative baseline and historic workflows; replacement needs generic multi-repository source acceptance |
| `poc/workflow-ui/mock-plan.js` | **KEEP TEST-ONLY** | UI fixture must not be confused with independent Engineer signature |
| Old `phase11`, `phase12`, native, multipermission and catalog workflows | **REVIEW OVERLAP, DO NOT DELETE YET** | Security/reproducibility tests may exercise distinct threats beyond the cumulative gate |
| Legacy environment/template paths and local fixtures | **KEEP UNTIL REF GRAPH CONFIRMS** | Existing `check:scaffold`, import checker, Docker/compose references, native Rust and scripts |

## Reference-audit command (read-only)

`npm --prefix poc run audit:r6:references`

Optional machine-readable: `node poc/scripts/r6-legacy-references.mjs --json`

The small inventory utility reads only **Git-tracked** textual files and
records literal full-path or basename observations for known legacy targets.
It labels references as workflow, workspace script/config, JS/TS source,
deployment, or documentation. It is also executed in the cumulative Node
job and tested with synthetic references. No program is executed, no
credential is read, no file is deleted.

**Important precision:** this is a FIRST PASS, **not** a complete import/
runtime graph and not deletion authority. String/AST dynamic imports,
runtime-generated paths, external code, GitHub Actions `uses:` actions,
transitive Docker/Compose entrypoints, Bash substitutions, and test
fixtures require manual or dedicated follow-up. A missing literal match
is `UNVERIFIED`, not `UNUSED`. A path mentioned only in prose is not
proof of a live runtime caller.

## R6 next mandatory gates

1. Resolve all direct import/export and `import()` references into paths,
   plus package scripts, CI jobs, Shell/Compose/Docker startup, tool
   registrations and provider modes. Record file `→` actual caller, not
   solely a text match.
2. Migrate *active* historical callers to the same new signed plan/Task
   path, or explicitly isolate them as historical experiments with
   matching still-executed regressions. Do not redirect paid Gemini to an
   unsigned coordinator.
3. For every proposed deletion record **old path, proven callers,
   replacement, all denied/allowed test evidence and rollback commit**.
   Remove in coherent batches only after existing exact-SHA/Gitea/Docker
   and Rust/OPA cases are green.
4. After each cleanup batch run the cumulative pipeline **on the exact
   changed SHA**, including full native EVM real-provider acceptance, not
   only fast Node tests.
5. Finish R6 by checking that no unintended legacy route can supply or
   bypass new planning/approval authority. Keep `main` untouched and R5
   billable execution blocked without express user approval.

**Boundary:** the existing native E2E uses two scripted requirements on
the same IAM Console base repository. It is not a real Gemini-generated
implementation across arbitrary repositories, and a legacy file cannot
be declared removable merely because an offline positive test passes.


## R6 migration 1 — isolate legacy coordinator from canonical exports

The canonical `poc/packages/orchestrator-runtime/src/index.ts` **no longer re-exports** `sequential-coordinator.ts`. Four historical MCP coordinator scripts (including the archived paid Gemini variant) now explicitly import that historical implementation from its source file. The old sequential coordinator unit tests also use its direct import. This **does not delete or rewrite historical results** and does not make the legacy paid workflow eligible for R5. A static regression asserts the public barrel does not accidentally re-export the obsolete coordinator and checks that each historical script keeps its explicit dependency. Full runtime/CI evidence must be green before any further cleanup. `main` remains untouched.


### R6 parsed direct import graph (migration follow-up)

The inventory now parses tracked JavaScript/TypeScript ESM **without evaluating any file** and emits `staticImporters` separately from raw textual matches. This distinguishes a real direct `import` or `export ... from` from a comment, documentation mention or runtime-generated path. Type-only imports erased at runtime are not claimed as edges; Node's type stripping retains `export {} from` for an all-type re-export, so the parser conservatively counts its module edge. The audit command requires Node 22 with `--experimental-vm-modules --experimental-strip-types` and runs in the cumulative CI. A static edge remains only one part of the graph: dynamic imports, package aliases, `require`, npm/Actions execution, shell, Docker and external providers are not automatically resolved. No missing static edges may authorize deletion.


### R6 configured launchers (24 October 2026)

`audit:r6:references` now adds a separate `configuredCallers` category: workspace `package.json` scripts, executable `run:` steps in Actions workflow YAML, one-hop `npm --prefix ... run ... -w <workspace>` calls, shell-script statements and Docker Compose configuration mentions. This is a **conservative configuration observation**, not a guarantee that a job runs or proof that a file is safe to delete. GitHub `paths:` filters and comment-only matches are deliberately excluded from executable-workflow counts. Static ESM importers remain separate from configured commands; both must be reviewed together, including external/indirect and dynamic invocations. No cleanup authorization follows from an empty list.


### R6 runtime dynamic references (conservative hints)

The read-only inventory now distinguishes literal dynamic import(), require() and module-relative new URL() references as runtimeIndirectionHints. It does not run the code or assert the import was executed. Computed module names are collected in unresolvedRuntimeIndirections and prevent interpreting a missing match as unused code. The lexical scanner skips comments and regular strings, but is not a complete JavaScript AST; template interpolation, aliases and custom loaders remain review blockers. Static ESM imports, npm/Actions commands and these hints are reported separately. No automatic deletion follows from an empty list.

### R6 cleanup batch 1 — remove obsolete populated-directory placeholders

Four `.gitkeep` files were removed from already populated, tracked
directories: `poc/apps`, `poc/packages`, `poc/opa`, and
`poc/runner/acceptance`. The Git tree showed 104, 168, 3, and 4
other tracked files beneath these directories, respectively. Git does
not require a placeholder to retain a directory containing tracked files.

`poc/scripts/check-scaffold.mjs` checks actual directory and file
paths, not these `.gitkeep` markers. No application imports, workflow
commands, Docker entrypoints, Rust modules, historical evidence, or
security tests are changed by this deletion. **Rollback:** restore the
four blobs from commit `9671ab1a9073dbda67d7bb54b0d9a3e01fbb6963`. The full cumulative CI must still
finish green at the deletion commit before this batch is certified.


### R6 docs cleanup — canonical Orchestrator README

The old 661-line `poc/apps/orchestrator/README.md` mixed obsolete Stage 9–12 milestones with the statement that the historical sequential Coordinator was the **current** execution path. It has been replaced with a concise map of the actual signed Planning/Execution path, explicitly segregated legacy bootstraps, command-level offline checks, service deployment prerequisites, and pointers to the existing R0/R4/R5/R6 handoffs. The old text remains recoverable at `05c0859ff20c8e3496b98cb5542506a98f261521`. No historical scripts or tests were deleted. The R5 service command was also corrected to target the manifest that actually defines `engineer:service` (`poc/apps/orchestrator/package.json`); the root `poc/package.json` does not expose that command.


### R6 cleanup batch 2 — retire unsigned historical root-bootstrap CLI

**Deleted:** `poc/apps/orchestrator/src/bootstrap-engineer.ts` (60 lines). **Removed command aliases:**
`bootstrap` from `poc/apps/orchestrator/package.json` and `orchestrator:bootstrap` from
`poc/package.json`. The historical CLI issued a broad IAM Console root
with `issueOrchestratorRoot` and no independent signed Engineer-approved
plan. It must not be an alternative startup path beside the R5 trusted
Planning/Execution Coordinator.

**Callers examined:** 27 Actions workflow definitions (no direct CLI or
npm-script invocation), two package manifests (both commands removed),
`check-scaffold.mjs` (only directory and gateway prerequisites), and
Orchestrator README (rewritten). The `SoftwareEngineerAuthorityBootstrap`
client, `authority-client.ts`, delegated permission templates, old
sequential experiments and their security tests are **retained**.
A new static npm-manifest test fails if the legacy root CLI or either
of its command aliases is accidentally reintroduced. **Rollback:**
recover the deleted CLI and both npm script entries from commit
`28ca28c688137504958f6c56f7a297a7b556260a`. This batch does **not** claim that a local Engineer service
is already deployed or that R5 paid Gemini is safe to run.


### R6 cleanup batch 3 — retire obsolete Phase 6 ADK Orchestrator wrapper

**Removed:** `poc/packages/orchestrator-runtime/src/adk-orchestrator.ts`
(169 lines) and its dedicated Phase 6/7 test
`test/adk-orchestrator.test.ts` (141 lines). This obsolete wrapper
exposed a model-callable `run_account_suspension_workflow` FunctionTool
to invoke the old sequential Account Suspension coordinator. The signed
two-phase Engineer/Coordinator/DAG runtime no longer uses such a
model-selected privileged workflow call.

**Caller evidence:** reviewed the orchestrator-runtime `src/*.ts`
and `test/*.ts` import/export uses; the only in-package consumer
of `AdkAccountSuspensionOrchestrator` was the removed historical test
plus the wildcard public `src/index.ts` export. The four historical
MCP coordinator scripts call the separate
`AccountSuspensionSequentialCoordinator` directly and remain intact.
The old OpenAI ADK provider implementation and independent adapter
tests remain intact; this change does **not** remove or claim to
replace those provider tests. The current trusted dispatcher test
suite separately checks denial on false/unsigned task evidence,
duplicates, failed Gateway attestation and DAG dependencies.

**Preserved:** the 57-line Account Suspension interface preflight and
its tests, including the old paid-workflow script that uses it; the
historical paid script now imports that preflight **directly** rather
than through the signed runtime's canonical barrel. The old paid
workflow remains **R5 NO-GO** and was not executed.

**Rollback:** recover the two deleted files and the old exports/import
bindings at commit `aa17bb63f83152a93d1370b2c789a60d21b38dd9`. A new R6 regression prevents accidental
reintroduction. No claim of complete dynamic-reference proof is made:
the full cumulative exact-SHA CI must confirm the replacement and
historical test compatibility before certifying the cleanup.


### R6 cleanup batch 4 — enforce historical coordinator isolation

**Scope:** no legacy workflow or coordinator was removed in this batch.
The existing AST-based R6 reference scanner now enforces a *narrow
allowlist* of static importers of `sequential-coordinator.ts`: four
explicit historical Account Suspension coordinator scripts and
`sequential-coordinator.test.ts`. A new canonical import/re-export
fails the offline `audit:r6:references` command. Two tests demonstrate
denial of a new static re-export, approval of explicitly historical
callers, ignoring prose/comments, and a full checkout scan.

This is a prevention gate, not proof of dead code: computed dynamic
imports, CommonJS, runtime CLI/Docker paths and external callers remain
separately unresolved in R6. The historical paid workflow remains
**R5 NO-GO** as a demonstration of the new signed architecture.

The root README now presents the canonical signed Planning/Engineer/DAG
path before a clearly marked 15 October historical baseline. The exact
15 October Gemini success remains valid for its old commit, not the
current refactoring.

**Rollback:** revert this commit on the refactoring branch to
`d6748406c73e954021e70a4973ec90f0563eb07d`. No change to main
or paid API calls. Validate the full five-job cumulative CI at the
new exact SHA before certifying this batch.


### R6 cleanup batch 5 — dynamic/module and direct launcher fence

The conservative tracked-source inventory now applies the existing
five-file historical coordinator allowlist to **explicit literal runtime
edges** (`import('./...')`, CommonJS `require('./...')`, and
`new URL('./...', import.meta.url)`) in addition to parsed static ESM
imports. It also rejects newly configured npm/Actions/Shell/Compose
commands that directly invoke the historical coordinator. The latter
are not implicitly allowlisted just because they are old; no current
manifest or intended workflow needs to call that source file directly.

Two additional offline tests prove that a historical permitted dynamic
import is accepted, while a new dynamic import, CommonJS load, module
URL and GitHub Actions launch are rejected. Comment-only references
must remain inert. The checkout test checks for newly introduced
indirect/configured caller edges. This is a **boundary guard, not a
dead-code detector**: computed paths and external loaders stay
unresolved, and removing legacy files still requires independent
static+dynamic and provider evidence.

**Documentation consistency:** `docs/CURRENT_CHECKPOINT.md` retains
the full October 15 historical evidence unchanged but is now prefaced
with an explicit refactoring-branch notice, canonical source pointers,
and the R5 NO-GO rule. This prevents the earlier sequential flow from
being mistaken for the current security design.

**Rollback:** revert batch 5 to parent commit
`303af680abee65dccca9bd5393c33f13bf9ccda5` on the
refactoring branch. No changes to source `main`, no calls to paid
models and no deletion of historical coordinator or provider tests.
Certify only after the full exact-SHA cumulative five-job CI succeeds.

### R6 cleanup batch 6 — isolate historical Account Suspension state machine

The Orchestrator runtime public barrel no longer exports `workflow.ts`
(`AccountSuspensionWorkflow`, fixed requirement and branch constants).
This is the obsolete Phase 9B sequential state machine, not the new
Engineer-signed Task DAG. The historical sequential coordinator already
imports it directly; its dedicated `workflow.test.ts` now does likewise.
The generic artifact validator in that test is imported explicitly from
`artifact-validation.ts`. The old behavior and source implementation are
preserved, including the historical paid workflow and regression tests.

The R6 source audit now treats `workflow.ts` as a legacy candidate.
Only the historical sequential coordinator and its test can refer to it
through direct ESM imports or literal indirect/configured entrypoints.
New public-barrel exports, canonical direct imports, dynamic literal loads
and executable launchers fail the offline guard. Synthetic and checkout
regressions exercise accepted versus rejected static/dynamic edges.

**Limits:** This is not permission to delete the old state machine or
evidence that all dynamic/external loaders have been examined. We retain
the full previous Account Suspension evidence, do not change trusted
Rust/OPA/Engineer enforcement and do not run paid Gemini.

**Rollback:** revert to `4834fceef57055914105790b912e7bfd3ca9d27c`
on the refactoring branch. Certify only after 5/5 cumulative offline CI
jobs complete successfully on this exact commit.

### R6 cleanup batch 7 — extract permission type from frozen IAM Console matrix

**Finding:** `permission-templates.ts` contains hard-coded Account
Suspension file/branch and skill matrices. Its broad root and
role-template values still support historical
`SoftwareEngineerAuthorityBootstrap.issueOrchestratorRoot` and
`DeterministicOrchestratorAuthorityIssuer` and their regression suites.
Those old methods remain unchanged and may not be used as the canonical
Engineer-approved operational path.

**Refactor:** move the identical `TemplateOperation` union and
`DelegatedPermission` interface to the new,
authorization-neutral `delegated-permission.ts`. The old template
module re-exports those two **types** for legacy compatibility, while
the public Orchestrator runtime barrel exports only the neutral types,
**not** the static permission matrix. The Engineer trusted root,
Task-scoped child issuer, and shared Adapter client use the new type
directly. The historical `permission-templates.test.ts` obtains its
frozen IAM Console fixtures from an explicit legacy import.

**Security:** only type-import locations and API exports change; signed
plan validation, attenuation, native Rust/DC/VP, Rego OPA and actual
Gateway provider effects are unchanged. Static `rootAuthorityPermissions`
is retained for the historical path, NOT promoted into Planning/Execution.
The new checkout regression prevents the broad permission matrix from
being re-exported by the canonical barrel.

**Evidence/limits:** full five-job exact-SHA offline CI is required
before this batch is certified. Deletion of `permission-templates.ts`,
`authority-client.ts`, `orchestrator-gateway-client.ts` or
`merge-readiness.ts` would be unsafe: the last two have active
trusted Planning or human merge dependencies. No paid Gemini inference
and no source main merge.

**Rollback:** revert this commit to parent
`760428162f7ee18d65f5d35fd502c99c4dd2780a` on the refactoring
branch.

### R6 batch 7 follow-up — authority test import regression

The first CI on commit `ecda95ea91f533cead3de209319c9f743dc20006`
failed the Orchestrator regression because
`test/authority-client.test.ts` still imported `DC_BACKEND`,
`DC_TEST` and `ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY` from the
canonical barrel. The runtime intentionally no longer exports those
static matrices. The trusted issuer, signed approval, independent
DC/VP authorization and Gateway regressions preceding that import
completed successfully; do **not** call the original run green.

**Fix:** migrate this historical test to explicitly import its frozen
fixture values from `permission-templates.ts`; keep the production
Adapter client imports as before. Add a static regression asserting
the explicit fixture dependency and continued absence of the legacy
matrix from the public barrel. No widening of production exports,
security rules or credential permissions.

**Evidence needed:** re-run the exact-SHA cumulative and dedicated
Engineer/ADK/A2A tests. Keep both commits in Git history; no merge to
source `main` and no billable model call.

### R6 cleanup batch 8 — explicit historical static authority API

The previous type extraction left the class
`DeterministicOrchestratorAuthorityIssuer` exported by the canonical
`orchestrator-runtime/src/index.ts` wildcard. This class obtains a role's
frozen Account Suspension permissions from
`permission-templates.ts`; it is **not** the independent signed-Plan
`TrustedApprovedPlanChildAuthorityIssuer`.

**Change:** The canonical barrel now exposes only the shared credential
**types** and `SoftwareEngineerAuthorityBootstrap`, not a wildcard of
`authority-client.ts`. A new explicitly named
`legacy-authority-client.ts` re-exports the unmodified historical
`DeterministicOrchestratorAuthorityIssuer`. Four historical
Account Suspension coordinator scripts and
`authority-client.test.ts` now import the old class directly from that
legacy module. Their other public client imports are unchanged.

`SoftwareEngineerAuthorityBootstrap.issueOrchestratorRoot` remains
available for comparison to the historic Phase 9A root, but is
documented `@deprecated`. **Trusted approved Execution must continue
to call `issueScopedOrchestratorRoot`, whose runtime exact-permission
validation is untouched.** Do not claim that the legacy method was
deleted or made intrinsically inaccessible by this API cleanup.

**Guard:** the R6 inventory adds the named historical wrapper and
permits only the four specified scripts plus the old authority test as
static/dynamic/configured callers. Synthetic and current-checkout tests
enforce that new canonical code does not import the wrapper, and the
runtime test asserts the old class is absent from the public index.
A computed require/import and external consumer remain out of the
inventory's proof scope.

**No auth behavior changes:** Adapter transport, root issuance payloads,
Ed25519 Engineer approval, Rust DC/VP, Gateway, OPA, Gitea and merge
restrictions are unchanged. The historical paid Gemini workflow remains
R5 **NO-GO**, never executed during this batch. No merge to `main`.

**Rollback:** revert this batch to
`ef6bad3a20de775c58c298a3487433d1e746407a`. Exact-SHA offline
cumulative and dedicated authority CI results are required to certify it.

### R6 cleanup batch 9 — old Engineer fixed-root method isolated

**Risk:** the canonical `SoftwareEngineerAuthorityBootstrap` class
still exposed `issueOrchestratorRoot()`, using the historical frozen
Account Suspension `rootAuthorityPermissions()` union. This is
not an Engineer-reviewed permission subset.

**Implementation:** Move this method (including its input validation,
Adapter endpoint, JSON payload and response handling, unchanged)
to `LegacySoftwareEngineerAuthorityBootstrap`, a subclass which
stores the original private Adapter config for the old request. The
canonical Engineer class now exposes only
`issueScopedOrchestratorRoot()` and `revokeRoot()`.
The explicit `legacy-authority-client.ts` exports the historical
subclass and static-template child issuer. Four legacy scripts import
the subclass under their original local bootstrap name, leaving
call sites and provider semantics unchanged. The fixed-root unit test
uses the subclass; the scoped Engineer and revocation tests keep the
canonical class.

**Regressions:** test that the trusted prototype cannot issue the
old broad root, while historical roots and child templates remain
testable; a separate checkout test verifies the API and all four
historical script imports. Do not delete old sources.

**Scope:** no change to signed plan, Rust DC/VP, Adapter credentials,
OPA, Gateway, ADK/A2A, Merge policy or provider checks. The historical
paid Gemini workflow is still **not R5** and was not executed.
Require exact-SHA cumulative/offline authority and A2A CI success.
Rollback to `640b672cb085f5ecd0d997c7718333f923597a77`.

### R6 batch 9 CI correction — multiline historical export assertion

The cumulative offline run `40082595663` correctly reported one failure
in the read-only import audit test: a historical test still expected
`export {DeterministicOrchestratorAuthorityIssuer}` on a single
line, while the new historical module explicitly exports two classes
in a multiline ESM export. The protected Engineer and A2A dedicated
CI checks passed. No native security enforcement failed.

**Correction:** replace the outdated, formatting-sensitive assertion
with a stricter ESM export check that requires **both**
`DeterministicOrchestratorAuthorityIssuer` and
`LegacySoftwareEngineerAuthorityBootstrap` in the legacy wrapper.
No runtime class, credential or Gateway policy is changed. Re-run the
whole exact-SHA cumulative suite; do not treat the original run as green.

### R6 cleanup batch 10 — physically isolate historical authority implementations

Before this batch the new canonical `authority-client.ts` still
defined the old fixed-root `LegacySoftwareEngineerAuthorityBootstrap`
and fixed-role `DeterministicOrchestratorAuthorityIssuer`.
This also made it runtime-import the old Account Suspension permission
matrix even though those classes were hidden from the public index.

**Files:** The two *unchanged historical class bodies* are now
physically defined by `legacy-authority-client.ts`, retaining the
broad-root `rootAuthorityPermissions()`, static
`resolveDelegationTemplate()` and original historical Adapter
requests. The canonical `authority-client.ts` now contains only
`SoftwareEngineerAuthorityBootstrap` and its neutral credential
types, with `issueScopedOrchestratorRoot()` and `revokeRoot()`.

**Shared boundary:** Move the original input validation,
`AdapterClientConfig` and `postCredential()` helper to the
internal `authority-adapter-transport.ts`. Neither this transport
nor the legacy class module is exported from canonical
`orchestrator-runtime/src/index.ts`. A type-only import of the
credential contract in this transport has no runtime side effects.
The Adapter HTTP request formatting, retries/timeouts, Bearer
authentication, parse/errors and permission response equality
remain as before. The model cannot authorize itself.

**Tests and R6 guard:** Update static audit tests to examine the
two physical source files (not merely the named exports). Keep the
existing runtime authority tests covering historical root,
historical child, trusted scoped root and terminal revocation.
The R6 legacy import graph still allows only four historical agent
scripts plus the dedicated test to import `legacy-authority-client.ts`.
No legacy artifacts are removed in this batch.

**Limits:** This refactor does not make private source imports
cryptographically impossible; Rust DC/VP and Gateway+OPA enforce
permission irrespective of TypeScript module layout. R5 remains
NO-GO pending real reviewed Gemini end-to-end integration.
Require all five exact-SHA cumulative CI jobs and dedicated
offline authority and A2A tests to certify. Revert to
`2b9ab897f08ed1ea1a53c162cbda53fee27d21eb` if needed.
No merge into `main` or paid model call.

### R6 cleanup batch 11 — no frozen IAM templates in canonical trusted modules

**Observed residual dependency:** after the physical authority split,
`trusted-execution-coordinator.ts` still imported the
`DelegatedPermission` *type* from `permission-templates.ts`.
That import is type-only (no runtime credential escalation) but
undermines the source-level separation from the historical IAM Console.

**Change:** import the identical neutral type from
`delegated-permission.ts`. Add the frozen template file to the tracked
R6 inventory and a **conservative fail-closed static import fence**
covering `src/trusted-*.ts`, public `src/index.ts`, the canonical
`authority-client.ts` and internal
`authority-adapter-transport.ts`. These canonical modules cannot
import, re-export, dynamically load with literal paths or configure a
direct launcher for `permission-templates.ts` without failing
`audit:r6:references`.

**Historical evidence and parser limit:**
`legacy-authority-client.ts` intentionally uses the frozen role/skill
matrix, as do historical regression fixtures. The AST-based scanner
sees static *runtime* edges and literal CommonJS/dynamic edges but
`stripTypeScriptTypes` erases type-only imports before
`SourceTextModule` parses the dependencies. Consequently a separate
**conservative tracked-source textual assertion** checks every
`src/trusted-*.ts`, the canonical index, Engineer client and private
Adapter transport for ANY mention of `permission-templates.ts`,
including type-only imports. Such a comment mention is intentionally
reviewed as a possible false positive instead of silently passing.
The scanner does not establish deletion safety or catch computed
dynamic imports and external loaders. Synthetic tests verify the
runtime graph limitation and protections; the checkout test checks
the actual Git-tracked canonical source tree.

**Security impact:** no runtime code path, native Core Rust DC/VP,
OPA policy, Engineer-signed approvals or Adapter request changed.
This is a type-only import migration and a protective R6 regression
gate. Require full exact-SHA offline CI, with no paid Gemini call.
Rollback to `5e3cfde8dd224a7f79d5396c621918ed6d5d0bc7`.

**Test correction before certification:** the initial batch-11 test
had expected a type-only import to appear in the ESM parser's runtime
dependency graph. A direct Node 22.16 check established that
`stripTypeScriptTypes` erases such imports. The test now explicitly
requires their absence from the graph, and the separate conservative
tracked-source check covers type-only imports in the protected module
set. This is not a relaxation of native authorization checks.

### R6 cleanup batch 12 — opt-in historical Gateway branch/PR writer

**Remaining issue:** the canonical `orchestrator-runtime/src/index.ts`
still star-exported `OrchestratorProtectedGatewayClient`, including
`createFeatureBranch()` and
`createAccountSuspensionPullRequest()`. Those methods are frozen to
`feature/account-suspension` and the old fixed Pull Request title.
They do NOT belong to the approved-plan Task DAG API, even though the
same class also provides `readPlanningResource()`.

**Change:** the canonical barrel now exports only the shared
`OrchestratorGatewayClientError` from that module. A clearly named
`legacy-orchestrator-gateway-client.ts` re-exports the unchanged
historical client and its fixed branch/PR result types.
The four old Account Suspension coordinator scripts and the dedicated
Gateway client regression import it explicitly. The active
`TrustedPlanningGatewayReadPort` retains its direct import of the
underlying implementation and still enforces read-only, pinned,
credential-bound Gateway operations before calling it.

**Guard:** add the legacy wrapper to the tracked R6 import inventory,
allow only the four old scripts and dedicated test, and make an
unexpected static ESM import, literal dynamic import/require, or
configured command fail the audit. Synthetic tests ensure a new
canonical re-export or trusted dynamic import fails while comments
and the authorized historical import remain inert.
A runtime export test confirms the old writer is absent from
the canonical public API.

**Scope and limitation:** no client transport, cryptographic
challenge, VP, Gateway, OPA or Gitea provider behavior is modified.
The Planner still instantiates the same implementation internally,
which means its code module still physically contains the write
methods. This batch removes public API exposure and prevents new
opt-in wrapper consumers; a later source split, with separate
read-only and historical write classes, may eliminate that residual
co-location. Exports alone are not an authorization mechanism.

**Safety:** retain all old tests and scripts until fully retired,
leave `main` unchanged, and do NOT invoke the historical paid Gemini
workflow as R5. Require the five-job offline cumulative CI on the
exact new SHA before certifying. Rollback to
`d193447bff345b613f28cf802c965d665108d209`.

### R6 cleanup batch 13 — physically isolate protected Planning reads from the historical Gateway writer

Prior to this batch, `TrustedPlanningGatewayReadPort` instantiated a
`OrchestratorProtectedGatewayClient` that also contained historical,
fixed Account Suspension `createFeatureBranch()` and
`createAccountSuspensionPullRequest()`. Hiding the class from the
canonical barrel did not remove those write methods from the object.

**Change:** move the unchanged Gateway prepare → challenge-bound
Adapter VP → Gateway execute HTTP machinery and error processing into
the internal, non-public `orchestrator-gateway-transport.ts`.
The canonical `orchestrator-gateway-client.ts` defines only the
read-only `OrchestratorPlanningGatewayReadClient`, with the same
Gateway validation and derived permission equality checks as before.
The trusted Planning read port now holds this read-only class.
`legacy-orchestrator-gateway-client.ts` physically defines the old
writer, exact fixed branch/PR helper methods, and legacy provider
result validation; four archived coordinator scripts keep their
existing explicit opt-in import unchanged.

**Tests:** existing historical Gateway unit tests retain the
wire contract and fail-closed provider validation; trusted Planning
read port tests exercise pinned Gitea revision, preliminary read DC,
OPA and challenge-bound VP. New runtime and checkout assertions
verify that the canonical class and internal transport contain no
old writer methods or fixed branch names, while the archived class
does, and that the canonical barrel never exports the internal
transport or historical writer. Existing R6 static importer guard
for the legacy module still applies.

**Trust boundary:** TypeScript exports cannot replace native Rust
DC/VP, signed-plan Task checks, Gateway, OPA, or protection of the
private Adapter bearer in deployment. A trusted source could still
import the internal transport; it must never be exposed to an agent.
No external models, status lists, policy changes or source-main merges.
The historical paid Gemini workflow remains R5 NO-GO.

**Gate:** full exact-SHA five-job cumulative offline CI, plus
relevant trusted Planning/Engineer regressions, before certification.
Rollback to `e785ede1bf4c2194eaa954d787a63725d4245c46`.

### R6 cleanup batch 14 — protect private Gateway transport after physical read/write split

Batch 13 physically separated trusted read-only Planning from the
Account Suspension fixed branch/PR helpers, but introduced the internal
`orchestrator-gateway-transport.ts` with the powerful generic
`invoke()` machinery and the private Adapter credential. A new
canonical or agent-facing module must not import or re-export that
transport as a convenient direct Gateway tool.

**Enforced boundary:** add the internal transport to the tracked R6
audit as a **sensitive source**, explicitly NOT as a deletion
candidate. Allow only
`orchestrator-gateway-client.ts` (trusted read wrapper) and
`legacy-orchestrator-gateway-client.ts` (historical writer)
to import it. Existing R6 AST-based checks reject static imports,
literal dynamic imports/CommonJS/module URLs and newly configured
direct launchers outside this exact two-file set.

**Type-only gap:** the parser erases TS type-only imports. A separate
checkout regression conservatively examines tracked Orchestrator
`src/*.ts` files except the transport and two approved wrappers.
It rejects even type-only or comment mentions of the internal
transport path. A synthetic regression ensures a new canonical
re-export or trusted dynamic import is rejected while documentation
and comment-only runtime edges do not count as parsed execution.

**Boundary limitations:** this is a source-integrity and regression
guard, NOT an authorization boundary, a threat-model claim that
untrusted code cannot read a source path, or evidence that this file
is dead. The two permitted wrappers remain reviewed trusted code
and an attacker holding a valid Adapter bearer would require
independent infrastructure controls. Gateway, native Rust DC/VP,
signed-plan scope, OPA, and credential secret isolation remain
mandatory. This batch changes no provider or issuance behavior
and does not execute Gemini.

**Gate:** require exact-SHA cumulative offline validation after this
change; keep R5 NO-GO and do not merge into `main`.
Rollback to `3bbbc6506079f7a08d542581ccdea9e2ac72d85d`
if a legitimate dependency is discovered and requires redesign.

### R6 cleanup batch 15 — fail-closed approved A2A liveness contract

**Residual risk:** the shared `DelegatedA2ARoleRunner` is used by
both the historical static-template coordinator and the new
Engineer-approved Task DAG. The role runner previously invoked
`assertActiveBeforeA2ASend?.()` *optionally*, regardless of whether
an immutable `approved_task_id` was present. A replacement or
test-injected issuer lacking that guard could mint a child and send
an approved Task after the operational root had been revoked.

**Change:** when `approved_task_id` is present, require the issuer's
`assertActiveBeforeA2ASend()` method at runtime. Check it **before**
the irreversible child issuance and recheck it **synchronously
immediately before** protected A2A send, after the asynchronous
Adapter interaction. If the guard is absent, reject before any
issuance or A2A request. The original legacy path with no approved
Task ID retains the optional call and the same historical behavior.
The trusted scoped issuer already implements this method and
revalidates the coordinator phase, operational credential ID and
approved plan digest.

**Regressions:** new A2A runner tests assert no child issuance/A2A
send when a trusted issuer lacks the guard and the positive ordering
`guard → issue → guard → send`. The deterministic three-agent ADK
offline fixture now supplies a faithful liveness callback that
checks its Coordinator phase, rather than implicitly exercising
a fail-open test double. Existing denial of revocation between
child issuance and protected A2A send remains in the original
trusted child-issuer test suite.

**Limits:** this is a runtime contract, not cryptographic proof
that an arbitrary callback is trustworthy; the canonical scoped
issuer must still be created by the trusted coordinator from
authenticated signed plan approval. Native Rust DC/VP, Gateway
Task binding, OPA, status revocation and the independent
A2A corroboration remain mandatory. Neither the historic
fixed-coordinator scripts nor paid Gemini workflows were run.

**Gate:** all five exact-SHA cumulative offline CI jobs and
any dedicated approved-Task tests must pass. R5 remains NO-GO.
Rollback to `e8eb24643f7244d432427fec96a3673f1d3cfef6`.
No changes to `main`.

### R6 batch 15 follow-up — adjust revoked-root test to the two-check protocol

The first dedicated `Trusted Prebound A2A Dispatch` run on
`b964d16e205d6351e6893917893e28bc1766c078` failed in a
**test expectation**: the existing revoked-root fixture counted a
single `assertActiveBeforeA2ASend()` callback, but the hardened
approved-task runner correctly executes two checks (pre-issuance and
immediately pre-send). One scoped Adapter child issuance still
occurred, and protected A2A was still denied after simulated
revocation. The test now explicitly requires `guarded === 2`,
`Adapter calls === 1`, and `A2A sends === 0`.

No production authorization check is weakened or removed. Re-run
the full exact-SHA cumulative gate and dedicated A2A workflow
before declaring batch 15 valid. The original failed run remains
in GitHub history as a useful regression record.

### R6 batch 15 integration corrections — require realistic liveness in offline fixtures

The first exact-SHA cumulative run after the mandatory
`approved_task_id` liveness guard found **two real integration fixtures**
that previously provided a child issuer with no
`assertActiveBeforeA2ASend()`. The new runtime correctly refused
these send attempts: one protected A2A Task in
`poc/apps/gateway/test/trusted-plan-ipc.test.ts`, and one Docker
acceptance Test Task in
`poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs`.
Those original failed checks are retained in GitHub Actions history;
we do not weaken or bypass the new security condition.

**IPC fixture:** the check now queries the actual
`TrustedExecutionCoordinator.phase` and verifies that the
operational root ID still matches the activated Engineer-approved
root. Both checks execute synchronously before issuance and send.

**Docker fixture:** only the scripted **non-native** child-issuer
branch receives a local guard that requires a started, incomplete
Runner session and the exact fixture root ID. The native EVM/Rust
branch continues to use the existing
`TrustedApprovedPlanChildAuthorityIssuer`, which verifies
Coordinator phase, root credential ID and immutable signed digest.

**Scope:** these changes touch only test fixtures. No production
authorization logic is relaxed; legacy role-based tests without
approved Task IDs continue to execute unchanged. Re-run exact-SHA
cumulative, real Docker acceptance and trusted IPC regressions
before marking batch 15 validated. The original 5-job CI remains
red in the GitHub record.

### R6 cleanup batch 16 — repair dangling historical TypeScript-only imports

**Finding:** after the physical Gateway read/write separation (batch
13), the historical `sequential-coordinator.ts` still declared
`import type` for `OrchestratorCreateBranchResult` and
`OrchestratorCreatePullRequestResult` from
`orchestrator-gateway-client.ts`. The trusted read-only client
does NOT export those contracts: both now live only in
`legacy-orchestrator-gateway-client.ts`. Runtime Node
`--experimental-strip-types` erased this mistake and did not fail
existing A2A/Account Suspension tests.

**Correction:** redirect just these two type imports to the
explicitly historical writer. Do not move the types back into
the trusted Planning client or canonical barrel. The historical
fixed branch and PR logic and all runtime behavior are unchanged.

**Prevent recurrence:** add a tracked-source R6 regression that checks
the concrete TypeScript `import type` declaration, verifies that the
historical module actually declares both exported interfaces,
and asserts they are not present in the read-only client or canonical
public index. This is a targeted dependency-integrity check, not
a general compiler-based typecheck; other TS type resolutions still
need scrutiny as part of final R6 review.

**Safety:** no model calls, no changes to Rust DC/VP, Adapter, Gateway,
OPA, signed planning or A2A runtime. Require exact-SHA cumulative CI
and existing historical sequential-coordinator tests before marking
the batch validated. Roll back to
`68c3c8e9a762f2448ecb831ae7e0d3ddbfbe28d2` if required.
`main` stays untouched; R5 paid Gemini remains NO-GO.

### R6 cleanup batch 17 — independently validate local named TypeScript-only imports

After batch 16 found a dangling `import type` for the historical
Gateway branch/PR result interfaces, we added the **R6 named type
contract audit** in `poc/scripts/r6-type-imports.mjs`. The audited
scope is `poc/packages/orchestrator-runtime/src/*.ts` and its
`test/*.ts`. It checks relative named `import type`, inline
`import {type X}`, and `export type {X} from` declarations.
It verifies source-file existence and resolves directly declared
exported symbols and simple named/star re-exports without evaluating
any source, calling models, or accessing credentials.

The pinned cumulative offline workflow now runs
`npm --prefix poc run audit:r6:types` alongside
`check:imports` and `audit:r6:references`; unit tests cover
positive aliases/re-exports, moved symbols, deleted targets and
comment/string false positives. This expands coverage to dependencies
erased by Node's TypeScript stripping. The static scanner is
intentionally a **bounded check, not `tsc`**: it does not validate
generic assignability, complex ambient declaration merging,
computed imports, packages imported without a relative path,
non-named/default/namespace-only type imports or the other
workspaces. Future R6 work must not present a passing scan as
a full TypeScript build.

No operational provider, signed-plan, DC/VP, OPA, A2A, Gemini
workflow or `main` branch is altered. Certify only if exact-SHA
cumulative five-job offline CI passes. Rollback:
`4ab251b734879cb73b5802605e8f8eb0cfc5f052`.

### R6 cleanup batch 18 — expand erased TypeScript import audit to Agents

Batch 17 introduced a bounded named-type import checker after
discovering that Node's `--experimental-strip-types` does not
type-check the historical Coordinator. The original scope covered
only `poc/packages/orchestrator-runtime/{src,test}`.

**Expanded scope:** include both `src/*.ts` and `test/*.ts` of
`poc/packages/agent-runtime`, plus
`poc/apps/a2a-agent/{src,test}`. This covers the core ADK/A2A
agent handlers, task/permission types, gateway-crypto presentation
integration and A2A host regression tests in addition to the
Orchestrator. It reuses the existing
`npm --prefix poc run audit:r6:types` stage in the cumulative
offline workflow, so no additional workflow or paid model is needed.

**Proof:** new synthetic tests check cross-workspace named type
re-exports and imports, scope selection/exclusion, and fail-closed
detection of a moved or removed exported type in both Agent
Runtime and the A2A host. Existing tests for direct/aliased
imports, quoted/comment false positives, deleted modules and
transitive barrel re-exports remain.

**Intentionally bounded:** `poc/apps/gateway`,
`test-runner-controller`, package imports, declarations from
external libraries and more complex TypeScript typing are outside
this batch. Only tracked `src/test` top-level `.ts` files in the
three named workspaces are scanned. This is still not full `tsc`.
Further R6 cohorts can be admitted after their known compiler
patterns are investigated. It is unsafe to delete historical
regression fixtures based solely on these reports.

No production code, Rust authorization, Gateway, OPA, task
orchestration or Gemini calls are changed. Require the full
five-job exact-SHA cumulative offline CI before calling this
validated; `main` is unchanged. Rollback to
`c466b9814889ff5e3f0a60ec1c4250e51772fdb5`.

### R6 batch 18 follow-up — correct edge accounting in synthetic cross-workspace test

The first CI `40089028919` passed the production
`audit:r6:types` gate and the substantive Gateway/Engineer,
ADK/A2A and real Docker work, but the Node test suite caught an
incorrect expected counter in the new synthetic fixture:
`checkedImports` was expected as **4** while the checker correctly
reported **6**. Four edges were `import type` names; the other
two were named `export type` re-exports in the Agent Runtime barrel.

The test now expects six verified **named type edges**. This is an
assertion correction only, not a relaxation of the scanner:
`report.errors` is still required to be empty. No production
code, native verifier, delegated permissions or A2A behavior
changes. CI `40089028919` is not green; rerun all exact-SHA
offline cumulative jobs after the correction.

### R6 cleanup batch 19 — named TypeScript contracts in the Gateway workspace

**Prior scope:** the R6 type-only import check covered
`orchestrator-runtime`, `agent-runtime` and `a2a-agent`,
but not the Gateway. The Gateway supplies canonical protected
request types, Rust operation mappings, prepared authorization
records, approved execution plan interfaces and trusted completion
observations imported by the Orchestrator. Broken named type
imports can be erased by Node's TypeScript stripping, so existing
runtime tests are not sufficient to detect all source drift.

**Added scope:** include top-level
`poc/apps/gateway/{src,test}/*.ts` in the existing bounded
`audit:r6:types` source validation and cumulative offline CI gate.
Do not modify production TypeScript, the Gateway runtime itself,
or any cryptographic or provider authorization logic.

**Regression fixtures:** verify a Gateway type barrel alias,
direct source and test type imports, and a Gateway type consumed
cross-workspace by the Orchestrator. Explicitly keep nested
`gateway/native-test` and unrelated Runner workspaces outside
the cohort. Check that an obsolete named Gateway interface and a
deleted local type module both fail with the correct diagnostics.

**Limitations:** the checker confirms the presence of relative
named type exports and simple re-exports; it is **not a full
TypeScript compiler** and cannot prove type assignment correctness,
generic constraints, third-party declaration validity, ambient
module availability, default/namespace imports, or dead-code
safety. Compiler-level verification should remain a separately
tracked future improvement, not be assumed from this gate.

**Safety and rollback:** only the audit script, its tests and this
ledger are modified. No paid Gemini calls, no main merge and no
change to signed-plan/DAG, Gateway, Rust DC/VP or OPA semantics.
Require exact-SHA cumulative offline CI 5/5 before certifying.
Rollback to `e826a2a70077f5ee55589b9040a8abc000a1b1bc`.

### R6 batch 19 follow-up — update previous cohort fixture to reflect Gateway admission

The first batch-19 cumulative run `40090083967` detected a
stale **test fixture** in the batch-18 scope test: it intentionally
placed a broken import in `poc/apps/gateway/src/unrelated.ts` as
an out-of-scope example. After adding Gateway to the checked cohort,
the scanner correctly counted this file as a sixth input and the
old test's `checkedFiles === 5` assertion failed. The production
type contract scan and the new Gateway positive/negative fixtures
had passed their preliminary gate.

**Correction:** replace the obsolete Gateway-exclusion example with
the still-excluded `poc/apps/test-runner-controller/src/unrelated.ts`;
rename the test to explain that it is the unrelated Runner workspace
that remains outside the scope. The scanner and the requirements
`checkedFiles === 5`, `checkedImports === 6` and empty errors
are not weakened. The separate Gateway tests continue to require
both successful type resolution and fail-closed detection of
missing exports or targets.

No production code or runtime permission changes. The original
failed CI must remain recorded; certify only after a new exact-SHA
cumulative five-job CI is fully green.

### R6 cleanup batch 20 — include Test Runner Controller in local type-contract checks

The isolated Runner provides exact-Git-SHA testing, a fixed Docker
phase pipeline, researcher acceptance and the trusted Gitea CI
evidence used by the Gateway. TypeScript-only imports in these
interfaces could silently become invalid when modules are moved:
Node runtime tests strip such imports without type-checking them.

**Change:** expand the existing `audit:r6:types` scan to include
`poc/apps/test-runner-controller/{src,test}/*.ts`. It now covers
five explicitly selected workspaces: Orchestrator, Agent Runtime,
A2A Agent, Gateway and Test Runner Controller.

**Regression evidence:** add synthetic positive checks for named
Runner request/result type imports, barrel alias re-exports,
a Runner test consumer and a cross-workspace Gateway consumer.
Add negative checks for a removed named Runner interface and
a deleted local type module. Older cohort-scope fixtures were
updated to use a genuinely unrelated synthetic workspace instead
of the now-in-scope Runner, without relaxing their assertions.

**Limits:** this is not a full TypeScript compiler. It does not
check assignability, generic constraints, node_modules declarations,
ambient modules, or nested JavaScript Runner integration scripts.
It is not evidence that legacy Runner files can be deleted.

**Safety:** no production Gateway, Runner, Rust, credentials, ADK
or OPA behavior changes. The cumulative CI runs the same named
type gate. Require all five exact-SHA offline CI jobs to pass
before certification. Paid Gemini remains NO-GO and `main`
is untouched. Rollback to
`be019853b8502de78e4a61b411ece95c001d3485`.

### R6 cleanup batch 21 — keep manual protected merge outside canonical agent API

**Residual public exposure:** `orchestrator-runtime/src/index.ts`
still wildcard-exported `merge-readiness.ts`, a verifier fixed to the
old IAM Console repository, branch and Gitea security pipeline.
This is a read-only check but belongs to the independently
authenticated, explicitly human-invoked *protected merge* workflow,
not to the general trusted Planning/ADK/A2A runtime API.

**Change:** remove just this canonical barrel export. Preserve
`merge-readiness.ts`, `trusted-merge.ts`,
`manual-merge-intent.ts` and the human-only
`scripts/human-merge.mjs`, which continue to use direct imports.
Do not weaken Gitea branch protection, separate reviewer/CI/merge
identities, exact SHA evidence, double-check before protected merge,
or the `workflow_dispatch`/operator confirmation requirement.

**Regression:** the existing `check-local-imports.test.mjs` R6 suite
now asserts the three human-merge modules are absent from the
canonical public index. It verifies that the verifier and manual
intent still exist, the privileged script imports the
security-critical modules directly, and the protected workflow
still uses manual dispatch and its protected environment. No
workflow is invoked during the check.

**Limitations:** this is a source/API exposure reduction, *not*
authorization by TypeScript exports. Direct source imports remain
possible to trusted repository code; service-account isolation,
human approval and Gitea server-side enforcement remain essential.
No historical merge experiment or native verifier test is removed.

**Gate/rollback:** require exact-SHA five-job cumulative offline
validation before certification. No `main` merge and no paid
Gemini usage. Roll back to
`99e914d0d68b2c0503c685dd400e5e7492d5e940` if needed.

### R6 cleanup batch 22 — fence historical Account Suspension-only interface preflight

The 57-line `account-suspension-preflight.ts` is an intentionally
narrow detector of the specific `suspend/reactivate` Backend,
Frontend and accessible-label contract from the *old* IAM Console
experiment. It is **NOT** a generic approved-plan validator,
independent Runner acceptance or a Gemini quality metric.
A prior cleanup removed its canonical index export, but the file
still has two real, valid importers: the historical
`a2a-production-coordinator-mcp-gemini-live.mjs` workflow script
and `account-suspension-preflight.test.ts`.

**Change:** add this module as a separately classified historical
target in `r6-legacy-references.mjs`. Fail the audit if any other
module imports/re-exports it, performs a literal dynamic load or
configures a direct invocation. Allowlist precisely the two
historical references above. Runtime graph checking is backed by a
synthetic unauthorized canonical re-export and trusted dynamic
load test; a checkout regression verifies the named historical
callers and excludes the module from all trusted production
`src/trusted-*.ts` sources and the public Orchestrator barrel,
including TypeScript-only textual references.

**Preserved:** the old billed script, IAM reference files, exact
11-file permission fixture, preflight implementation, and regression
tests. The static scope checker under
`scripts/check-account-suspension-reference-scope.mjs` remains
necessary to historical CI and must not be deleted because an
unrelated source graph reports a small caller set.

**Boundary:** absence of a source import is not a cryptographic
authorization control or proof of dead code. The new approved-plan
DAG, Gateway, Rust DC/VP, OPA, exact-SHA acceptance and Engineer
approval remain independent. A passing preflight does not prove
functional correctness. No paid Gemini experiment or merge to
`main` is authorized by this gate.

**Validation:** require exact-SHA cumulative five-job CI success,
including original historical regression tests, before certifying.
Rollback to `27d54ef9a9de4300aacb838171fbde34cf6255c5`
if a legitimate unlisted consumer emerges.

### R6 cleanup batch 23 — preserve and fence the 11-file historical DC-scope checker

**Evidence:** `check-account-suspension-reference-scope.mjs` is still
a side-effect CLI that verifies precisely **11** IAM reference files
across Backend (4), Frontend (3), and Test (4), fixed write
permission templates, an Engineer-to-Orchestrator root permission
superset, and exclusive `run_tests` for the Test role. It is **not**
the dynamic permission subset review or independent Runner
acceptance used by the new signed-plan workflow.

**Verified configured callers:** exactly four workflows currently
launch it: cumulative offline refactoring validation,
`shared-mcp-production-coordinator.yml`,
`shared-mcp-real-positive-e2e.yml`, and
`gemini-paid-shared-mcp-final.yml`. The last workflow remains
manual, gated by explicit billing consent and historical-only;
adding a CI allowance does not authorize a paid model request.

**Changes:** retain the existing script, fixture, fixed template
roles, and all four workflow invocations. Extend the tracked R6
inventory with `unexpectedHistoricalReferenceScopeCallers()`.
The regression check fails on *any new source import or literal
dynamic load* of this side-effect-only checker, or a configured
launcher outside the four named workflows. Synthetic tests cover
an unauthorized GitHub Actions launcher, an eager import, a dynamic
import and inert comments. A checkout test asserts the 11-file
contract markers and exact four configured CI sources; it
does not execute the checker or the billed workflow.

**Limits:** the scanner is conservative and static. It does not
resolve computed dynamic imports or infer whether a CI trigger
actually ran, and no observation alone proves a file removable.
The generic approved-plan DAG must use signed scopes and
independent Gateway/Rust/OPA checks, not this hardcoded
historical IAM contract. This batch does not alter any runtime
scope, permission, EVM status bit, model request or Gitea merge.

**Gate:** require 5/5 cumulative offline CI success on the new
exact commit. `main` remains unchanged and R5 Gemini stays NO-GO.
Rollback this batch to `4c84e954f00e5a0dd80f94c2c6a5758050582a11`
if any unrecognized, legitimate historical command is found.

### R6 batch 23 correction — six historical workflow callers, not four

The first batch-23 exact-SHA CI `40094663412` failed the
new source-reference gate before running most other checks.
The audit correctly identified **two additional real, configured**
invocations of `check-account-suspension-reference-scope.mjs`:
`.github/workflows/disposable-simulated-approval-merge.yml`
and `.github/workflows/poc-baseline.yml`. Both contain a concrete
`run: node --experimental-strip-types ...` command for the
11-file Account Suspension scope check. They were inadvertently
omitted from the earlier inventory, not unauthorized new behavior.

**Correction:** extend the allowlist to these two known offline
regression workflows (six legitimate configured callers total) and
change the checkout regression expectation from four to six.
Keep every invariant checking the fixed **11 IAM files**, exact
write permissions, root containment, exclusive Test Runner rights
and detection of any newly introduced source import or
seventh configured launcher. Do not delete or rewrite the two
workflows, do not add canonical ADK consumers, and never run the
historical billed Gemini workflow as R5.

The original failed CI is retained as evidence of the safety gate.
Certify only after an entirely green 5/5 cumulative run for the
new exact commit. No paid Gemini calls or changes to `main`.

### R6 cleanup batch 24 — restore historical PR/merge-readiness imports after API isolation

**Regression detected in source audit:** batch 21 removed the
`merge-readiness.ts` wildcard export from the canonical
`orchestrator-runtime/src/index.ts`. Three historical coordinator
scripts still requested `GiteaMergeReadinessVerifier` and
`MergeReadinessDenied` from that public barrel. Node syntax checks,
local import-path tests, and the five-job cumulative CI did not
validate the existence of those runtime named exports, because
these three historical scripts were not all executed by the
current cumulative matrix. An attempted historical PR/CI smoke or
billed run would fail at ESM module linking before its gate could
verify independent human review and trusted CI status.

**Fix:** in the historical real-Gitea positive runner, historical
PR-open smoke, and manually gated Gemini script, retain
`DelegatedA2ARoleRunner` as a generic public import but import
`GiteaMergeReadinessVerifier` and `MergeReadinessDenied`
**directly** from the human-only
`orchestrator-runtime/src/merge-readiness.ts` module.
Do **not** restore these controls in the agent-facing barrel.
The original fixed repository/branch, strict readiness/denial and
no-automatic-merge logic remain unchanged.

**Regression evidence:** add a checkout test requiring precisely
these three historical scripts to use explicit named imports from
the implementation module, confirming the names are defined there
and absent from the generic public barrel. The negative legacy
smoke remains free of privileged merge-readiness imports.
Existing focused `merge-readiness.test.ts` and protected
human-only merge CLI regression must also remain green.

**Limit:** source-level import repair, not a paid or real external
provider end-to-end proof. The scripts should only be exercised
under their previously reviewed CI conditions; the old manual
Gemini workflow is not a substitute for R5 authenticated Engineer
handoff and remains NO-GO. No main merge or billable execution.

**Gate:** five-job exact-SHA cumulative offline CI plus static
named-export regression. Roll back this batch to
`75c2e390662d64ad1bd3ba8f36decb2177f7edc9`.

**Batch-24 regression test follow-up:** normalize the test for the
two exported merge-readiness classes to an explicit source declaration
assertion. The first version had an over-escaped dynamic word-boundary
pattern; this test-only correction verifies the same class names and
does not change their implementation or any security policy.

### R6 cleanup batch 25 — historical entrypoint named-runtime-export audit

**Motivation:** after the human-only `merge-readiness.ts` export
was removed from `orchestrator-runtime/src/index.ts`, three legacy
Account Suspension A2A scripts still attempted to import
`GiteaMergeReadinessVerifier` and `MergeReadinessDenied`
from the public barrel. The import-path guard passed because the
barrel file existed, but the runtime named symbols were missing.
Batch 24 repaired the explicit imports. The old experimental
scripts were not all executed by the five-job cumulative matrix.

**New gate:** `poc/scripts/r6-historical-named-imports.mjs`
statically checks all relative named *runtime* ESM imports in
the four archived A2A coordinator entrypoints and the protected
human-only `human-merge.mjs` command. The imported target must
be a Git-tracked file and define the requested value export
directly or through simple named, aliased or star re-exports.
TypeScript `export interface` and `export type` cannot satisfy
runtime value imports. Source files are only read; no historical
entrypoint or model is invoked.

**Test coverage:** direct values, alias forwarding, recursive
barrel exports; missing value in a present file; erased
TypeScript interfaces; inert commented/quoted examples; and
missing Git-tracked dependency or audited historical script.
Add `npm --prefix poc run audit:r6:runtime-named` to the first
stage of cumulative offline validation. These checks specifically
protect the privileged merge-readiness API isolation without
requiring historical paid or Gitea side-effect execution.

**Scope limitations:** intentionally pinned to five entrypoints;
this is not a complete Node linker, `tsc`, dynamic-import audit,
third-party package export validator, actual provider handshake,
signed-plan end-to-end proof or legacy deletion finding.
Do not infer that external workflow approval gates were exercised.
The old Gemini run remains R5 NO-GO. No changes to `main`,
native Rust, Adapter, Gateway, OPA, child issuance or ADK behavior.

**Rollback and gate:** compare-and-swap parent
`3a21c964c8ade967ea07e1fe738ad1417476d800`; require
five successful cumulative offline jobs for the resulting
exact commit before certifying.

### R6 batch 25 correction — avoid masking real exports after regex syntax

The initial exact-SHA runtime export audit reported
`checkAccountSuspensionPreflight` missing, despite the function
being visibly exported by `account-suspension-preflight.ts`.
The target contains a regex character class with quote and
backtick characters before the exported function. The audit's
minimal comment/template masking incorrectly consumed the
subsequent `export function`, producing a **false positive**.
The Gateway/Planning production code was not faulty.

**Fix:** retain comment/template filtering for the selected
historical entrypoint import statements, which occur in their
module headers. For resolving exported values from referenced
modules, use statement-anchored declaration and named/star
re-export patterns on the raw source; this avoids pretending the
minimal scanner fully tokenizes JavaScript regex literals.
Add tests for a real named export after quoted regex/template
syntax and for a quoted example that must not resolve a named
runtime export. No importer permission is relaxed.

**Limit:** static anchored matching is deliberately not an
ECMAScript parser and can still be conservative around complex
multiline comments or computed re-exports. The checker is
regression assistance; actual module linking remains a separate
required runtime test where safe. Historical Gemini cannot be
imported or launched just to test its bindings.

Repeat the full five-job exact-SHA cumulative CI before
certifying batch 25. Leave `main` and R5 unchanged.

### R6 cleanup batch 26 — repair historical live authority-boundary probe imports

**Finding:** after batch 13 physically separated protected Planning
reads from historical Account Suspension branch/PR writers,
`assert-current-authority-boundaries.mjs` still imported
`OrchestratorProtectedGatewayClient` from the former shared
`orchestrator-gateway-client.ts`. The latter now exports only the
read-only Planning class and the shared error. When a historical
coordinator loads the independent authority-boundary probe,
ESM linking would fail **before** testing negative delegated
permissions, stale provider SHA, or duplicate PR provider conflicts.
The five-job cumulative matrix did not previously link that helper.

**Correction:** import the historical write class explicitly from
`legacy-orchestrator-gateway-client.ts`; retain
`OrchestratorGatewayClientError` from the read-only client
(they share the exact transport error class). Do not publish the
writer back through the public index. No tool, permission or VP
execution behavior is changed, and the probe remains capable of
testing real Adapter/Gateway denial when launched under its existing
historical integration conditions.

**Audit:** expand the previous five-entrypoint
`audit:r6:runtime-named` scan to include this effectful historical
helper as its sixth **read-only source-inspected** entrypoint.
A synthetic regression proves a reference to the removed canonical
value export is rejected and the explicit legacy module resolves.
A checkout regression asserts the two real imports, actual class
definition and absence of the historical writer in the canonical
read API. The checks do not execute the helper or any billed script.

**Limits:** source-level named-export resolution is not full ESM
linking or native cryptographic authorization; untested package
imports and computed loading remain out of scope. The historical
negative probes require independently provisioned real providers.
The refactored Engineer-approved R5 paid Gemini path remains NO-GO.

**Validation:** require full five-job offline CI success on the
exact Batch-26 SHA. `main` stays unchanged; no merge or billable
Gemini run. Rollback to
`253f558ff700bb2e3e99cac5bb965bf0153dc84a`.

### R6 batch 26 follow-up — narrow legitimate historical Gateway caller exception

The first Batch-26 cumulative run `40097071236` correctly failed
the R6 static reference guard: moving the negative
`assert-current-authority-boundaries.mjs` probe to the actual
historical write module introduced a *new import edge* not yet
included in `R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS`.
It is legitimate: the probe exercises a duplicate historical
pull-request provider conflict through the same real Gateway
prepare → Adapter VP → Gateway execute chain, including 409 denial
and no protected branch mutation.

**Correction:** extend that exact legacy writer import allowlist
with only this named, historical security probe. Retain denial
of all new generic/canonical ADK, Planning and A2A callers. Add
a checkout regression showing the helper is a real direct importer,
the full observed runtime inventory is permitted, and deliberately
removing its allowlist entry fails as intended.

No Gateway authorization, OPA rule, native DC/VP, provider behavior
or Agent script execution is relaxed. The initial failed CI remains
historical evidence of the reference gate. Require a new **5/5**
exact-SHA offline cumulative run, without Gemini payment or merging
into `main`.

### R6 batch 26 correction — place exception in the Gateway, NOT authority list

The first follow-up exact-SHA CI `40097238718` failed the
R6 reference gate. A text replacement had accidentally added
`assert-current-authority-boundaries.mjs` to the separate
`R6_ALLOWED_HISTORICAL_AUTHORITY_IMPORTERS` list, whose last
script entry had the same text as the historical Gateway list.
The actual `R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS` was
unmodified and correctly rejected the new writer import.

**Fix:** remove that unrelated allowance from the historical
credential issuer and add it precisely to the Gateway
branch/PR writer allowlist. Strengthen the checkout regression
to demand the helper is accepted **only** as a Gateway writer
consumer and explicitly rejected as a historical authority
credential issuer. This enforces the intended minimum privilege
and prevents a future accidental cross-list edit.

No runtime credential, OPA, Gateway, EVM or permission check is
modified. Original failed CI remains recorded; certify only after
the new exact-SHA five-job offline suite passes. R5 remains NO-GO
and `main` is unchanged.

### R6 batch 26 final test correction — six DISTINCT audited historical entrypoints

The next exact-SHA cumulative run `40097455706` passed the
R6 import-path and named-runtime-export stage; its Node regression
suite then found a stale assertion that the set of six historical
entrypoint paths should have only five unique entries. That was a
test counter leftover from the prior five-script audit, not an
export-resolution or authorization failure.

**Correction:** assert six entrypoints and **six distinct paths**
and rename the test to include the new historical authority
boundary probe. Keep all six paths mandatory. Do not silence,
skip, or weaken the test. The older red CI is preserved in GitHub
and the entire 5-job exact-SHA suite must run again.

No policy, historical Gateway write operation, DC/VP, OPA,
Adapter or provider behavior changes. No paid Gemini calls and
no merge to `main`.
