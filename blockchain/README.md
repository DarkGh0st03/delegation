# Blockchain layer — Phase 1: DID infrastructure

This directory starts the blockchain portion of the thesis prototype.

## Scope of Phase 1A

The first checkpoint intentionally does **not** implement enterprise trust, delegation material anchoring, or Bitstring Status List anchoring yet.

It establishes only the EVM/DID foundation:

1. a Foundry workspace;
2. the standard ERC-1056 `EthereumDIDRegistry` used by `did:ethr`;
3. local tests for identity ownership, controller rotation, and owner-only DID updates;
4. a small deployment helper for a local Anvil network.

The production architecture targets a private permissioned EVM network. The PoC uses Anvil because the goal is to validate the application-level contracts and their integration, not the consensus layer.

## Why use EthereumDIDRegistry instead of a custom DID contract?

DID management is not the research contribution of the thesis. The project therefore reuses the established `did:ethr` registry rather than implementing a new DID method.

The vendored Solidity source in `src/vendor/EthereumDIDRegistry.sol` is taken from the MIT-licensed upstream project:

- repository: `decentralized-identity/ethr-did-resolver`
- package: `packages/ethr-did-registry`
- contract: `EthereumDIDRegistry.sol`
- upstream Solidity version: `^0.8.24`

The contract treats an Ethereum address as a DID identity. An identity owns itself by default, can rotate its controller with `changeOwner`, can add/revoke delegates, and can publish DID attributes through events. A `did:ethr` resolver reconstructs the DID Document from registry state and event history.

## Run the first checkpoint

From this directory:

```powershell
forge test
```

To run a persistent local chain:

```powershell
anvil --chain-id 31337
```

Then deploy the DID registry from a second terminal with one of the private keys printed by Anvil:

```powershell
.\scripts\deploy-did-registry.ps1 -PrivateKey "<ANVIL_PRIVATE_KEY>"
```

The script deploys to `http://127.0.0.1:8545` by default.

## What the tests prove

- a fresh `did:ethr` identity is controlled by its own EVM address by default;
- only the current controller can publish DID attributes;
- the current controller can rotate control to another EVM address;
- after rotation, the old controller can no longer modify the identity and the new controller can.

## Next checkpoint — Phase 1B

After this checkpoint is compiled and tested locally, Phase 1B will add the off-chain DID client/resolver demonstration:

```text
Anvil
  ↓
EthereumDIDRegistry
  ↓
did:ethr identity
  ↓
publish Ed25519 verification material / service endpoint
  ↓
ethr-did-resolver
  ↓
resolved DID Document
```

That completes the DID layer before implementing the thesis-specific `EnterpriseTrustRegistry`.
