# Delegation — thesis working baseline

This repository is the working codebase for the master's thesis project based on the original Delegation Credential implementation.

## Current purpose

The active `src/` tree intentionally contains only the baseline implementation needed to understand and adapt the proposed Delegation Credential:

- generic credential / VC / VP structures;
- the "ours" Delegation Credential model;
- issuer and verifier logic;
- cryptographic accumulator management and verification;
- the in-memory DLT simulator used by the original implementation.

The repository has been simplified before starting the thesis-specific modifications so that the core execution path is easier to study.

## Active source tree

```text
src/
├── lib.rs
└── delegation/
    ├── credentials/
    │   ├── mod.rs
    │   ├── verifiable_credential.rs
    │   ├── verifiable_presentation.rs
    │   └── ours/
    │       ├── mod.rs
    │       ├── our_delegation.rs
    │       ├── our_delegator.rs
    │       └── our_delegation_credential.rs
    ├── entities/
    │   ├── mod.rs
    │   ├── dtl_sim.rs
    │   ├── issuer.rs
    │   ├── verifier.rs
    │   └── ours/
    │       ├── mod.rs
    │       ├── accumulator_manager.rs
    │       ├── accumulator_utils.rs
    │       ├── accumulator_verifier.rs
    │       ├── dlt_acc_entry.rs
    │       ├── our_issuer.rs
    │       └── our_verifier.rs
    └── traits/
        ├── mod.rs
        └── credential.rs
```

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

## Development direction

The active baseline will first be understood and validated, then adapted to the thesis scenario involving delegated authorization for AI agents. Later phases are expected to integrate the delegation core with a Cloud Access Gateway, OPA/Rego policy evaluation, A2A-based agent communication, Gitea as the protected Git platform, and a local blockchain trust/revocation layer.
