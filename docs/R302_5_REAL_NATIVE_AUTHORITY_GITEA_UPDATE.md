# R302.5 — real native Rust/EVM + OPA + atomic Gitea write acceptance

Based on R302.4 integrated, owner-only Gateway mutation adapter.

The isolated workflow `R302 Native Rust EVM OPA Authorized Gitea Atomic
UPDATE (No AI)` reproduces the successful R300 trust chain, but
substitutes an actual one-shot `update_file`:

1. Disposable CI owner provisions a real Gitea feature branch and file
   under `apps/backend/users/`, before signing any approval.
2. Synthetic CI Engineer signs an immutable `update_file` **directory**
   permission, never a full DAG. Rust issues the operational root.
3. Trusted Coordinator registers Backend Task with one **file** update
   permission. Rust issues the Child DC, witness and signed VP. The
   Gateway independently enrolls it and reserves the Task flight.
4. A distinct trusted Gateway owner pins the branch HEAD and the old
   target blob before execution; that immutable intent and the
   `O_EXCL` one-shot journal marker survive process restarts.
5. Native Rust verifies real EVM trust/issuer/status/revocation and
   the signed Child + directory→file attenuation. Independent OPA
   returns allow for exactly that file/operation.
6. The Gateway never invokes `GiteaExecutor.updateFile`. Instead a
   trusted mutation executor fsyncs the exact Task **attempt**, uses
   the separate atomic branch-HEAD CAS Gitea transport, re-fetches
   the actual commit/parent/branch/file through an independent
   read-only Runner token, signs a protected HMAC receipt, and
   separately reopens and checks the signed receipt.
7. The Gateway's independent completion observer attests Task
   completion only AFTER verified receipt and durable evidence;
   a repeated Prepare request must not write a second time.
8. Negative probes: stale HEAD before staging, sibling and operation
   mismatch, forged challenge, different Child under same root,
   revoked Engineer root, and replay.
9. The same workflow verifies that legacy provider update was NEVER
   called, `main` is not changed, paid model calls are 0, and there
   was exactly one authorized CAS UPDATE.

This is an isolated end-to-end acceptance on disposable Gitea,
Anvil/EVM and OPA. It is not an Account Suspension implementation
with Gemini BE/FE/Test agents and Docker acceptance, not a substitute
for the final review-only PR test, and not production deployment.

The companion R302.3 live CAS workflow already independently proves
that a concurrent writer changing a separate file on the branch
causes a stale commit's CAS to fail even when the old target blob
does not change.

**Success gate:** same SHA has Fast CI SUCCESS and this workflow
SUCCESS with the `r302_authority_only_native_evm_atomic_update`
JSON event and `provider_calls:1`, `legacy_writes:0`,
`real_opa_allow:true`, `completion_attested:true`.
No paid AI or merge to main.
