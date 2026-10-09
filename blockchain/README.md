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
  -> EvmBackedTrustRegistry
       -> EvmRegistryReader
            -> EthereumDIDRegistry
            -> EnterpriseTrustRegistry
            -> IssuerRegistry
       -> CompositePublicMaterialProvider
            -> off-chain AccumulatorPublicData
            -> did:ethr verification key resolution

DelegationVerifier
  -> EvmAnchoredStatusListResolver
       -> IssuerRegistry current Status List anchor
       -> authenticated off-chain Status List JWT
       -> BitstringStatusListResolver
```

The final integration example is:

```text
examples/live_pre_gateway_closure.rs
```

It demonstrates DID-key resolution, EVM-backed trust, accumulator-material commitment verification, authenticated Status List verification, and the transition from `ACCEPT` to `REJECT` after revocation.

## Off-chain providers intentionally retained

Some components still use in-memory storage because they represent off-chain sources in the local PoC rather than legacy trust decisions:

- `InMemoryTrustRegistry` is used on the issuance side of the final local example to create the Rust issuer material before its public commitment/key data are published to the EVM/DID layer.
- `InMemoryPublicMaterialProvider` supplies the complete accumulator public material off-chain; `EvmBackedTrustRegistry` accepts it only when its hash matches the on-chain commitment.
- `InMemoryStatusListCredentialProvider` supplies the current signed Status List artifact off-chain; `EvmAnchoredStatusListResolver` authenticates it and checks its exact commitment against the current on-chain anchor.

The old fully in-memory status resolver and dedicated in-memory verification-key provider have been removed from the production module tree.

## DID client

Install the Node dependencies once:

```bash
cd blockchain/did-client
npm install
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

## Complete local validation

The easiest path is the one-command launcher:

```bash
bash blockchain/scripts/run-pre-gateway-local.sh
```

It:

1. starts a fresh Anvil chain;
2. deploys the three contracts;
3. configures the deterministic local identities;
4. runs Rust formatting and tests;
5. runs Solidity tests;
6. resolves the DID verification keys;
7. executes `live_pre_gateway_closure`;
8. verifies `beforeRevocation=ACCEPT` and `afterRevocation=REJECT`;
9. finishes with `preGatewayBlockchainPhase=COMPLETE`.

Anvil is intentionally left running after successful validation.

## Manual validation on an already running Anvil instance

If Anvil and the deployed contracts are already available, export the required environment variables and run:

```bash
bash blockchain/scripts/check-pre-gateway.sh
```

Required variables:

```text
DID_REGISTRY_ADDRESS
ENTERPRISE_TRUST_REGISTRY_ADDRESS
ISSUER_REGISTRY_ADDRESS
GOVERNANCE_PRIVATE_KEY
ROOT_PRIVATE_KEY
HOLDER_PRIVATE_KEY
```

Optional defaults:

```text
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
```

`ROOT_ID` and `HOLDER_ID` are derived automatically from the private keys when omitted.

A successful final run must include:

```text
didResolution=OK
statusCredentialSignature=VALID
beforeRevocation=ACCEPT
afterRevocation=REJECT
preGatewayBlockchainPhase=COMPLETE
```
