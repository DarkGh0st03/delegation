# R302.2 — owner-only Gitea commit staging and atomic branch-HEAD CAS

Prerequisite: R302.1 signed mutation intent is durably reserved, with
owner-pinned old HEAD, old blob SHA and SHA-256 new content. That stage
did not enable any provider writes.

## Why file-blob compare alone does not suffice

Gitea's contents PUT allows an old *blob* SHA but does not atomically
check the HEAD of the entire feature branch. An unrelated commit might
advance the branch without changing that blob; a simple pre/post HEAD
check cannot prevent an unauthorized commit built on the moved branch.

Gitea's documented `PUT /repos/{owner}/{repo}/branches/{branch}`
accepts both `old_commit_id` and `new_commit_id`, and returns a
conflict when the expected old HEAD no longer matches. Gitea
`POST /branches` can create a new branch from a pinned commit SHA
through `old_ref_name`.

## Transport implemented (NOT active in Gateway execution)

`GiteaClient.updateFileWithHeadCas` is an explicitly called owner-only
conditional transport. It validates canonical feature-branch and file
scope, trusted owner-pinned 40-hex HEAD/blob identifiers, bounded
UTF-8 content and request ID, then:

1. Compares the actual feature branch HEAD and old file blob with
   the exact expected immutable snapshot.
2. Creates a unique private staging branch
   `feature/r302-internal-<request-binding-hash>` from precisely
   that immutable HEAD, not an arbitrary moving name.
3. Updates the file **only on the private staging branch**, with the
   existing file blob SHA precondition.
4. Fetches the staged Git commit, requires **one exact parent** equal
   to expected HEAD, reads back staged content/blob, and validates its
   branch HEAD.
5. Before changing the authorized branch, checks expected HEAD once
   more, then performs the actual atomic Gitea branch-ref CAS with
   `force:false`, old_commit_id=expected and new_commit_id=staged.
6. Reads back the feature HEAD, file blob and contents at new commit.
   On any mismatch, refused result or network uncertainty it throws.
   There is **no automatic retry**. The intermediate staging ref is
   retained for privileged reconciliation/audit, not silently deleted.

This is deliberately **not invoked from `executeAuthorization`** yet:
Rust VP + real OPA + enrolled Child DC + original R302.1 durable intent,
separate write evidence publication and independent reread must be
wired before exposure. The existing signed-DAG executor path is not
changed, and the authority-only `update_file` terminal denial
remains in force.

## Tests and remaining acceptance

Fast CI exercises the deterministic Gitea REST protocol with an
authenticated simulated transport. It checks exact-parent staging,
original blob, CAS parameters, successful promotion, stale original
HEAD, foreign original blob, branch movement at the CAS, forged staged
parent, wrong branch/path and replay refusal.

These are NOT live Gitea integration results. A disposable Gitea
workflow must prove the exact protocol works against the pinned CI
Gitea version, then the trusted Gateway must generate authenticated
post-mutation evidence from real native Rust/OPA/Gitea before enabling
a legitimate delegated update.

No production provider, main merge, Docker write, or paid model usage.
