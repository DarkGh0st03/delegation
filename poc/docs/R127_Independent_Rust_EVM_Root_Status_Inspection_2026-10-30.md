# R127 — Independent Rust Adapter root revocation observation (no execution authority)

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

The Rust Delegation Adapter already exposes the authenticated Gateway-only
POST `/v1/credentials/status/inspect`. Its CryptoRuntime rejects unknown
credential IDs and in EVM profile verifies a signed Status List JWT against
the current chain anchor before returning the current revocation bit.
R127 REUSES this existing Rust endpoint instead of inventing a verifier.

`TrustedGatewayNativeRootStatusReader` uses the operator-configured
Gateway bearer, bounded timeout, exact read-only request and strict
response allowlist. Only `source:evm_anchored_signed_jwt`,
`status_purpose:revocation`, `status_set:false`, the exact queried
root credential ID and a nonnegative anchor version are accepted.
The mock/in-memory Adapter profile is NOT trusted for this observation.

The signed-epoch inspector first validates the original unexpired
Ed25519 Engineer approval and fsynced complete R126 journal. It then
reads the ORIGINAL root credential ID from the owner-only verified
epoch-001 file, obtains a fresh native Adapter status, detects root-ID
or file replacement during the call and revalidates the signed ledger.
The native root ID NEVER comes from model/Task/IPC JSON.

Optional production bootstrap flag
`TRUSTED_PLAN_NATIVE_ROOT_STATUS_INSPECT=1` requires an explicitly
configured shared epoch directory AND real Gateway Adapter URL/token.
The owner-only HMAC IPC `inspect_native_root` only reports
`native_root_status_correlated_not_permission_authority` together
with exact root/session/epoch digest pins and all of
`execution_authorized:false`, `root_permissions_verified:false`,
`gateway_epoch_admitted:false`, `child_credential_issued:false`.

**Critical limit:** a native anchored non-revocation bit and credential
presence do NOT expose/check the ACTUAL Rust-issued DC grant array,
credential expiry, signature, or permission chain. The journal's root ID
also still needs independent binding to the issuance event. Therefore
R125 `admit_epoch` stays DENIED in deployed Gateway without a real
`TrustedOperationalEpochIntake`. No child issuance or automatic repair.

Four fixture tests exercise live private HMAC IPC and mocked anchored
Adapter responses, revoked/memory-only/wrong-ID failures, out-of-sync
epochs and a journal replacement race. This is not a real EVM RPC
integration or real Docker FAIL→repair→PASS→review PR demonstration.

Next: independently corroborate the issued Rust parent DC content,
expiry, signature, status and journal root ID; only then consider a
secure Gateway root-bound intake with a bounded repair epoch.
No paid Gemini calls and no main merge.
