# Implementation State

Last updated: 2026-10-04

This file is the primary continuation checkpoint for the thesis PoC. A future implementation session should read it before proposing architectural changes.

## Current milestone

**Phase 2 — Rust Delegation Adapter: COMPLETE**

Next milestone: **Phase 3A — Gateway canonical permission mapping and request preparation**

## Source-of-truth repositories

### Delegated Authorization framework

Repository: `DarkGh0st03/delegation`

Pre-integration baseline SHA:

`e8d91b4d33f972eac666f4435d541633f9a04752`

### Protected reference application

Repository: `DarkGh0st03/iam-console-poc`

Current hardened baseline SHA:

`ea9984fa15098771fc451f9ae51c82824b6a40fd`

`main` and `baseline-before-account-suspension` point to the same hardened baseline. The Account Suspension feature is intentionally absent.

## Completed milestones

### Phase 0A — Harden `iam-console-poc`

Completed.

- Node.js pinned to `22.15.0`;
- npm pinned to `10.9.2`;
- committed `package-lock.json`;
- CI uses `npm ci`;
- typecheck, test and build are green;
- Account Suspension remains absent.

Final Phase 0A checkpoint:

`ea9984fa15098771fc451f9ae51c82824b6a40fd`

### Phase 0B — Scaffold integration workspace

Completed and validated.

Validated code checkpoint:

`ce60f7506a5c8cb075f1d84f19943daabc1cc1d6`

GitHub Actions validation run: `37208656247` — success (`cargo fmt --check`, `cargo test`, scaffold sanity check).

Added:

- `poc/` TypeScript/Node integration workspace skeleton;
- `services/delegation-adapter/` placeholder;
- configuration example file;
- continuity and architecture documentation;
- placeholder directories for apps, packages, OPA, acceptance tests and infrastructure;
- scaffold consistency check.

No Gateway, Agent, Adapter, OPA, Gitea or Runner business logic has been implemented yet.

### Phase 1 — Local infrastructure

Completed.

Implemented and validated:

- pinned local Docker topology for Gitea, OPA and Anvil;
- Gitea namespace `thesis/iam-console-poc`;
- import and exact SHA validation of hardened `iam-console-poc` baseline;
- separate local admin user and Gateway service user;
- Gateway-only repository write credential persisted only in a gitignored runtime file;
- explicit Agent network declared as internal, with Gitea excluded from that network;
- reuse of the existing trust deployment script against containerized Anvil;
- runtime export of deployed DID, Enterprise Trust and Issuer registry addresses;
- health checks for Gitea, OPA and Anvil;
- CI smoke test that boots the Phase 1 stack, imports the baseline, deploys trust contracts, validates boundaries and tears the stack down.

Phase 1 deliberately does **not** implement authorization logic, Rego workflow policy, protected Gitea tool calls, A2A or LLM behavior.

### Phase 2A — Identity-bound Delegation Adapter skeleton

Completed.

Implemented:

- Rust service under `services/delegation-adapter/`;
- `GET /health` and authenticated `GET /v1/whoami`;
- distinct internal caller credentials for Engineer, Orchestrator, Backend, Frontend, Test and Gateway;
- deterministic caller -> role -> identity mapping;
- capability separation:
  - Engineer -> root issuance;
  - Orchestrator -> child issuance + own presentation;
  - specialized Agents -> own presentation;
  - Gateway -> verification only;
- request bodies cannot freely select the signing/issuer identity.

Initial implementation checkpoints:

- `05feb4dff0e18932e4909d236c9e5eaeb22d9706`
- `e7c946b3f5271b75ce2a7c09ae33d81959b4707a`

### Phase 2B — Issuance, signed presentation and verification bridge

Completed.

Implemented HTTP endpoints:

- `POST /v1/credentials/root`;
- `POST /v1/credentials/child`;
- `POST /v1/presentations`;
- `POST /v1/verify`.

The Adapter reuses the existing Rust framework for:

- Delegation Credential construction;
- accumulator value and witness construction;
- child non-escalation and temporal capping;
- selective disclosure;
- Ed25519-signed Verifiable Presentation creation;
- `AuthorizationContext` binding;
- `DelegationVerifier` execution and `VerifiedDelegation` output.

Negative tests cover permission escalation, unauthorized child issuance and cross-identity presentation attempts.

Main Phase 2B implementation checkpoint:

`00a15fff163e32fd697fdaf36076614bdfd8f2f1`

Fixes and final validated implementation reached:

`46ef752174e757feb66b93cbbf4a1ac95d96908c`

Validation run:

`37273004394` — success (Rust regression tests, Adapter formatting/tests, scaffold check and Phase 1 infrastructure smoke test).

A later concurrent edit briefly replaced some Adapter entry files; commit `339cfc4ac5163d312b742ee640a41786fa7faef5` restores and preserves the validated Phase 2 implementation. Validation run `37274322694` is also successful.

#### Trust backend note

At this component-test checkpoint, the Adapter uses the framework's in-memory trust/status providers while exercising the real `DelegationIssuer` and `DelegationVerifier` paths. The EVM trust layer from Phase 1 remains independently validated. Before the final positive end-to-end experiment, the deployed Adapter profile must bind verification/public-material resolution to the existing EVM-backed trust/status providers. This is an integration task, not a rewrite of the cryptographic core.

## Validation commands

```bash
cargo test
cargo fmt --check
npm --prefix poc run check:scaffold
```

Full pre-Gateway trust closure, when a local Anvil-capable environment is available:

```bash
bash blockchain/scripts/run-pre-gateway-local.sh
```

## Frozen implementation order

`0A baseline -> 0B workspace -> 1 infra -> 2 Adapter -> 3 Gateway core -> 4 OPA -> 5 Gitea -> 6 Runner + acceptance -> 7 A2A deterministic -> 8 LLM Agents -> 9 Orchestrator + child DC -> 10 positive E2E -> 11 security/negative -> 12 reproducibility + measurements`

## Next action — Phase 3A

Implement the TypeScript Cloud Access Gateway core:

- strict tool request schemas;
- canonical Gitea `ResourceUri` construction;
- deterministic `tool -> Operation` mapping;
- rejection of path traversal, malformed branch names and caller-supplied authority values;
- `prepare` request creation with `request_id`, required permission, audience and challenge;
- no real Gitea mutation yet;
- begin structured audit/measurement fields from this phase onward.

The Gateway must derive authority requirements itself; Agents must never supply an arbitrary `ResourceUri` or `Operation`.
