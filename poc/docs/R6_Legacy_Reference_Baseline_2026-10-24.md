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
