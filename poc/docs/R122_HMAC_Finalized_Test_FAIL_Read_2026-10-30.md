# R122 — Authenticated re-read of a finalized Test FAIL

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

## Blocking mismatch
The actual R117 A2A dispatcher already finalizes a verified failed Docker
Test via one-use `confirm_test_failure`. R121 Planner would replay that
finalization when called by a suspended dispatcher. It fails closed rather
than continuing an authorized repair. Reusing the old Test Task is forbidden.

## R122 fix
Add owner-private HMAC Unix IPC action `read_test_failure`. Only the
actual Gateway `readVerifiedTestFailure` registry can provide it, on
an already-finalized live Test Task in the current operational epoch.
Exact session, original signed plan digest and runtime Task are checked.
The response contains fixed bounded metadata and no logs, source, VP,
DC, credentials or permission grants.

A new opt-in `alreadyFinalized` route in R115 feedback and
`failedTestAlreadyFinalized` in the R121 Planner request a read-only
confirmation, not another irreversible failure finalization. Signed
Engineer approval, actual Rust root, durable epoch history, branch HEAD
and model grant restrictions remain mandatory.

Three new offline tests include HMAC transport, real Gateway registry,
denial before finalization, session/root mismatches, root retirement and
an already-suspended dispatcher-to-new-epoch planning transition.
They prove no provider effects or child issuance; they are NOT yet
the full real Engineer Host/Gitea/Docker repair E2E.

Next: R123 owner callback wiring, protected discovery and new child DC
issuance under the still-issued root. The old signed-Test same-Task
retry fixture remains invalid; do not greenwash its failure.

No paid Gemini or main changes.
