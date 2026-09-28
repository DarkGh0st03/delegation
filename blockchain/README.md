# Blockchain layer — Phase 1: DID infrastructure

This directory contains the DID foundation for the blockchain portion of the thesis prototype.

## Architectural scope

The production architecture targets a private permissioned EVM network. The PoC uses Anvil because the goal is to validate the application-level contracts and DID integration, not the consensus layer.

DID management is not the research contribution of the thesis, so the project reuses the established `did:ethr` / ERC-1056 model rather than defining a new DID method.

The vendored contract in `src/vendor/EthereumDIDRegistry.sol` comes from the upstream `decentralized-identity/ethr-did-resolver` monorepo.

A `did:ethr` identifier based on an EVM address exists implicitly: creating the EVM key pair is enough to define the DID. The ERC-1056 registry is used for DID updates such as controller rotation, delegates, verification methods, and service endpoints.

## Phase 1A — registry foundation

Run the Solidity tests:

```powershell
forge test
```

Run a persistent local chain:

```powershell
anvil --chain-id 31337
```

Deploy the registry from another terminal:

```powershell
.\scripts\deploy-did-registry.ps1 -PrivateKey "<ANVIL_PRIVATE_KEY>"
```

For a fresh default Anvil instance the first deployment is typically deterministic, but the registry address must always be taken from the actual `forge create` output.

If Anvil is stopped and restarted without persistence, its chain state is reset and the registry must be deployed again.

## Phase 1B — resolve a real did:ethr DID

Install the DID client:

```powershell
cd did-client
npm install
```

Example using the default Anvil account 1 as the DID identity:

```bash
REGISTRY_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
IDENTITY_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
npm run resolve
```

For Anvil chain ID `31337`, the hexadecimal network identifier is `0x7a69`:

```text
did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

The minimal DID Document contains the default secp256k1 controller derived from the EVM identity.

## Phase 1B — enrich the DID Document

The next step publishes two ERC-1056 attributes owned by the same DID controller:

- an Ed25519 verification method, using the official `did/pub/Ed25519/veriKey` attribute form;
- a `DelegationService` endpoint that will later expose delegation verification material off-chain.

For the local PoC, `publish-did.mjs` generates an Ed25519 key pair once and stores it under `did-client/local/`. That directory is ignored by Git. This demo key will later be replaced/wired to the Ed25519 key material managed by the Rust identity layer.

With the default Anvil account 1:

```bash
REGISTRY_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
IDENTITY_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
npm run publish
```

The script defaults to:

```text
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
DELEGATION_SERVICE_ENDPOINT=http://127.0.0.1:3000/delegation-material
VALIDITY_SECONDS=31536000
```

After the two transactions are confirmed, resolve the DID again:

```bash
REGISTRY_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
IDENTITY_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
npm run resolve
```

The reconstructed DID Document should now contain the original EVM controller plus an `Ed25519VerificationKey2020` verification method and a `DelegationService` service entry.

## What remains after Phase 1

Once this enriched DID resolves correctly, the DID layer is sufficient for the thesis PoC. The next blockchain component is the thesis-specific `EnterpriseTrustRegistry`, followed by the `IssuerRegistry`.


---

# Phase 2A — Enterprise Trust Registry

After the DID layer is working end-to-end, the next thesis-specific contract is `EnterpriseTrustRegistry.sol`.

Its responsibility is deliberately separate from DID resolution. ERC-1056 answers who controls an identity; this registry answers whether the enterprise currently trusts that identity.

The contract implements:

- fail-closed state for unknown identities;
- governance enrollment for strong enterprise identities;
- `Active / Suspended / Revoked` lifecycle;
- terminal revocation;
- governance-only trust-anchor assignment;
- sponsored enrollment for dynamic agents;
- proof-of-control for sponsored agents through the current ERC-1056 DID controller;
- sponsor kill-switch for its own agents;
- two-step governance-address rotation.

Sponsored enrollment records provenance only. It does not create business authorization and does not replace Delegation Credentials.

Run:

```powershell
forge test
```

The new tests cover governance enrollment, trust anchors, sponsored enrollment, controller rotation, suspension/reactivation, sponsor revocation, and fail-closed behavior.


---

# Phase 3A — Issuer Registry

`IssuerRegistry.sol` anchors the public material needed to verify Delegation Credentials without putting the credentials, permissions, witnesses, or Status List bitstrings on-chain.

The contract deliberately treats the two kinds of mutable public material differently.

## Accumulator material: historical versions

Accumulator public material is published as an immutable sequence of hash commitments per issuer:

```text
issuer
  ├── version 1 -> materialHash 1
  ├── version 2 -> materialHash 2
  └── version 3 -> materialHash 3
```

Old versions remain readable. A Delegation Credential issued against version 1 must still be verified against version 1 even after the issuer rotates to version 2.

The credential will later carry the exact `issuerMaterialVersion`; the Rust verifier will retrieve the corresponding off-chain public material and compare its digest with the on-chain commitment.

## Status Lists: current version

A Bitstring Status List uses a stable `listId`, a fixed purpose, and only the latest anchored document hash:

```text
issuer + listId
  purpose = Revocation | Suspension
  currentVersion
  currentDocumentHash
```

Status updates advance `currentVersion`. Verification intentionally uses the current version so a credential revoked after issuance is rejected.

The full Status List Credential and its `encodedList` remain off-chain. The chain stores only the opaque list identifier, purpose, current version, and document hash. The integration layer will derive `listId` deterministically from the Status List Credential identifier.

Only the current ERC-1056 controller of an `Active` enterprise identity may publish issuer material or update its Status Lists.

Run:

```powershell
forge test
```

The Phase 3A tests cover historical accumulator versions, lifecycle gating, DID controller rotation, current Status List versioning, duplicate/no-op protection, and sponsored active agents acting as issuers.


---

# Phase 4A — Rust material-version binding

The Rust Delegation Credential now carries an `imv` (`issuerMaterialVersion`) field for every delegation hop.

The value identifies the exact accumulator public-material version used by that issuer when the credential was created. It is also included in the accumulator-protected metadata together with the credential id, delegatee, issuance/expiration times, and status-list reference. Changing `imv` therefore invalidates the metadata witness.

The in-memory `TrustRegistry` mirrors the Solidity `IssuerRegistry` semantics:

```text
issuer
  ├── version 1 -> AccumulatorPublicData
  ├── version 2 -> AccumulatorPublicData
  └── ...
```

Old versions remain addressable through `get_accumulator_data_at_version`. `OurVerifier` resolves the version carried by each credential/hierarchy hop instead of implicitly using the issuer's latest accumulator material.

Status List semantics remain intentionally different: the credential still carries only the stable Status List reference, index, and purpose; the current anchored Status List version will be resolved at verification time.

This checkpoint prepares the codebase for Phase 4B, where an EVM-backed Rust adapter will implement the same trust/material interfaces against `EthereumDIDRegistry`, `EnterpriseTrustRegistry`, and `IssuerRegistry`.


---

# Phase 4B.1 — Rust EVM registry reader

The first Rust/EVM bridge is intentionally read-only. `EvmRegistryReader` uses Alloy over JSON-RPC and exposes synchronous methods to the current synchronous verifier code.

It reads:

- the current ERC-1056 DID owner;
- enterprise lifecycle status and trust-anchor state;
- the latest accumulator material version and any historical commitment;
- the current Status List anchor.

The reader accepts the thesis `did:ethr:<chainId>:<address>` identifiers directly and rejects DIDs from a different configured chain.

Run the unit tests first:

```powershell
cargo fmt --check
cargo test
```

With the Anvil deployment used during Phase 3B, the live probe can be executed from Git Bash with:

```bash
DID_REGISTRY_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
ENTERPRISE_TRUST_REGISTRY_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 \
ISSUER_REGISTRY_ADDRESS=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 \
ISSUER_ID=did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
STATUS_LIST_CREDENTIAL=urn:delegation:status-list:root:revocation-1 \
cargo run --example evm_registry_probe
```

This probe validates real Rust -> JSON-RPC -> Solidity reads before the reader is wired into the `TrustRegistry` implementation used by `OurVerifier`.


---

# Phase 4B.2 — verifier-side EVM-backed TrustRegistry

`EvmBackedTrustRegistry` now implements the existing Rust `TrustRegistry` interface for verification.

The split is intentional:

```text
EVM contracts
  -> identity lifecycle
  -> trust-anchor state
  -> accumulator material hash/version

Off-chain PublicMaterialProvider
  -> complete AccumulatorPublicData
  -> DID verification JWK
```

When the verifier requests accumulator material version `N`, the adapter:

1. checks that the issuer is currently `Active` on-chain;
2. reads the exact version-`N` commitment from `IssuerRegistry`;
3. obtains the full public material off-chain;
4. canonical-serializes it with arkworks;
5. computes `keccak256`;
6. rejects it unless the hash equals the on-chain commitment.

This keeps large cryptographic material off-chain while making tampering detectable.

The current `InMemoryPublicMaterialProvider` is a PoC provider. Its verification-key side will later be replaced by the `did:ethr` resolver boundary, and its accumulator side by the delegation-material service endpoint already published in the DID Document.

The EVM-backed registry is verifier-side/read-only. Issuer and governance mutations remain explicit signed blockchain transaction workflows rather than local `TrustRegistry` mutations.


---

# Phase 4B.3 — OurVerifier through EVM-backed trust

The verifier test suite now exercises a real `OurVerifier` instance with `EvmBackedTrustRegistry` instead of `InMemoryTrustRegistry`.

Issuance is still created locally for deterministic tests, then the public data is split exactly as in the deployment architecture:

```text
mock EVM state
  -> issuer Active
  -> presenter Active
  -> root trustAnchor=true
  -> accumulator version/hash anchor

off-chain provider
  -> exact AccumulatorPublicData
  -> presenter Ed25519 verification JWK
```

The resulting VP is verified by the unchanged `OurVerifier` API. This demonstrates that the verifier already consumes the `TrustRegistry` abstraction correctly and can switch from in-memory trust to blockchain-backed trust without changing delegation-proof logic.

The next integration step is to replace the mock EVM reader in this verification path with the live `EvmRegistryReader`, and then replace the in-memory public-material provider with the real DID/delegation-material resolution boundary.


---

# Phase 4B.4 — live OurVerifier against Anvil

`examples/live_evm_verifier.rs` removes the mock EVM reader from the verification path.

For a clean one-shot integration run, use two previously unused Anvil identities: one as the root issuer and one as the holder. The example:

1. creates a real Rust Delegation Credential and VP;
2. obtains the real accumulator public material generated by `OurIssuer`;
3. computes its canonical `keccak256` commitment;
4. uses the governance signer to enroll the fresh root and holder identities on Anvil;
5. assigns the root as an enterprise trust anchor;
6. publishes the real accumulator commitment through the root's EVM controller;
7. creates a real `EvmRegistryReader`;
8. checks that on-chain material version 1 matches the credential's `imv=1`;
9. runs the unchanged `OurVerifier` with `EvmBackedTrustRegistry`;
10. prints `authorization=ACCEPT` only after the complete proof succeeds.

The status-list resolver remains in-memory in this checkpoint. Live Status List fetch/authentication/anchoring is the next boundary.

This is deliberately a one-shot local integration example: the selected root must not already have accumulator material in the deployed `IssuerRegistry`.

Required environment variables:

```text
DID_REGISTRY_ADDRESS
ENTERPRISE_TRUST_REGISTRY_ADDRESS
ISSUER_REGISTRY_ADDRESS
ROOT_ID
HOLDER_ID
GOVERNANCE_PRIVATE_KEY
ROOT_PRIVATE_KEY
```

Optional:

```text
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
```

Run:

```bash
cargo run --example live_evm_verifier
```

Use only disposable local Anvil accounts for the two private-key environment variables.
