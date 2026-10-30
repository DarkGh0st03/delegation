# R134–R136 — From independently admitted repair to scoped A2A and Gateway confirmation

30 October 2026. Branch `refactor/post-prof-plan-contracts-20261021`.

## Implemented
- R133: Gateway independently checks the original Rust-root VP, signed
  epochs and a finalized real Runner Test FAIL before installing a second DAG.
- R134: a new Task is first bound by the actual HMAC Gateway registry,
  then it receives an attenuated, one-use Child DC via the existing Rust
  Adapter and the durable child issuance journal. Original credentials
  and old Task IDs cannot be replayed.
- R135: the trusted owner derives Agent identity, Card, role, paths,
  operation hints and instructions from the authenticated signed epoch.
  Gateway source-of-truth dependencies are checked BEFORE any irreversible
  child issuance. A single preissued Child DC is then carried by the
  existing protected A2A runner. A2A completion is not provider completion.
- R136: the owner asks the authenticated Gateway to confirm a completed
  A2A Task. Gateway requires real independently corroborated provider
  effects + its trusted completion attestor. Without them, it denies
  completion; the same Task cannot simply be replayed.

## Limits and next acceptance
The R134–R136 offline regressions exercise live Gateway IPC, a trusted
signed approval/epoch journal and A2A Task shape; native Adapter issuance
and provider effects in those regressions are scripted. This is NOT yet the
full Gitea/Docker/EVM integrated repair execution.

We still need an owner-controlled iterative driver running the ACTUAL
new repair DAG through new A2A Task IDs. In an isolated real Gitea/Docker
test, show Test FAIL at exact SHA → new epoch/DC → authorized Backend fix
→ new Test with Docker PASS on updated SHA → review-only PR. No automatic
merge, no second Gemini paid pilot until this scripted E2E succeeds.

No paid Gemini, no changes to main.
