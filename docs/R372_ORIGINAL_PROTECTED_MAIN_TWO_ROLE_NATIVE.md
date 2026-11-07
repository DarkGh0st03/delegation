# R372.0 — Original protected-main Branch -> Backend -> Frontend

## Goal and scope

Carry R371.3 forward without bypassing protected `main` or introducing
a second orchestration path. The **original Engineer Review Host**
`execution.runCanonicalOperationalWorkflow({createBranch,sdk,adaptive})`
must perform a real, one-shot native Rust root `create_branch` on a
**previously absent** feature branch, independently verify it, and only
then select and dispatch both Backend and Frontend over protected SDK A2A.

The original public, unresolved Account Suspension baseline remains the
HEAD of Gitea `main` throughout. Unlike R370, the test-owner does not
seed an already implemented application on the feature branch.

The independent Ed25519 Engineer grant covers exactly five pairs:
`create_branch` on the repository; `read_file` and `update_file` on
the existing Backend source `apps/backend/src/users/user.service.ts`;
and `read_file` and `update_file` on the existing Frontend source
`apps/frontend/src/api/users-api.ts`. A read-only model reads real
protected-main source before requesting the scope.

The bounded free, scripted ADK decisions select:
1. Original root-owned Branch Task at epoch 1 (no Child; one Gitea POST).
2. Backend read+CAS Task after independently attested Branch, with one
   native Rust Child, one true authenticated read and one Gitea CAS.
3. Frontend read+CAS Task **depending on the independent Backend Gateway
   completion**, with a second native Rust Child, authenticated source
   read and Gitea CAS.
4. `blocked` after both independently verified updates, **without**
   attempting a Test or PR because those permissions were not signed.

Both source edits are deliberately *nonfunctional deterministic test
comments* appended only after the ADK agent receives true Gitea source
bytes. They are not passed off as autonomous Account Suspension
implementation or researcher acceptance.

## Security and measured expectations

One approved feature branch POST and two independent internal CAS
staging-ref POSTs must be distinguishable. Three original Gateway Task
completions and two native Child credentials must be confirmed. All
unexpected branch POST names, unauthorized Test/PR, replay of original
root Branch execution, main mutation, legacy HTTP Adapter and paid API
calls remain forbidden.

R370's separately green prepared-reference E2E proves real Docker PASS
and attested Draft PR with all three specialists, but it does not begin
at protected unresolved main. R372 closes the original branch-first
two-specialist gap, **not** the final generative E2E. Next: select real
Test on the original unsolved source and verify fail-closed until the
agent-authored changes actually satisfy acceptance, then only permit
a PR on authenticated PASS.

This checkpoint is **not verified until its native GitHub Actions run
ends SUCCESS**. Production GitHub PR #38 remains Draft and unmerged;
production `main` remains unchanged.
