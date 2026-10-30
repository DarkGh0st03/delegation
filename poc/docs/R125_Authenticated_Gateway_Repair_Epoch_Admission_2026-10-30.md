# R125 — Authenticated Gateway admission of a previously reserved epoch

Date: 30 October 2026. Development branch: `refactor/post-prof-plan-contracts-20261021`.

## Implemented boundary
R124 can plan and fsync a new repair epoch under the original Engineer-signed
Rust root, but it did not ask the actual Gateway to admit the newly
reserved DAG. R125 adds owner-private HMAC Unix IPC `admit_epoch`, with
exact signed session, ORIGINAL plan digest, next epoch number and
reserved repair plan digest. It is not available through public Gateway,
MCP, A2A or Gemini.

The receiving Gateway MUST be a real `TrustedApprovedExecutionPlans`
instance with a durable session, active lease and its own genuine
`TrustedOperationalEpochIntake`. Gateway checks the original root
digest, epoch sequence, prior failed Test finalization, independent
Task completion and quiescence, no provider in flight, actual
Engineer-signed root/epoch journal and exact new plan digest BEFORE
atomically installing the new Task grants. An HMAC command with an
arbitrary plan cannot create authority.

R124's trusted host may opt into `planRepairEpoch.admitReservedEpoch:true`;
otherwise its existing no-authority reservation path is unchanged.
A failed/ambiguous IPC admission is fail-closed and causes outer
approved DAG handoff's normal root shutdown; retrying a consumed
epoch is not allowed. The client validates the exact allowlisted
receipt, including blocked old DAG descendants. No new child DC is
issued as a side effect of admission.

## Verified in new offline fixture tests
The same live original signed Coordinator/intake is held by Gateway
and Engineer in a controlled process. Five additional regressions
cover rejection of a separate owner-only epoch journal, acceptance when
the Gateway independently holds the SAME signed original-root intake,
independent new Backend/Test protected Gateway effects, wrong
digest/epoch/identity, unfinalized Test, replay and root retirement.

## Production cross-process limitation
The live deployment's Gateway process does NOT yet receive an
independently authenticated root-bound epoch intake from the separate
Engineer owner. In that configuration, `admit_epoch` remains DENIED.
This deliberately DOES NOT accept a serialized plan or a replacement
Coordinator over IPC. The next step must establish a safe
cross-process verified epoch journal + original root proof binding
before turning on automatic admission in the persistent host.

Still missing: authentic new child DC issuance/VP and full real
Gitea repair + Docker PASS + review-only PR. No paid Gemini or main merge.
