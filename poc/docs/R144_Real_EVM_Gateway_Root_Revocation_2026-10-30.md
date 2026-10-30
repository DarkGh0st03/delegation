# R144 — Real native Rust EVM revocation through the production Gateway reader

Date: 30 October 2026. Zero AI billing, development branch only.

The independent R139/R143 real Gitea/Docker FAIL-to-PASS + draft PR test
is green (run 41090453543). R142's signed-Gateway post-retirement status
logic previously had a scripted Rust/EVM response. R144 replaces THAT
specific uncertainty with an additional **real native Adapter + Anvil**
test in the existing EVM CI: it imports the same
`TrustedGatewayNativeRootStatusReader` that the R142 Gateway inspector
uses in production. No mock implementation or hand-made status response.

In a single real native runtime, Engineer issues a Rust DC operational
root with an EVM-backed status-list index. The private Gateway caller
bearer reads the Adapter's actual status and issued grant registry:
the root must be nonrevoked and match its issued permissions, while
`readRevokedRoot()` MUST refuse it before the on-chain revocation.

After a genuine native Engineer `POST /v1/credentials/status` revoke
transaction, `readRevokedRoot()` MUST validate the now EVM-anchored
`status_set:true` response, and `readActiveRoot()` and
`readIssuedRoot()` MUST fail closed. Unknown root credentials are
not accepted. Existing Core Rust verifier replays the older VP and
confirms it is rejected after actual revocation.

This runs as the `native-real-evm-e2e.mjs` step in both native EVM and
cumulative offline GitHub workflows, with Node's TS-stripping support
enabled. It does not create a Gitea PR and has no new paid model access.

**Important limit:** this is real EVM verification on the same
Adapter/status reader as R142, but it is still not the R133–R142
unified live owner flow with real Gitea/Docker repair under the
same original root. The R139 provider test separately proves real
Docker FAIL-to-PASS. These two independent successes must not be
presented as one cryptographically delegated recovery experiment.

Next: run a unified zero-billing test in one disposable process/env,
with original Engineer approval, Rust root, Gateway HMAC admission,
Child DC issuance, real A2A/Gitea mutations, Docker PASS and
review-only PR. No main modification or automatic merge.
