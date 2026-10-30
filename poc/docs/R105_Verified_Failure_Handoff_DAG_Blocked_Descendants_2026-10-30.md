# R105 — Gateway-owned test failure to repair-intake handoff

Date: 2026-10-30. Working branch: `refactor/post-prof-plan-contracts-20261021`.

## Scope and rationale

- The three real Gemini pilot runs reached Docker but failed TypeScript typecheck (TS2820, TS2367 and TS2339). The Test Agent did not receive unauthorized write grants; refusing to fix Backend/Frontend files itself was correct.
- An independently observed test failure is a **normal validation outcome**, not a successful Test Task or a reason to reapprove the same Engineer permissions.
- The existing Rust Core DC/VP chain, accumulator witnesses, revocation, Gateway Prepare/Execute and OPA enforce authorization. R105 does **not** add another authority format, increase any grant, or modify native Rust.
- Existing R103 Gateway admission required EVERY Task in the preceding plan to be completed, including PR/review Task descendants of the failed Test. That condition made a legitimate repair transition impossible.

## Implemented in this increment

1. `TrustedApprovedExecutionPlans.#assertEpochQuiescent()` computes the transitive descendants of a **verified terminal failed Test** in the current immutable DAG, purely from pinned Task dependencies.
2. Only those blocked descendants may remain unbound. Every independent or unblocked Task must have its existing independent positive completion. A previously bound blocked descendant must have no provider effect and no in-flight operation.
3. `admitNextOperationalEpoch()` returns only the blocked Task identifiers and rechecks the closure after its asynchronous trusted epoch read; any change aborts admission. Earlier Task bindings are stale after transition.
4. The failure path tolerates authorized read/test-file edits, but only when the final confirmed Gitea mutation commit matches the exact failed Docker tested SHA. Concurrent provider operations or any stale mutation disable automatic transition.
5. `TrustedRunnerFailure` now pins the Gateway session and original plan digest, in addition to validated Runner execution request, Test Task, epoch, branch, SHA, failed phase and whitelisted compiler error codes.
6. `prepareTrustedRepairFeedback()` is an **owner-private, no-side-effect** bridge: it consumes an already-terminal Gateway Test failure and `TrustedOperationalEpochIntake.verifiedEpochHistory()` against the *original* signed Engineer approval and active Coordinator/root; it rejects mismatched sessions, old epoch failures, revocation and budget exhaustion. It emits source-free metadata with `execution_authorized:false` and `permission_granted:false`.
7. Independent internal limit remains 3 total epochs (initial attempt plus 2 repairs); the Engineer authorizes only repository, branch, maximum exact ResourceURI/Operation grants and validity.

## Regression and negative tests

- Typecheck FAIL -> skipped PR and transitive descendant -> fresh Backend repair Task -> Test PASS.
- An unrelated, unbound sibling cannot be discarded as a skipped descendant.
- A PASS Test does not allow skipping unbound PR Tasks.
- A model-only failure is insufficient without Gateway-confirmed Docker evidence.
- An authorized Test file write must be covered by the final failed Runner SHA.
- Concurrent effects reject ambiguous failure evidence, and previously prepared old-epoch requests cannot execute after transition.
- Repair handoff can be read only against the latest verified epoch and active root. It is not a Task grant or a pass receipt.

## Explicitly not completed

- No model-generated repair DAG loop is wired into the running A2A dispatcher. The current `TrustedAdkReadOnlyPlanner` contract still assumes initial branch creation and a pinned main snapshot; it needs a **distinct, bounded repair-planning mode** anchored to the current disposable Gitea feature revision and the already issued Rust root, NOT a new Engineer approval.
- The handoff currently accepts co-located trusted Gateway and Intake objects. A real cross-PID deployment needs the existing authenticated owner-only IPC mechanism, never a model-accessible MCP tool.
- The scripted invoice-service test uses mock provider/VP/OPA effects. Before paying for Gemini, a single end-to-end test must cover fresh child Rust DC/VP, native Core verification, OPA, signed A2A Task execution, disposable Gitea revision retention and actual Docker FAIL -> repair -> PASS.
- Diagnostic paths may only reach a model after being checked against **that agent's authorized read scope**. This bridge exposes no diagnostic paths or source.
- An Operator must not turn an observed FAILED Runner receipt into `completed_verified`, a PR, or a new authority.

## Next engineering step

R106: establish the authenticated cross-process handoff, implement repair-mode Planner that derives an immutable next-epoch DAG within the existing root, and exercise full Runner and native Core Rust artifacts with no paid models. Retain the old one-shot signed DAG path until independent R106 regression tests pass.
