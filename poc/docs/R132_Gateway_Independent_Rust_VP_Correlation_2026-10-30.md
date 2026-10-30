# R132 — Independently correlated Gateway root VP evidence (still non-admitting)

30 October 2026, development branch refactor/post-prof-plan-contracts-20261021.

R132 connects the existing R126 signed epoch ledger, R127 EVM-anchored
nonrevocation observation, R128 actual Adapter-issued root grants and the
R129/R130 fresh-challenge Rust multi-permission VP verifier INSIDE the real
private Gateway IPC process. The request carries ONLY four fixed pins:
session, original plan digest, current plan digest, operational epoch.

The Gateway independently reloads the original unexpired Ed25519
Engineer approval and canonical fsynced epoch records to find the root
credential ID, pinned issuer, Orchestrator DID and current epoch grants.
It does not accept DID, permissions, root ID, signed VP, or a challenge
from an IPC caller or the model. It first compares R128 actual issued
grants with R126 signed requested grants, then sends a fresh 256-bit
challenge through the owner-only R130 Unix HMAC socket; the Orchestrator
signing bearer never reaches Gateway. Gateway's authenticated Rust
Adapter verifier independently checks the resulting signed root VP,
and afterwards R132 reruns the live R127/R128 checks. Root replacement,
revocation during proof, expired or out-of-scope grants fail closed.

Production Gateway opt-in:
- TRUSTED_PLAN_NATIVE_ROOT_STATUS_INSPECT=1
- TRUSTED_PLAN_NATIVE_ROOT_SCOPE_INSPECT=1
- TRUSTED_PLAN_NATIVE_ROOT_VP_INSPECT=1
- TRUSTED_PLAN_ORCHESTRATOR_DID
- TRUSTED_PLAN_ROOT_VP_SOCKET
- TRUSTED_PLAN_ROOT_VP_SECRET_FILE
- TRUSTED_PLAN_ROOT_VP_AUDIENCE
- TRUSTED_PLAN_EPOCH_LEDGER_DIR plus original authenticated Adapter URL/token

The new owner-private `inspect_verified_root_vp` returns ONLY proof
correlation pins and non-authorizing flags:
`cryptographic_presentation_verified:true`,
`native_issued_grants_checked:true`,
`gateway_epoch_admitted:false`,
`execution_authorized:false`,
`child_credential_issued:false`.

Four new offline HMAC socket + Gateway registry tests cover positive
original/repaired epoch proof, identity/grant tampering, forged session
and a root revocation in the middle of VP verification. Rust Adapter
responses in these tests are scripted; they are not full real EVM
integration.

IMPORTANT: Real R125 Gateway still must own the original-root-bound
`TrustedOperationalEpochIntake`, signed prior Task status, terminal
failure quiescence and a secure future Child DC issuance path before
it can admit another operational DAG. This R132 proof does NOT
activate that path. The old Functional Signed DAG positive fixture
still requests forbidden same-Task recovery and is NOT a green
end-to-end repair proof. No paid Gemini and no main merge.
