# R129 — Fresh root signed-presentation verification, without automatic Gateway admission

30 October 2026 — branch: `refactor/post-prof-plan-contracts-20261021`.

## Scope
The Rust Delegation Adapter already implements `/v1/presentations` for
the Orchestrator's signing identity and `/v1/verify-multiple` for the
independent Gateway verifier. R128's issuer-local inspection is not a
substitute for that cryptographic verification.

R129 introduces a bounded owner-only Gateway
`TrustedGatewayRootVpVerifier`. A separately configured trusted
Orchestrator signing callback receives ONLY the pinned original root ID,
explicit required permissions, a Gateway-pinned audience and a NEW
256-bit random challenge. The Gateway then sends the signed VP to the
existing Rust multi-permission verifier and requires an exact root
credential ID, Engineer issuer DID, Orchestrator presenter DID,
hierarchy depth zero, grant set and unexpired timestamp.

No model, MCP, A2A or untrusted HTTP request may select the signer,
root ID or approved permission set. A new challenge is generated on
each call and invalid/replayed responses are rejected. The fixture
tests check exact root identity/permissions, challenge freshness,
signature-verifier failure, altered claim sets, expiry and empty grants.

## Explicit limitation
This module is a prepared private integration port, NOT yet connected
to the real R124 owner callback and Gateway IPC. The tests exercise
a strict mock verifier; the Rust API already has separate crypto
integration tests. It is not a live EVM-backed verified root proof,
and cannot alone establish continuity of epoch ownership.

Returned proof always reports `gateway_epoch_admitted:false`,
`execution_authorized:false`, `child_credential_issued:false`.
R125 still denies a Gateway process lacking the genuinely root-bound
operational Intake. Next integrate the owner-produced fresh VP and
independently verified R126/R128 epoch scope in the actual cross-process
Gateway without transferring Orchestrator signing secrets.

No paid Gemini run; no main merge.
