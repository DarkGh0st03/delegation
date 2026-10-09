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
- explicit local in-memory stores for deterministic tests/local profiles, separated from production-facing trust/status abstractions;
- a live Anvil-backed trust layer using did:ethr/ERC-1056, EnterpriseTrustRegistry and IssuerRegistry;
- split verifier-side trust resolution and issuer-side trust publication contracts;
- blockchain-anchored accumulator-material versioning and Bitstring Status List revocation/suspension lifecycle;
- fresh DID-resolved Ed25519 verification keys and authenticated Status List JWTs;
- exact parent/child permission matching for delegation attenuation; hierarchical resource-scope attenuation is intentionally not part of the current protocol.

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
    │   ├── authorization_context.rs
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
    ├── local/
    │   ├── in_memory_public_material_store.rs
    │   ├── in_memory_status_list_store.rs
    │   ├── in_memory_trust_store.rs
    │   └── mod.rs
    ├── status/
    │   ├── evm/
    │   │   ├── status_list_anchor_reader.rs
    │   │   └── mod.rs
    │   ├── model/
    │   │   ├── bitstring_status_list_entry.rs
    │   │   ├── status_list_credential_artifact.rs
    │   │   ├── status_purpose.rs
    │   │   └── mod.rs
    │   ├── mutation/
    │   │   ├── bitstring_status_list_mutator.rs
    │   │   └── mod.rs
    │   ├── parser/
    │   │   ├── bitstring_status_list_parser.rs
    │   │   └── mod.rs
    │   ├── provider/
    │   │   ├── jwt_status_list_provider.rs
    │   │   ├── status_list_credential_provider_trait.rs
    │   │   └── mod.rs
    │   ├── resolver/
    │   │   ├── evm_anchored_status_list_resolver.rs
    │   │   ├── provider_status_list_resolver.rs
    │   │   ├── status_list_resolver_trait.rs
    │   │   └── mod.rs
    │   └── mod.rs
    ├── trust/
    │   ├── evm/
    │   │   ├── evm_registry_reader.rs
    │   │   ├── trust_chain_reader.rs
    │   │   └── mod.rs
    │   ├── material/
    │   │   ├── accumulator_material_provider.rs
    │   │   ├── did_ethr_verification_key_provider.rs
    │   │   ├── verification_key_provider.rs
    │   │   └── mod.rs
    │   ├── model/
    │   │   ├── identity_status.rs
    │   │   └── mod.rs
    │   ├── registry/
    │   │   ├── trust_publisher_trait.rs
    │   │   └── mod.rs
    │   ├── resolver/
    │   │   ├── evm_trust_resolver.rs
    │   │   ├── trust_resolver_trait.rs
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

## Thesis PoC integration workspace

The implementation phase now adds a separate integration workspace without changing the existing Rust core boundary:

```text
services/
└── delegation-adapter/   # Rust bridge implemented in Phase 2

poc/
├── apps/                 # Gateway and Agent services
├── packages/             # shared TypeScript runtime/contracts
├── opa/                  # contextual workflow policy
├── runner/               # controlled execution + researcher acceptance
├── infra/                # local Gitea/OPA/Anvil topology
└── scripts/

docs/
├── IMPLEMENTATION_STATE.md
└── ARCHITECTURE_DECISIONS.md
```

The PoC is implemented bottom-up: authorization boundary first, protected provider second, then A2A, and only afterwards LLM-backed Agents.

Read `docs/IMPLEMENTATION_STATE.md` before continuing the implementation.

For the scaffold sanity check:

```bash
npm --prefix poc run check:scaffold
```


### Final hardening

The final audit added authenticated JWT Status Lists to the EVM Adapter path, direct Solidity regression testing, a committed PoC npm lockfile with `npm ci`, and Gitea `main` branch protection. The hardening was validated on an isolated branch and then promoted to `main`.

## Current checkpoint

There are now two distinct checkpoints and they must not be conflated:

1. **Historical measured baseline** — executable-code checkpoint `cbadb5440db408d4047d4eb870a9fb231362414a`. The published Phase 12 regression, security, reproducibility and five-replica measurement evidence belongs to this checkpoint.
2. **Current refactored candidate** — branch `refactor/core-cleanup`. This branch contains the post-measurement architecture cleanup and Status List lifecycle work. It must complete a fresh final regression before merge to `main`, and the historical latency/security measurements must not be attributed to it unless a new campaign is executed.

The original thesis PoC implementation roadmap remains complete through **Phase 12 — reproducibility + measurements** for the historical measured baseline.

Validated end state includes:

- EVM-backed delegated-authorization verification;
- Gateway + OPA + protected Gitea execution;
- deterministic Backend -> Frontend -> Test delegation;
- real exact-SHA Controlled Runner;
- researcher-owned acceptance gating;
- positive Account Suspension E2E;
- Phase 11 security/negative experiments;
- structured measurement evidence and a machine-checked reproducibility contract.

Final pinned full-regression run: `37448047612` — success.

Dedicated reproducibility run: `37448047526` — success.

Final security run: `37448047677` — success.

Final five-replica measurement campaign: `37448047642` — success (5/5 replicas, 140 authorization samples).

Frozen executable-code checkpoint: `cbadb5440db408d4047d4eb870a9fb231362414a`.

See:

- `docs/IMPLEMENTATION_STATE.md` for the complete checkpoint history;
- `docs/REPRODUCIBILITY.md` for the frozen runtime and measurement protocol;
- `poc/experiments/reproducibility-manifest.json` for the machine-readable environment contract.

The historical reference measurement campaign is frozen and remains valid evidence for `cbadb544...`. The refactored candidate is a later code evolution and is being revalidated separately before promotion to `main`.
