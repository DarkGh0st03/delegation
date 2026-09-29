# Delegation — thesis working baseline

This repository is the working codebase for the master's thesis project based on the original Delegation Credential implementation.

## Current purpose

The active `src/` tree intentionally contains only the baseline implementation needed to understand and adapt the proposed Delegation Credential:

- structured resource/operation permissions for the thesis authorization domain;
  Resources are validated as absolute URIs, while operations are selected from an explicit software-engineering vocabulary;
- generic credential / VC / VP structures;
- the thesis Delegation Credential model and delegation-chain representation;
- explicit issuance and verification modules built around `DelegationIssuer` and `DelegationVerifier`;
- request-bound presentation verification through holder, audience, challenge, and required-permission checks;
- structured verification results that can be consumed by the future Cloud Access Gateway / OPA layer;
- cryptographic accumulator management and verification;
- the original in-memory trust simulator for deterministic issuer-side tests;
- a live Anvil-backed trust layer using did:ethr/ERC-1056, EnterpriseTrustRegistry and IssuerRegistry;
- blockchain-anchored accumulator-material versioning and Bitstring Status List revocation;
- fresh DID-resolved Ed25519 verification keys and authenticated Status List JWTs.

The repository has been simplified before starting the thesis-specific modifications so that the core execution path is easier to study.

## Active source tree

The active Rust tree is organized by architectural responsibility so that traits, models, concrete providers, and concrete resolvers can be identified directly from the directory structure.

```text
src/
├── lib.rs
└── delegation/
    ├── accumulator/
    │   ├── accumulator_manager.rs
    │   ├── accumulator_public_data.rs
    │   ├── accumulator_utils.rs
    │   ├── accumulator_verifier.rs
    │   └── mod.rs
    ├── authorization/
    │   ├── authorization_request.rs
    │   ├── operation.rs
    │   ├── permission.rs
    │   ├── resource_uri.rs
    │   ├── verified_delegation.rs
    │   └── mod.rs
    ├── credentials/
    │   ├── delegation/
    │   │   ├── delegation_chain_entry.rs
    │   │   ├── delegation_credential.rs
    │   │   ├── delegation_evidence_trait.rs
    │   │   └── mod.rs
    │   ├── generic/
    │   │   ├── credential_trait.rs
    │   │   ├── verifiable_credential.rs
    │   │   ├── verifiable_presentation.rs
    │   │   └── mod.rs
    │   └── mod.rs
    ├── issuance/
    │   ├── delegation_issuer.rs
    │   ├── issuer_trait.rs
    │   └── mod.rs
    ├── status/
    │   ├── model/
    │   │   ├── bitstring_status_list_entry.rs
    │   │   ├── status_list_credential_artifact.rs
    │   │   ├── status_purpose.rs
    │   │   └── mod.rs
    │   ├── provider/
    │   │   ├── in_memory_status_list_provider.rs
    │   │   ├── jwt_status_list_provider.rs
    │   │   ├── status_list_credential_provider_trait.rs
    │   │   └── mod.rs
    │   ├── resolver/
    │   │   ├── bitstring_status_list_resolver.rs
    │   │   ├── evm_anchored_status_list_resolver.rs
    │   │   ├── in_memory_status_list_resolver.rs
    │   │   ├── status_list_resolver_trait.rs
    │   │   └── mod.rs
    │   └── mod.rs
    ├── trust/
    │   ├── evm/
    │   │   ├── evm_reader_traits.rs
    │   │   ├── evm_registry_reader.rs
    │   │   └── mod.rs
    │   ├── material/
    │   │   ├── composite_public_material_provider.rs
    │   │   ├── did_ethr_verification_key_provider.rs
    │   │   ├── in_memory_public_material_provider.rs
    │   │   ├── in_memory_verification_key_provider.rs
    │   │   ├── public_material_provider_traits.rs
    │   │   └── mod.rs
    │   ├── model/
    │   │   ├── identity_status.rs
    │   │   └── mod.rs
    │   ├── registry/
    │   │   ├── evm_backed_trust_registry.rs
    │   │   ├── in_memory_trust_registry.rs
    │   │   ├── trust_registry_trait.rs
    │   │   └── mod.rs
    │   └── mod.rs
    ├── verification/
    │   ├── delegation_verifier.rs
    │   ├── timing.rs
    │   ├── verifier_trait.rs
    │   └── mod.rs
    └── mod.rs
```

The former `ours/`, `entities/`, and global `traits/` organization has been removed from the active code. Traits now live beside the domain they define, while concrete implementations are grouped by responsibility.

## Temporary reference material

Code that is not part of the thesis baseline but may be useful later has been moved to:

```text
reference_temporary/
```

This includes the original benchmark machinery, alternative PJV / SD-JWT implementations, efficient variants and auxiliary code used by those variants. It is kept only as reference and is not part of the active Rust module tree.

Generated CSV benchmark outputs, plots and plotting notebooks from the original paper were removed from the working branch because they are not required for implementation. The untouched original state is preserved in the Git branch:

```text
original-backup-before-thesis-cleanup
```

## Current checkpoint

The pre-Gateway trust/blockchain phase is complete and has been validated after the architecture cleanup.

The current reproducible validation checks:

- `cargo fmt --check`;
- 58 Rust tests;
- 18 Solidity tests;
- fresh local Anvil deployment;
- DID resolution through `did:ethr`;
- authenticated Status List JWT verification;
- authorization before revocation;
- rejection of the same credential after the current Status List is updated.

For a fresh full local run:

```bash
bash blockchain/scripts/run-pre-gateway-local.sh
```

The script starts a fresh Anvil chain in a separate Git Bash/Mintty window on Windows, deploys the contracts, configures all local identities and addresses, runs the complete validation, and intentionally leaves Anvil running for further manual inspection.

The Cloud Access Gateway, OPA/Gitea integration, and agent communication protocols are intentionally frozen for now. The current work phase is study and review of the implemented delegation, status, trust, and blockchain architecture before new functionality is added.
