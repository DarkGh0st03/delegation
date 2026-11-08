# R409 — Signed Owner recovery Planner / DAG runtime migration

8 November 2026 · Branch `refactor/post-prof-plan-contracts-20261021` · PR #38 Draft. Baseline [R408 Fast CI #42513713020](https://github.com/DarkGh0st03/delegation/actions/runs/42513713020) SUCCESS 2/2 on SHA `3a70801b`.

## Runtime migration

The **existing implementations** of `TrustedOperationalRepairPlanner` and `executeTrustedAdmittedRepairDag` are relocated *verbatim, apart from a heading comment*, to the Owner-private `trusted-owner-repair-planning-core.ts` and `trusted-owner-repair-dag-execution.ts`. The original modules `trusted-operational-repair-planner.ts` and `trusted-repair-dag-controller.ts` remain as named-export compatibility wrappers, preserving historical imports and their existing real behavioral test coverage.

`trusted-owner-operational-repair-handoff.ts` now dynamically loads the two Owner-private cores, maintaining the exact previous **execution points**. The Planner loads only after the original independently Gateway-confirmed Test FAIL, signed epoch history and live-run checks. DAG execution loads only after `admitVerifiedOperationalEpoch` returned a matching signed epoch and the Owner explicitly opted into executing it. After each load, the Owner rechecks GitHub liveness and the **same** authenticated Rust root ID/approved plan digest.

The extracted cores have unchanged source and call the same Gateway, approved-plan, Root, scoped Child issuance journal, protected A2A and independent predecessor completion routines. They do **not** turn a successful A2A Test claim into Docker PASS or PR creation. No model call or scope expansion is added.

## Protection and evidence

R385.4 now **forbids any literal dynamic importer** of either historical Planner or DAG controller and retains their exact static historical/native test importers. R385.17 allows **zero new non-test importers** of those old paths; the R409 regression independently requires precisely one owner-gated dynamic importer of each new core, the historic compatibility edges, and original signed-root/Gateway/liveness/false-PASS restrictions. R385.3 and R406 tests are adjusted to inspect the new executable cores but still assert original fail-closed semantics.

This reduces two old runtime import edges and moves the executable logic to Owner-only modules. It does **not** prove the old wrappers can be deleted: historical tests, native EVM fixtures, computed paths and unverified external consumers still exist. Four private cryptographic MCP modules remain protected. The two remaining historical HTTP issuer modules are still required for explicitly gated fixtures, and the reviewed-DAG old wrapper from R408 also remains compatible.

A successful Fast CI is required on the post-change SHA; the complete native Rust/OPA/VP/Gitea/Docker Security CI and independently approved paid Gemini pilot remain separate future gates. No Main merge or paid inference.

## R409.3 post-migration verification

[Fast CI #42515924937](https://github.com/DarkGh0st03/delegation/actions/runs/42515924937) completed **SUCCESS 2/2** on commit `c0afc055`, including all four new R409 source-boundary tests, the historical R385.3/R385.4/R385.17 and R240/R406 negative guard expectations, and the no-AI Docker job. Some test sources had to be redirected from the old export shim to the unchanged new core: this is an evidence-location correction, **not a relaxation** of Root, Child, Gateway or HTTP-fallback assertions.

R410 ensures future edits to these migration surfaces automatically run the **positive, independent native Rust full Security CI** on the exact SHA. Its separate positive-smoke job also executes the R409/R385.3/R406 source guards. This second CI gate is still to be verified on R410 HEAD, not inferred from Fast CI.
