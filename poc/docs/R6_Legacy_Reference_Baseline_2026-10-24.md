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
