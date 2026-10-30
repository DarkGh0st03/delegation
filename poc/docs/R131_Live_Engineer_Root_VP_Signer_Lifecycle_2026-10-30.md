# R131 — Bind private root VP signing to live Engineer-owned Rust root

Date 30 October 2026, branch refactor/post-prof-plan-contracts-20261021.

The authenticated Engineer Host's reviewed paid GitHub handoff now
optionally starts R130's owner-only Unix root presentation service
after the original signed operational root was actually issued,
the Gateway activated and the live GitHub run rechecked. Owner-only
configuration cannot come from OIDC, HTTP, A2A, MCP or the model.
The presenter obtains credential ID and exact grants from the SAME
TrustedExecutionCoordinator; neither are model-proposed inputs.

The signer checks the live owner phase, original plan digest,
root identity and complete grant set BEFORE native signing and AGAIN
after the async Adapter call. Its synchronous fence is set before
any Gateway and Rust close/revocation IO, including in-flight cancel
and lost GitHub job. A root closed during native signing CANNOT
return a signed VP.

Three additional regressions check active→retired root, immediate
owner fence and closure during in-flight signing. This is an explicit
opt-in PAID reviewed handoff integration; it does not call Gemini
by itself and does not change scripted tests or main.

Remaining: independently verify VP in the real Gateway process,
complete safe cross-process operational epoch admission, attenuated
new Child DC issuance and actual Gitea/Docker repair E2E.

R131.2 makes the live-root binding **mandatory** in every private signer
server constructor, including offline fixtures. There is no fallback
unguarded signer bootstrap path; scripted tests pass an explicit fake
Coordinator, whereas the Engineer handoff uses the actual live instance.
