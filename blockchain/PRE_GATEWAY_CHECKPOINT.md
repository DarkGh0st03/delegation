# Pre-Gateway checkpoint

This document is the handoff point between the completed trust/blockchain work and the next thesis phase, the Cloud Access Gateway.

## Scope decision

The PoC deliberately uses a local Anvil EVM. The target architecture remains a private/permissioned EVM network, but validator/consensus engineering is outside the thesis implementation scope.

The contracts are fixed/non-upgradeable. The PoC uses one governance address as the local stand-in for the architecture's enterprise governance/multisig role. Building a DAO, governance token, proxy system, or custom consensus layer is intentionally out of scope.

## Final pre-Gateway trust architecture

```text
did:ethr / EthereumDIDRegistry
        |
        +--> current identity/controller + Ed25519 assertion key
        |
EnterpriseTrustRegistry
        |
        +--> enrollment
        +--> Active / Suspended / Revoked
        +--> trustAnchor
        +--> sponsor provenance
        |
IssuerRegistry
        |
        +--> historical accumulator material commitments
        +--> current Status List version/hash/purpose
        |
        v
Rust DelegationVerifier
        |
        +--> exact historical accumulator material version
        +--> live enterprise lifecycle/trust
        +--> fresh did:ethr Ed25519 key resolution
        +--> signed/authenticated Status List JWT
        +--> current on-chain Status List commitment
        +--> Bitstring status bit
        +--> holder/audience/challenge/permission checks
        |
        v
VerifiedDelegation
        |
        v
NEXT: Cloud Access Gateway -> OPA -> Gitea
```

## What is now implemented

### DID layer

- Reuses ERC-1056 `EthereumDIDRegistry` and `did:ethr`.
- The official `ethr-did-resolver` reconstructs DID Documents.
- Rust does not reimplement ERC-1056 event reconstruction.
- The verifier resolves the current Ed25519 assertion key from the DID Document.
- DID resolution is performed fresh on the authorization path so key rotation/revocation is not hidden behind a long-lived cache.
- The PoC profile requires exactly one active Ed25519 assertion method and fails closed if resolution is absent or ambiguous.

### Enterprise trust layer

- Governance enrollment for strong identities.
- Sponsored enrollment with controller confirmation for dynamic agents.
- Active / Suspended / Revoked lifecycle.
- Revocation is terminal.
- Trust anchors are explicit and require an active identity.
- Sponsor provenance does not grant authorization.
- Sponsor kill switch exists for sponsored agents.

### Issuer material

- Full accumulator public material stays off-chain.
- The chain stores only its hash commitment.
- Commitments are historical and versioned.
- Each Delegation Credential carries `issuerMaterialVersion` (`imv`).
- `DelegationVerifier` fetches the exact historical version referenced by each delegation hop.
- The off-chain material is canonical-compressed with arkworks and hashed with Keccak-256 before comparison with the on-chain commitment.

The transport used to obtain the large off-chain accumulator payload is intentionally hidden behind `AccumulatorMaterialProvider`. The blockchain security property does not depend on that transport because the exact payload is commitment-checked before use. Wiring this provider to the future Gateway/service deployment is an integration concern, not another blockchain contract.

### Credential status

- Uses W3C Bitstring Status List semantics with the thesis profile `statusSize=1`.
- Minimum 131072 entries.
- MSB-first bit indexing.
- Revocation and suspension purposes supported.
- The Delegation Credential carries the stable Status List identifier, index, and purpose.
- The verifier always reads the current Status List anchor from `IssuerRegistry`.
- `listId = keccak256(exact UTF-8 statusListCredential identifier)`.
- The final PoC status artifact is a compact EdDSA JWT containing the Bitstring Status List Credential payload.
- The JWT signature is verified with the issuer's current Ed25519 assertion key resolved from `did:ethr`.
- The embedded Status List issuer must equal the expected delegation issuer.
- `currentArtifactHash = keccak256(exact compact JWT bytes)`.
- Only after signature verification and on-chain hash matching is the bitstring parsed.
- Updating the current Status List from bit 0 to bit 1 invalidates the same already-issued Delegation Credential without modifying it.

## What stays off-chain by design

The blockchain does not store Delegation Credentials, Verifiable Presentations, permissions, hierarchy, accumulator witnesses, full accumulator material, Status List bitstrings, prompts/tasks, A2A messages, Gitea data, or private keys.

## Final live validation

`examples/live_pre_gateway_closure.rs` validates the full pre-Gateway trust path using two fresh Anvil identities. The validation was rerun successfully after the Rust architecture reorganization, confirming that the refactor changed module structure and names without changing behavior.

It performs:

1. real Rust Delegation Credential and VP issuance;
2. enterprise enrollment and root trust-anchor assignment;
3. real accumulator commitment publication;
4. publication of the exact Rust-generated Ed25519 keys in ERC-1056;
5. DID resolution through the official `ethr-did-resolver`;
6. creation and EdDSA signing of a Bitstring Status List Credential JWT;
7. Status List version 1 hash anchoring;
8. successful verification of the VP;
9. creation of Status List version 2 with the same credential's bit set;
10. on-chain current-artifact-hash update;
11. re-verification of the exact same VP;
12. rejection because the credential is now revoked.

Successful output ends with:

```text
didResolution=OK
statusCredentialSignature=VALID
beforeRevocation=ACCEPT
...
afterRevocation=REJECT
...
preGatewayBlockchainPhase=COMPLETE
```

## One-command validation

For a completely fresh local validation, with no Anvil node already running, execute from the repository root:

```bash
bash blockchain/scripts/run-pre-gateway-local.sh
```

The wrapper adds the local Foundry installation to `PATH`, starts a fresh deterministic Anvil chain, waits for JSON-RPC readiness, configures the standard disposable local development identities, calls `deploy-local.sh`, extracts and exports the three deployed contract addresses automatically, and then calls `check-pre-gateway.sh`.

On Git Bash for Windows, Anvil is opened in a separate Mintty/Git Bash window and intentionally remains running after validation. The original terminal becomes an interactive Bash with the RPC URL, private development keys, DID identifiers, and deployed registry addresses already exported, so additional manual `cast`, Rust, or integration checks can be executed against the exact validated chain state. The generated local environment is also saved under `.git/pre-gateway-local.env` for reuse from another terminal. The final live validation intentionally leaves the demo credential revoked in Status List version 2.

The embedded Anvil mnemonic/private keys are the standard public development keys and MUST NEVER be reused on a real network or with real funds. Stop the persistent local chain with `Ctrl+C` in the Anvil window when it is no longer needed.

For manual/debug operation, `check-pre-gateway.sh` remains available when Anvil, contract addresses, governance key, and fresh root/holder keys have already been configured. It derives the two did:ethr identifiers, runs Rust formatting/tests, Solidity tests, verifies Node resolver dependencies, and executes the final live integration.

## Current freeze point

After this checkpoint, no new blockchain functionality is required for the initial thesis PoC.

The Cloud Access Gateway, OPA/Gitea integration, and agent communication protocols are intentionally frozen while the implemented pre-Gateway architecture is studied and reviewed. When development resumes, the Gateway remains the next planned integration layer: it will consume `VerifiedDelegation`, enforce one-time challenge/replay handling, call OPA for local policy, and act as the PEP in front of Gitea.
