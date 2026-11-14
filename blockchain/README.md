# Blockchain / Trust layer

This directory contains the active EVM-backed trust layer used by the thesis PoC.

## Current architecture

The target architecture is a private/permissioned EVM network. The local PoC uses Anvil to validate the application-level trust contracts and their integration with the Rust verifier.

The active contracts are:

- `src/vendor/EthereumDIDRegistry.sol` — ERC-1056 / `did:ethr` identity control and DID updates.
- `src/EnterpriseTrustRegistry.sol` — enterprise enrollment, `Active / Suspended / Revoked` lifecycle, trust anchors, and sponsor provenance.
- `src/IssuerRegistry.sol` — historical accumulator-material commitments and current Bitstring Status List artifact anchors.

The blockchain is the source of truth for trust state and commitments. Delegation Credentials, Verifiable Presentations, permissions, hierarchy, witnesses, complete accumulator public material, and Status List bodies remain off-chain.

## Rust integration

The active Rust path is:

```text
DelegationVerifier
  -> EvmTrustResolver
       -> EvmRegistryReader
            -> EthereumDIDRegistry
            -> EnterpriseTrustRegistry
            -> IssuerRegistry
       -> AccumulatorMaterialProvider
            -> off-chain AccumulatorPublicData
       -> VerificationKeyProvider
            -> DidEthrVerificationKeyProvider / did:ethr

DelegationVerifier
  -> EvmAnchoredStatusListResolver
       -> IssuerRegistry current Status List anchor
       -> authenticated off-chain Status List JWT
       -> Bitstring Status List payload parsing and status-bit validation
```

In the running system these contracts are deployed on Anvil by the
`trust-bootstrap` service (`deploy/bootstrap/trust-bootstrap.sh`, which calls
`scripts/deploy-local.sh`); the Engineer core then enrols the identity of every
role (Engineer, Orchestrator and each specialist agent).

## Off-chain providers intentionally retained

Some components still use in-memory storage because they represent off-chain sources in the local PoC rather than legacy trust decisions:

- `InMemoryTrustStore` holds the Rust issuer material before its public commitment/key data are published to the EVM/DID layer.
- `InMemoryPublicMaterialStore` supplies the complete accumulator public material off-chain; `EvmTrustResolver` accepts it only when its hash matches the on-chain commitment.
- `InMemoryStatusListStore` supplies the raw signed Status List artifact off-chain. `JwtAuthenticatedStatusListCredentialProvider` authenticates the JWT using DID-resolved keys, and `EvmAnchoredStatusListResolver` checks its exact commitment against the current on-chain anchor.

The old fully in-memory status resolver and dedicated in-memory verification-key provider have been removed from the production module tree.

## DID client

Install the Node dependencies once:

```bash
cd blockchain/did-client
npm ci --ignore-scripts --no-audit --no-fund
cd ../..
```

The active scripts are:

- `resolve-did-json.mjs` — resolves the current `did:ethr` DID Document.
- `publish-ed25519.mjs` — publishes the Rust-generated Ed25519 public verification key through ERC-1056.

## Solidity tests

From the repository root:

```bash
cd blockchain
forge test
cd ..
```
