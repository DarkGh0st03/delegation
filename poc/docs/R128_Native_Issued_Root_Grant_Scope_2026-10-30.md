# R128 — Observe actual Rust-issued root grant claims, without authorizing a new DAG

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

R126 compared immutable epoch plans with the originally signed Engineer
permission envelope. R127 independently queried the Rust Adapter's anchored
root revocation bit. Neither proved the actual set of permissions emitted
when Rust issued the Engineer-to-Orchestrator root, or its expiration.

R128 adds Gateway-only `POST /v1/credentials/root/inspect` in the existing
Rust Delegation Adapter. The endpoint can read ONLY an actual issued
Engineer's root in its CURRENT in-process issuance registry, with pinned
Orchestrator delegatee and empty delegation hierarchy; checks issuance
and expiration nanoseconds, bounded unique native Permission records,
and current revocation through the original status inspector. This
read-only endpoint never serializes the full DC, witnesses, VP or secrets.
The native Adapter HTTP caller must have Gateway VerifyPresentation
capability; Engineer, agents and unknown caller cannot use it.

A private Gateway-only client `readIssuedRoot` rejects incomplete, extra,
expired, revoked, in-memory/unanchored and duplicate responses. A new
R126/R127 inspector method compares the actual issued grants against the
separately verified Ed25519 Engineer *maximum* scope, then checks that
EVERY permission of the pinned current signed operational epoch lies
within the issued Rust grant set. Native status is checked before and
after, and the root ID / on-disk journal are revalidated.

Owner-private HMAC IPC action `inspect_issued_root` transmits only
session, original and current plan digest, and epoch number. The
non-authorizing result attests ONLY comparison of the native issuer
record, not independent proof of a cryptographically verified DC:
`native_issued_grants_checked:true`,
`cryptographic_presentation_verified:false`,
`execution_authorized:false`, `gateway_epoch_admitted:false`,
`child_credential_issued:false`. No grant arrays cross IPC.

Production enablement is opt-in:
`TRUSTED_PLAN_NATIVE_ROOT_STATUS_INSPECT=1` plus
`TRUSTED_PLAN_NATIVE_ROOT_SCOPE_INSPECT=1` and
`TRUSTED_PLAN_ORCHESTRATOR_DID`, all bound to the original Gateway
Adapter service URL/token and signed fsynced epoch directory.

One Rust unit regression plus four Gateway tests cover actual root
lineage, issuer, delegatee, grant subset, expiration, revoked/unsigned
status, wrong epoch and journal substitution. The Gateway tests stub
the Adapter's EVM observation and are not native end-to-end proof.

**Important:** This is issuance registry observation, NOT signed
presentation verification, live independently verified accumulator
material, status witness, or a replacement for R125's same-root-bound
Gateway intake. Actual production admission remains DENIED absent the
further complete cryptographic authority proof. No Gemini charges,
Docker recovery claim or main merge.
