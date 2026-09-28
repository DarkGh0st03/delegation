# Blockchain layer — Phase 1: DID infrastructure

This directory starts the blockchain portion of the thesis prototype.

## Phase 1A — ERC-1056 registry foundation

The first checkpoint intentionally does **not** implement enterprise trust, delegation material anchoring, or Bitstring Status List anchoring yet.

It establishes only the EVM/DID foundation:

1. a Foundry workspace;
2. the standard ERC-1056 `EthereumDIDRegistry` used by `did:ethr`;
3. local tests for identity ownership, controller rotation, and owner-only DID updates;
4. a deployment helper for a local Anvil network.

The production architecture targets a private permissioned EVM network. The PoC uses Anvil because the goal is to validate the application-level contracts and their integration, not the consensus layer.

## Why use EthereumDIDRegistry instead of a custom DID contract?

DID management is not the research contribution of the thesis. The project therefore reuses the established `did:ethr` registry rather than implementing a new DID method.

The vendored Solidity source in `src/vendor/EthereumDIDRegistry.sol` is taken from the upstream `decentralized-identity/ethr-did-resolver` monorepo, package `ethr-did-registry`.

A `did:ethr` identifier based on an EVM address exists implicitly: creating the EVM key pair is enough to define the DID. The ERC-1056 registry is needed when the controller wants to rotate control, add delegates, or publish DID attributes such as additional verification methods and service endpoints.

## Test Phase 1A

From this directory:

```powershell
forge test
```

Run a persistent local chain:

```powershell
anvil --chain-id 31337
```

Deploy the DID registry from a second terminal with one of the private keys printed by Anvil:

```powershell
.\scripts\deploy-did-registry.ps1 -PrivateKey "<ANVIL_PRIVATE_KEY>"
```

The script deploys to `http://127.0.0.1:8545` by default.

## Phase 1B — resolve a real did:ethr DID

The second checkpoint uses the official `ethr-did-resolver` off-chain library to resolve a DID against the ERC-1056 registry running on Anvil.

Install the small DID client:

```powershell
cd did-client
npm install
```

Set the address of the deployed registry and the EVM identity to resolve. Example for the default Anvil chain:

```powershell
$env:REGISTRY_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"
$env:IDENTITY_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
npm run resolve
```

In Git Bash use:

```bash
REGISTRY_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 \
IDENTITY_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
npm run resolve
```

For Anvil chain ID `31337`, the DID uses the hexadecimal chain identifier `0x7a69`, so the example identity resolves as:

```text
did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

At this point no DID update transaction is required. The resolver should return the minimal DID Document derived from the EVM identity and the configured network.

## Next Phase 1B checkpoint

After minimal resolution works, the same DID will publish an Ed25519 verification method and a service endpoint through ERC-1056 events, then the resolver will reconstruct the enriched DID Document.
