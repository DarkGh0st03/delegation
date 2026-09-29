# Delegation — thesis working baseline

This repository is the working codebase for the master's thesis project based on the original Delegation Credential implementation.

## Current purpose

The active `src/` tree contains the pre-Gateway implementation that is now being studied and documented before any new integration work continues:

- structured resource/operation permissions for the thesis authorization domain;
- generic credential / VC / VP structures;
- the thesis Delegation Credential and delegation-chain model;
- issuer and verifier abstractions with concrete delegation implementations;
- request-bound presentation verification through holder, audience, challenge, and required-permission checks;
- structured verification results;
- cryptographic accumulator management and verification;
- the in-memory trust implementation used for deterministic tests;
- a live Anvil-backed trust layer using did:ethr/ERC-1056, `EnterpriseTrustRegistry` and `IssuerRegistry`;
- blockchain-anchored accumulator-material versioning and Bitstring Status List revocation;
- fresh DID-resolved Ed25519 verification keys and authenticated Status List JWTs.

Gateway, OPA, Gitea integration, and agent-to-agent communication protocols are intentionally frozen for now. The current objective is to understand and document the pre-Gateway system in detail before extending it.

## Active source tree

The Rust modules are organized by architectural responsibility. Trait files are kept next to their concrete implementations so the relationship between abstraction and implementation is visible directly from the tree.

```text
src/
├── lib.rs
└── delegation/
    ├── authorization/
    │   ├── authorization_request.rs
    │   ├── operation.rs
    │   ├── permission.rs
    │   ├── resource_uri.rs
    │   ├── verified_delegation.rs
    │   └── mod.rs
    │
    ├── credentials/
    │   ├── generic/
    │   │   ├── credential_trait.rs
    │   │   ├── verifiable_credential.rs
    │   │   ├── verifiable_presentation.rs
    │   │   └── mod.rs
    │   ├── delegation/
    │   │   ├── delegation_evidence_trait.rs
    │   │   ├── delegation_credential.rs
    │   │   ├── delegation_chain_entry.rs
    │   │   └── mod.rs
    │   └── mod.rs
    │
    ├── issuance/
    │   ├── issuer_trait.rs
    │   ├── delegation_issuer.rs
    │   └── mod.rs
    │
    ├── verification/
    │   ├── verifier_trait.rs
    │   ├── delegation_verifier.rs
    │   ├── timing.rs
    │   └── mod.rs
    │
    ├── accumulator/
    │   ├── accumulator_manager.rs
    │   ├── accumulator_verifier.rs
    │   ├── accumulator_utils.rs
    │   ├── accumulator_public_data.rs
    │   └── mod.rs
    │
    ├── status/
    │   ├── model/
    │   │   ├── bitstring_status_list_entry.rs
    │   │   ├── status_purpose.rs
    │   │   ├── status_list_credential_artifact.rs
    │   │   └── mod.rs
    │   ├── provider/
    │   │   ├── status_list_credential_provider_trait.rs
    │   │   ├── in_memory_status_list_provider.rs
    │   │   ├── jwt_status_list_provider.rs
    │   │   └── mod.rs
    │   ├── resolver/
    │   │   ├── status_list_resolver_trait.rs
    │   │   ├── bitstring_status_list_resolver.rs
    │   │   ├── evm_anchored_status_list_resolver.rs
    │   │   ├── in_memory_status_list_resolver.rs
    │   │   └── mod.rs
    │   └── mod.rs
    │
    └── trust/
        ├── model/
        │   ├── identity_status.rs
        │   └── mod.rs
        ├── registry/
        │   ├── trust_registry_trait.rs
        │   ├── in_memory_trust_registry.rs
        │   ├── evm_backed_trust_registry.rs
        │   └── mod.rs
        ├── material/
        │   ├── public_material_provider_traits.rs
        │   ├── composite_public_material_provider.rs
        │   ├── in_memory_public_material_provider.rs
        │   ├── in_memory_verification_key_provider.rs
        │   ├── did_ethr_verification_key_provider.rs
        │   └── mod.rs
        ├── evm/
        │   ├── evm_reader_traits.rs
        │   ├── evm_registry_reader.rs
        │   └── mod.rs
        └── mod.rs
```

The main concrete names now describe their architectural role directly:

- `DelegationCredential` is the thesis delegation credential;
- `DelegationChainEntry` represents one previous hop stored in the delegation hierarchy;
- `DelegationEvidence` is the common trait implemented by the current credential and hierarchy entries;
- `DelegationIssuer` implements `Issuer`;
- `DelegationVerifier` implements `Verifier`;
- `EvmAnchoredStatusListResolver` combines authenticated off-chain Status List material with the current EVM anchor.

## Temporary reference material

Code that is not part of the thesis baseline but may be useful later remains under:

```text
reference_temporary/
```

This includes the original benchmark machinery, alternative PJV / SD-JWT implementations, efficient variants and auxiliary code used by those variants. It is reference-only and is not part of the active Rust module tree.

Generated benchmark outputs and plotting material from the original paper are not required by the active implementation. The untouched original state remains preserved in the Git branch:

```text
original-backup-before-thesis-cleanup
```

## Current checkpoint

The pre-Gateway trust/blockchain implementation is complete and reproducible through:

```bash
bash blockchain/scripts/run-pre-gateway-local.sh
```

The script starts a fresh local Anvil chain, deploys the contracts, configures the Rust integration, performs the complete pre-Gateway validation, and leaves the validated Anvil session available for further manual inspection.

The implementation is intentionally frozen at this checkpoint while the current architecture is studied. Gateway / OPA / Gitea and agent communication work will resume only after that study phase.
