# R408 — Three reviewed signed-DAG runtime callers migrated

8 November 2026. Branch `refactor/post-prof-plan-contracts-20261021`; PR #38 Draft. Parent [Fast CI #42512893763](https://github.com/DarkGh0st03/delegation/actions/runs/42512893763) SUCCESS 2/2 on `bec7b0a6`.

The implementation of `createReviewedApprovedDagExecution` is relocated **verbatim except for a heading comment** from `trusted-reviewed-approved-dag.ts` to `trusted-owner-reviewed-dag-execution.ts`. It retains signed Engineer review, immutable plan, pinned GitHub run, one-shot A2A dispatch, scoped Child/Root checks, Gateway attestation, negative Test FAIL/recovery constraints and mandatory operational closure. This is **not** a new issuer or a new paid-model pathway.

All three existing owner runtime callers — `trusted-admitted-github-handoff.ts`, `trusted-admitted-scripted-handoff.ts`, and `trusted-fresh-repair-reviewed-dag.ts` — now dynamically load the owner-private implementation at their pre-existing gated admission points. Their post-import liveness checks and Root-retirement semantics remain unchanged. Fresh repair's type-only reference also follows the implementation.

The old `trusted-reviewed-approved-dag.ts` remains as a **two-export compatibility shim** for historical direct clients, including regression tests. R385.4 pins exactly zero runtime dynamic imports of the old shim, R385.17 denies all new non-test legacy importers, and R385.2/R408 negative tests verify the new lazy imports, guard ordering and tracked graph. The original reviewed-DAG behavioral tests still import the compatibility path and thereby exercise the same relocated function.

**Limits:** this changes three runtime import edges, not the underlying signed-DAG execution architecture. No independent audit of external/computed importers exists, so the old shim is not deletable. Five historical runtime targets and the four protected private crypto MCP files remain. Owner recovery's separate dynamic Planner/controller imports still require behavioral migration. Native full Rust/OPA/VP/Gitea/Docker Security CI is a separate eventual gate. No paid Gemini invocation, permission expansion or merge.

Next: validate Fast CI on the R408 SHA, then analyze owner recovery's two dynamic runtime imports and require equivalent signed-Root/Child/VP/OPA/Gateway and negative E2E coverage before replacement.
