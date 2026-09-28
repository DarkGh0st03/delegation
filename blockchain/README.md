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
