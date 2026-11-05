# R302.1 — fail-closed Gitea update preflight (no provider writes)

Parent: `e2ab6021cba73529e86ba1d838a1f0098e716a55`.
Development branch: `refactor/post-prof-plan-contracts-20261021`.

## Objective and reason for two stages

R301 proved two successful, independently attested Gitea READs in
one Task, with real native Rust/EVM/OPA and crash-durable evidence
chaining. The next milestone is an UPDATE. But Gitea's
`PUT /contents/{filepath}` API accepts an existing file *blob SHA*,
not an atomic **branch HEAD compare-and-swap**. Two writers could
advance the branch on another file while the blob remains unchanged.
Reading HEAD immediately before/after PUT is insufficient to guarantee
that an update started from the approved revision.

Therefore, **R302.1 stages a true immutable intent but never performs
an actual write.** Do not mistake it for R302's final acceptance.

## Implemented

1. Gateway independently checks a freshly prepared `update_file`
   request against the immutable Engineer signature, Coordinator Task,
   exact enrolled native Child DC, live TTL, request fingerprint and
   canonical operation/resource. Read-only Tasks and dependencies that
   are not complete cannot register an update attempt.
2. `TrustedAuthorityOnlyGiteaMutationPreflight` requires an
   **owner-provided expected branch commit** (40-hex SHA), a
   trusted `GiteaClient`, the exact configured feature branch, and a
   separately provisioned intent journal. It rereads HEAD, obtains
   the text file at the expected immutable commit, and rereads HEAD.
   Any mismatch refuses the reservation.
3. The owner-only journal stores the original branch HEAD, old blob
   SHA, SHA-256 of old/new UTF-8 content, content size, session,
   signed authority digest, root, Child, Task and prepared request.
   It stores **no file contents**, credential material or agent
   inference traces. Owner-private mode 0700/0600, `O_EXCL`,
   `O_NOFOLLOW`, file and directory fsync prevent overwriting or
   replay after crash. Only **one mutation attempt per Task**.
4. The resulting marker always contains
   `provider_write_authorized:false`.
   This class exposes **no provider-write method**. The existing
   Gateway Execute still terminal-denies `update_file`, even if the
   R296 read-only option is enabled.

## Offline acceptance

Tests cover one valid signed `update_file` Task with enrolled Child,
fixed SHA/old blob capture, persistence and no content disclosure,
moved branch HEAD, duplicate attempt/restart, missing permission,
caller-supplied SHA rejection and **zero POST/PUT/DELETE calls**.

## Remaining R302 exit gate

Develop an **atomic** Gitea branch compare-and-swap transport (not just
blob-SHA PUT or a double HEAD read), pass the same protected intent
through real native Rust VP and independently evaluated OPA,
reserve the effect irreversibly before the first PUT/push, and verify
the resulting commit/tree/file and privileged write evidence after
the CAS. Fail-closed on unknown provider outcome: no blind retry.
Run one disposable CI scenario verifying success, concurrent branch
movement denial, exact leaf scope, wrong Child and EVM revocation.
Only then enable `update_file` in the authority-only Executor.

No `main` merge, production Gitea writes, paid Gemini, Docker or PR
automation are enabled by this step.
