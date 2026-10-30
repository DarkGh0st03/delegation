# R113 — Trusted owner A2A recovery handoff (no Gemini billing)

Date: **30 October 2026**. Branch: `refactor/post-prof-plan-contracts-20261021`.

## Diagnosis
R112's verified `Test FAIL` suspension retained the operational root in
the dispatcher. The reviewed A2A bridge still required `closed` for EVERY
terminal return and had an unconditional `close()` in `finally`.
The Engineer handoff lifecycle would promote any resolved DAG return into
`verified_complete`. A suspended failed Test must never be a PASS.

## Changes
- Opt-in `verifiedTestFailureRecovery` configured only by the trusted
  bridge creator (not a model/Task executor input), forwarding the same
  Gateway registry and original Rust-root-bound intake into R112.
- On verified suspension, validate provenance, non-authorizing signal,
  session/plan digest, current Rust root and GitHub liveness before/after
  the awaited private `continueWithinActiveRoot` callback.
- Unhandled suspension, invalid feedback, changed root, callback exception
  or canceled run fail closed. The original host `finally` still revokes
  the root and stops A2A servers after the callback finishes.
- The only intermediate status is
  `verified_test_failure_recovery_handoff`, never `completed`.
  The Engineer handoff requires verified native root closure and keeps
  `verifiedOutcome=failed` until a separate PASS contract exists.
- Seven R113 regressions use offline mocks; they do not establish real
  provider, cryptographic or production safety on their own.

## Explicit limitations and next step
This commit is a bounded hosting seam, NOT a complete R113 multi-epoch
repair. The admitted host uses a separate-process Gateway IPC client while
R112 requires the *same in-process* `TrustedApprovedExecutionPlans` and
`TrustedOperationalEpochIntake`. Do NOT fake or reconstruct them.
Recovery remains disabled in the production host.

Next: authenticate the Gateway IPC Test FAIL and exact root/epoch binding;
wire the host-owned callback to R109 discovery, R106/R111 next DAG and fresh
child DCs, then prove a real Gitea/Docker FAIL -> repair -> PASS -> review PR
on the exact new feature SHA. Only that final PASS may establish success.
Preserve revocation, OPA, Rust subset, stale-token and cancellation denials.

No merge to main and no paid Gemini calls.
