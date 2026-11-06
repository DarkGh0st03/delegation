# R336 — Durable authenticated native Runner FAIL receipt

R335 classifies the *original* RunnerClient result from the exact
owner authenticated Test request; its CI passed at `6a3ecd50`.

This checkpoint adds a durable HMAC-SHA256-signed, owner-only
`runner-fail` receipt in an exclusive 0600 file under a protected
0700 directory. The publisher accepts only a genuine, branded
RunnerClient FAIL, the original native Test intent and Gateway binding,
the validated seven-phase order, original exact Gitea commit,
and owner-observed real policy identifier. It checks Gitea HEAD before
and immediately before the one-shot fsynced write.

An independently constructed trusted observer checks exact fields,
Task/Child/epoch/authority pins, the HMAC, time window, and Gitea HEAD
twice. It returns only a non-authorizing failure observation with a
digest and first failed phase. Tampering, cross-Task replay, changed
HEAD and forged outputs are rejected.

`TrustedAuthorityOnlyRunnerExecutor` accepts an optional *paired*
failure publisher and observer; when configured, it writes and
independently verifies the result and **still rejects Task success**.
The default existing R333 native PASS scenario remains unchanged.
The fixture-driven offline tests use the actual RunnerClient parser,
GiteaClient and private filesystem; they do NOT themselves execute
real Docker/Rust.

## Remaining D1

The production owner must explicitly provision this paired channel,
correlate the signed FAIL with an immutable durable Runner attempt,
and consume it only through an independent Gateway failed-Task
handoff. A distinct epoch-specific Child/Task under the original
Engineer permission ceiling and a verified post-repair Docker PASS
are still unimplemented. No A2A status or FAIL string authorizes
recovery. No paid AI or `main` mutation.
