# R303.1 — Test Agent / Runner immutable commit gate (NO Docker launch)

Base: `ac86431a9d8fc25ac2e0baaa410ca81cd2f3396f`,
with R302.5 native Rust/EVM/OPA and Gitea CAS SUCCESS.
Branch: `refactor/post-prof-plan-contracts-20261021`.

## Objective

The authority-only Test Agent should never select an arbitrary Git
commit, claim a test succeeded or gain implicit execution authority from
a JSON body. It must be issued a permission-limited Child DC under
the original signed Engineer root and test precisely the trusted owner
pinned Gitea HEAD. A failed or ambiguous Runner launch must not
silently repeat a potentially expensive Docker execution.

## Implemented, owner-only

- `TrustedAuthorityOnlyGatewayAdmissions.assertTrustedRunnerIntentBinding`
  resolves an ORIGINAL, unconsumed Gateway Prepare; requires the Test
  Agent role, the exact signed `run_tests` branch permission,
  Coordinator Task/epoch, enrolled native Child DC, active authority
  and completed dependencies. Agent tool arguments contain only
  `branch` and the known `poc-default` profile.
- `TrustedAuthorityOnlyRunnerPreflight.stageRunner` receives an
  immutable commit SHA from a **trusted owner**, not from the Test Agent;
  independently fetches actual feature HEAD twice through a private
  `GiteaClient`. Both must match exactly before the durable
  reservation. It binds the intent to the original object via a
  private WeakMap; a copied serialized Prepare does not inherit
  authorization.
- `DurableAuthorityOnlyRunnerIntentJournal` persists the session
  digest, root, Child, Task ID/epoch, original request fingerprint,
  exact Gitea repo/branch/commit, fixed profile and timestamp in an
  owner-provisioned 0700 directory, with 0600 `O_NOFOLLOW`,
  append-only `O_EXCL`, fsync file and directory. An irreversible
  `reserveAttempt` marker must be acquired before a future Runner
  HTTP POST. Duplicate or ambiguous attempts fail closed after
  restart.
- All returned status structures have
  `runner_execution_authorized:false`. No RunnerClient, Docker or
  provider call occurs from these classes. The old Gateway
  authority-only `run_tests` denial remains untouched.

## Checks

Fast CI includes journal tests: immutable Task reservation, wrong
Child/root/commit/profile, duplicate and concurrent attempts,
missing/corrupted/shared receipt file, and restart replay. The
Engineer-session suite additionally uses a synthetic signed
`run_tests` grant and native Child fixture to verify the Test Agent
role and Gitea HEAD binding, with zero Docker calls.

## Next acceptance gate

R303.2 must connect **only after** real native Rust VP and OPA,
recheck pinned HEAD immediately before Runner launch, reserve the
attempt before any POST, invoke a trusted authenticated Runner
controller, independently corroborate the EXACT tested SHA and all
project tests/acceptance phases, and persist evidence before unlocking
a downstream Task. Runner FAIL must remain a failure (not success
receipt); recover only by a separately approved next Task/revision
without broadening Engineer permissions.

Then run a disposable native Rust/EVM/OPA + real Docker Runner
workflow, checking PASS, FAIL, wrong Child, stale HEAD and revoked
root, with no paid Gemini calls. Do not claim the full Account
Suspension pilot is finished until that validation passes.
