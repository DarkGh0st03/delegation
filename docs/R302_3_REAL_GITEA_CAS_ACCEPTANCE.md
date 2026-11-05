# R302.3 — disposable Gitea HEAD-CAS acceptance (no AI)

Base: `5fec497a70452808c3b51fa61cd83f9e4e77a142`.
This is the **provider transport** acceptance that follows the R302.1
signed update intent reservation and R302.2 offline protocol tests.

## CI objective

Run a single inexpensive Gitea-only Docker workflow without Rust builds,
Anvil, OPA or paid model credentials.

1. Bootstrap the existing version-pinned disposable thesis Gitea and
   verify its protected `main` baseline.
2. The trusted CI owner creates a throwaway feature branch and one
   code file, recording its exact HEAD and blob SHA.
3. The trusted Gitea transport produces a staged Git commit from that
   immutable HEAD; independently reads the single parent and file,
   then promotes the staged commit through Gitea's
   `PUT /branches/{branch}` with `old_commit_id` and `force:false`.
4. Independently re-read the real feature HEAD, file bytes/blob and
   confirm `main` stayed unchanged.
5. Repeat against another throwaway branch with an external competing
   owner changing a **different file** immediately before the CAS.
   The original target blob remains unchanged, yet the CAS must
   refuse the stale HEAD; the authorized target file must remain
   unmodified. No automatic retry is allowed.
6. Emit `r302_gitea_atomic_head_cas_live` only on success and verify
   zero paid-model calls.

The private staging ref is retained if the outcome is ambiguous;
reconciliation and eventual cleanup require a separately authorized
trusted owner. Do not allow agents to pick staging branches.

## Not yet a completed delegated mutation

This workflow proves the exact Gitea Git API semantics and concurrency
boundary but **does not** enable an authority-only delegated provider
write. Connecting the R302.1 immutable intent to native Rust VP,
actual OPA, Gitea CAS result, signed/write-evidence publication and
independent commit verification still requires a separate guarded
Gateway execution path and a full Rust/EVM/OPA end-to-end CI.

There are no mutations to the user's Github `main`, no review-only
PR and no autonomous agent workflow in this acceptance test.
