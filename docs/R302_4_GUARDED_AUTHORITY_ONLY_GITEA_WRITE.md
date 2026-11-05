# R302.4 — native-VP + OPA guarded, single-attempt Gateway Gitea UPDATE

Predecessor `b4a54020ca17fbb9fa8eac4a2e310ef002b12e3f`:
R302.3 proved the actual Gitea version's old_commit_id CAS against
a concurrent unrelated branch commit; R302.1 had already reserved an
immutable signed update intent but could not execute provider writes.

## Architecture

The owner-only `TrustedAuthorityOnlyGiteaMutationExecutor` is invoked
ONLY by `executeAuthorization`, after the independent native
`DirectCoreRustVerifier` checks the signed Child VP (including root,
status, revocation and concrete permission) and a real `OpaPolicyClient`
returns `allow=true`. The caller must explicitly inject
`authorityOnlyMutationEnabled:true`, a matching Gateway admissions
instance, and a `GiteaExecutor` provider. Legacy signed-DAG, fake
verifiers and fake policy-port implementations cannot opt into the path.

Before calling Execute the trusted Gateway owner must separately:

1. Prepare a canonical `update_file` request containing only
   agent-selected branch/path/content (not authority, branch SHA or DC).
2. Call `TrustedAuthorityOnlyGiteaMutationPreflight.stageUpdate` with
   the OWNER-selected immutable old HEAD; it checks the signed Engineer
   root, exact Task/Child and old file blob, then fsyncs a journal
   intent. The original in-memory prepared request is bound to this
   immutable record by a private WeakMap.
3. Reserve the R293 immutable Task flight with `stageTrustedTaskFlight`.
4. Obtain a signed VP for that Task from the real native Rust Child.

The new executor checks the exact live, enrolled Child and Task flight,
repository/feature branch/path/content SHA, root, epoch and request.
It fsyncs an irreversible `.attempt.json` **BEFORE ANY Gitea I/O**.
Then it invokes ONLY `GiteaClient.updateFileWithHeadCas` (not
legacy `updateFile`), requiring the exact pinned parent, blob,
feature-HEAD atomic CAS and independently re-read new commit.

A protected owner HMAC receipt pins expected old/new HEAD, parent,
blob, SHA-256/size of actual committed UTF-8, immutable Task, Child,
request and OPA version. The writer independently reads Gitea before
publishing. An independent receipt observer reopens the protected
0600 `O_NOFOLLOW` file, checks complete schema, HMAC with timing-safe
comparison, Gitea commit parent/new HEAD/blob/contents, and only then
allows a durable completed-evidence journal marker. R293 Task completion
still requires a separate independent observer and a final immutable
Task completion marker.

## Failure behavior

A lost Gitea response, unexpected parent/HEAD/blob, failed receipt,
different Child, expired grant, verification/OPA failure or reused
attempt denies completion. Attempt and receipt files use owner-private
0700 directories, 0600 files, `O_EXCL` and fsync. There is no
blind retry after a potentially applied update; privileged reconciliation
is required.

## Limits

This is **one** atomic update per Task. The trusted owner pins the
expected prior HEAD before effect staging. This is not a generic agent
write tool yet, not a proof of autonomous error recovery, not a Docker
runner, and not a complete Account Suspension application. Legacy
provider write execution is unchanged and is not a fallback. The next
required validation is a full **disposable native Rust/EVM/OPA/Gitea
write E2E** with success, stale-HEAD denial, wrong-Child denial,
revoked-root denial and accurate request/commit evidence.

No paid LLM calls, no production Gitea and no automatic main merge.
