# R350.12 — Exact owner-pinned native Gitea provider identity

## Scope

The R349→R350 Engineer session must bind both its actual Gitea mutation
preflight and its actual Runner preflight to one original `GiteaClient`,
the same Gateway Admissions object, the exact approved feature branch and
the repository pinned in the signed Engineer grant.

The new `GiteaClient.isPinnedRepositoryClient` validates the native
client's **class-private** owner/repository fields; it does not trust
overridable network responses, a caller-supplied string or a Gitea URL
chosen by an agent. The mutation/Runner preflight classes also expose
`isNativeForOwner`, which verifies their private original Gateway,
Gitea object, repository and branch. The owner-private
`bindNativeGatewayEffects` now requires a `giteaClient` that matches
both preflights by **identity**. An independently created Gitea client
with otherwise identical repository strings is rejected.

## Evidence and next gate

All existing R350.3, R350.8 and R350.9 suites now bind the same
`GiteaClient` object used by both real preflights. Negative tests cover
another native client, wrong repository, wrong branch, and terminal
one-shot refusal after a mismatched binding.

This does NOT prove a live Rust/EVM/OPA/Gitea/Docker execution: the
R350.9 external Git reads and cryptographic material remain offline
fixtures. R331 proves real native provider execution under a different
synthetic approval session. The next test must replace that synthetic
approval with the authenticated R349 Engineer session, using the exact
same new owner-pinned Gitea client and protected A2A dispatch.

No Gemini API call, main modification or merge.
