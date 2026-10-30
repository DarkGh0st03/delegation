# R142 — Retired signed repair Root EVM revocation + exact-SHA Gateway PASS

Date: 30 October 2026. Development branch only.

R139 real Docker/Gitea provider success is independently confirmed at
GitHub Actions #41085369293. R140's post-retirement Gateway Runner Test
PASS and R141's double Gitea branch HEAD reads were previously green.

R142 adds a **new native Adapter revocation check** to the Gateway-only
`TrustedGatewayNativeRootStatusReader`. It sends only the original
root credential ID extracted by the signed R126 epoch-001 inspector,
not a client-supplied root ID, through the existing private Gateway
bearer to POST /v1/credentials/status/inspect. The Adapter's
EVM-anchored signed Status List JWT must authenticate with
`status_purpose:revocation`, `status_set:true`, the exact original ID,
`source:evm_anchored_signed_jwt`, and a nonnegative anchor version.
A missing root, HTTP error, expired/unanchored/false bit cannot
impersonate successful revocation.

`read_retired_root_revocation` is an authenticated source-free
HMAC Unix Gateway command. It first insists on the original
Gateway registry's DURABLY retired, exact-SHA, signed new Test Task
PASS; it then independently checks the pinned original signed epoch
and native root revocation; finally rechecks Gateway Runner acceptance.
It exposes no bearer, DC, VP, code, signature, native credential bytes,
or authorization to create/merge a PR.

The owner-only R141 witness adds `verifyRevokedRetiredExactSha()`,
sandwiching this independent revocation read with two R141 checks
of the live Gitea HEAD and Gateway Runner PASS. A moved feature SHA,
forged Test or malformed EVM status fails closed.

Offline tests use the genuine Gateway IPC and signed approvals but
simulate ONLY the Adapter status response and Gitea provider result.
They do not prove a real EVM chain anchor, actual Rust root shutdown,
or the unified R133–R139 real Docker recovery. The PR flag remains
`pull_request_authorized:false` throughout.

Next: tie owner Coordinator's `assertOperationalClosureConfirmed()`
to these receipts, replace mocked EVM/Gitea with real providers, and
run a single authorized fail→repair→pass→review-only PR CI.

No Gemini calls; no merge or modifications to main.
