# R115 — Cross-process Test FAIL joined to original signed Rust root and durable epochs

Date: 30 October 2026. Development branch: `refactor/post-prof-plan-contracts-20261021`.

## Problem

R114 added an HMAC-authenticated, one-use private Unix-socket Test FAIL
confirmation. It finalized only an actual provider-corroborated Runner failure
in the Gateway. The remote receipt alone did **not** revalidate the authentic
Engineer signature, the original issued Rust root grants, or fsynced sequential
operational epoch journal owned by the Engineer process. An A2A text failure
or arbitrary signed metadata must never authorize repair.

## R115 security contract

- `prepareTrustedRemoteRepairFeedback` only accepts an actual
  `TrustedPlanIpcClient`, original `TrustedOperationalEpochIntake` and
  the **identical Coordinator instance** bound to that intake.
- Before the IPC request, `verifiedEpochHistory()` checks the original
  Ed25519 Engineer approval and every protected epoch record against the
  current Coordinator-issued Rust root identifier, original plan digest and
  **exact permission set**. The root digest sent to Gateway comes only
  from this verified journal — not untrusted JSON.
- Gateway IPC `confirm_test_failure` validates original session/digest,
  exact task role, real failed Docker Runner evidence, dependencies, current
  epoch, no concurrent effects and one-use finalization. R114 bounds the
  receipt fields and rejects extra source/log/credential data.
- After the IPC round trip the intake repeats the complete verification
  and rejects a retired/replaced root, changed epoch or changed digest. The
  failed Test must belong to the latest persisted epoch and working branch.
- The returned immutable signal is `repair_planning_eligible` or
  `repair_budget_exhausted`, with `execution_authorized:false` and
  `permission_granted:false`. It carries no JWT, VP, code, raw logs,
  signing keys, model prompt or write grant.
- Both original in-process R112 and remote R115 routes share the **same**
  strict feedback validator to prevent inconsistent validation rules.

## Test boundaries and fail-closed responsibilities

Four offline regression tests exercise the real Gateway plan registry and
HMAC Unix IPC, signed Engineer receipt, original epoch journal, successful
failed-Runner evidence, wrong Coordinator/session/Task, missing failed Test,
IPC replay and root revocation after the IPC result. The scripted Gateway
provider is a fixture, not real Docker; this is **not** the finished
Gitea/Docker FAIL→repair→PASS test and no Gemini inference is used.

A failed IPC or changed root rejects the signal. The owning Engineer Host
must still perform full terminal Gateway/Rust cleanup when it catches any
such failure. This helper intentionally has no authority to revoke a root,
run recovery, issue child DCs or open a PR.

## Next integration

Introduce an owner-private recovery controller that composes:
R115 remote eligibility → authorized R109 discovery read → R106–R111
repair epoch admission/child DC allocation → fresh Runner PASS on exact
Gitea SHA → review-only PR. This must preserve root lifecycle and independent
job-watchdog checks; do not use an `instanceof` spoof or a fake in-process
Gateway registry to bypass R112. Paid Gemini remains disabled; `main`
is untouched.
