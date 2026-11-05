# R285 — permission-only root issuance, revocation and durable replay fencing

**Date:** 2026-11-05  
**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**Parent baseline:** R284 `3f918be78986717ff8ec6415a7e4b2b3e895a017`

## New opt-in Engineer-side path

`TrustedAuthorityOnlyEngineerSession` is an independent **trusted-host-only**
two-root transition. It does **not** require an approved Task, A2A Agent,
execution order or signed DAG before issuing the operational DC. Instead it
obtains the locally verified, signed **permission-only authority** from
`SignedAuthorityOnlyFileStore`, checks its session/repository/Git SHA,
requirement digest, Engineer identity and expiry, and sends the exact selected
permission pairs to `EngineerCredentialPort.issueScopedOrchestratorRoot`.

The production credential port can use the already-established **direct
Engineer Rust Node-API** binding. This module neither creates a new issuer nor
uses MCP to issue Engineer roots.

## Security ordering

1. The Engineer host pins a trusted repository snapshot and requirement.
2. It validates a fresh preliminary RootParameters object and reads the
   strictly read-only temporary permission list.
3. A mandatory durable local journal exclusively reserves the session
   (`O_EXCL|O_NOFOLLOW`, private 0700 directory/0600 marker, fsync).
   A second process cannot issue another preliminary root with the same
   session. The marker is never deleted on error or cancellation.
4. The Gateway must pin the main Gitea SHA before the native Engineer
   issues the preliminary root.
5. The Engineer loads and verifies the authority-only signed receipt from
   the protected file store. Signer and signature are checked by the store,
   and R285 rechecks the **in-process verified receipt brand**, grant digest,
   expiry and trusted session context before side effects.
6. The host reserves the exact operational authority digest and credential
   identity durably, before any irreversible revocation.
7. It **confirms Gateway Planning retirement first**, then requires
   successful native Rust preliminary-root revocation. Only after both
   complete may it issue the independent operational root. Native status
   entry/credential ID may not be reused.
8. The operational root must not outlive the signed authorization receipt,
   and its output permissions/credential ID must match the exact issued
   grant. Any ambiguous failure enters a terminal fail-closed state.
9. Private cancellation retires the planning registry and revokes the
   preliminary root without any operational issuance.

The approval receipt is not an authority to call the Gateway directly:
the runtime needs separate trusted task/permission binding and Rust
delegation enforcement to operate. No model, A2A message, FunctionTool,
public network input, or untrusted GUI parameter can supply root permissions.

## Implemented proof (offline test)

`trusted-authority-only-engineer-session.test.ts` exercises disposable
protected directories and a deterministic Rust-port stub to prove the
ordered preliminary issue, Gateway retirement, native revoke and operational
issue, one-use journal across process recreation, root identity separation,
wrong requirement rejection, expired authority, hostile forged receipt,
revocation failure, cancellation, and no second approval.

Fast CI runs this test with Node 22 TypeScript stripping. A green test does
**not** prove that native Anvil/EVM issuance already uses this new path in
production: it validates the transition contract and the Rust-port interface.

## Explicitly not migrated

- The existing signed-DAG Engineer session / Gateway / dispatcher remain
  unchanged and authoritative for historical free CI.
- The dynamic Execution Task registry, Child DC issuance and root-to-Task
  binding are **not** cut over; there is no new Gateway admission path yet.
- The journal only prevents duplicate **session activation** and
  operational issuance per session. Global status index allocation and
  credential-ID uniqueness across unrelated sessions must also be enforced
  independently by the underlying issuer/coordinator.
- No hierarchical directory grants until the Rust R2/R3 containment proofs;
  root rights are still exact (ResourceURI, Operation) pairs.
- No GUI/human approval, model invocation or paid Gemini pilot is performed.

## Next checkpoint

R1 needs a reviewed **trusted coordinator activation** using the verified
authority digest instead of the legacy signed-DAG digest. Implement durable
task identity/epoch history and an authorization ceiling at Gateway and
Rust child issuance before enabling flexible Task assignment. Full native
same-SHA CI is reserved for that cutover, not every contract change.
