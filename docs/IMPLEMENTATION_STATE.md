# Implementation State

Last updated: 2026-10-05

This file is the primary continuation checkpoint for the thesis PoC. A future implementation session should read it before proposing architectural changes.

## Current milestone

**Phase 5B — Protected Gitea mutations after Verifier + OPA: IN PROGRESS**

Completed checkpoint: **Phase 5B.1 — mutation contracts + real `create_branch`: COMPLETE**

Next checkpoint: **Phase 5B.2 — conditional `create_file` + `update_file`**

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

### Phase 3A — Canonical permission preparation

Completed.

Checkpoint:

`97e80e0cecb38d0c2bc2ad82c9faef6d2e8da4a6`

Implemented:

- TypeScript Gateway workspace under `poc/apps/gateway/`;
- strict tool-request validation;
- deterministic `tool -> Operation` mapping;
- canonical Gitea repository, branch and file `ResourceUri` derivation;
- repository-relative path validation and traversal rejection;
- Git branch-name validation;
- explicit rejection of caller-supplied `resource_uri`, `operation` or `permission`;
- server-generated `request_id`, audience and cryptographic challenge;
- server-side prepared-request record binding task, role, tool arguments and required permission;
- request fingerprint and TTL;
- initial audit event and `prepare_ms` measurement;
- no provider mutation.

### Phase 3B — One-shot verification and mock execution

Completed.

Primary checkpoints:

- `ff9d14fd188e716d51b645e4c6579f08bf863f27` — one-shot verification execution core;
- `7d229f6ff27bdecfa38a4470c97c7f638d01a556` — HTTP prepare/execute flow and real Adapter-Gateway smoke test;
- `9723b82cc1aeec326012950d50061859df18032f` — final timing fix and validated Phase 3 checkpoint.

Implemented:

- `POST /v1/authorization/prepare`;
- `POST /v1/authorization/execute`;
- Gateway-authenticated call to Adapter `POST /v1/verify`;
- execute request accepts only `request_id + signed_vp`;
- audience, challenge, presenter role and required permission are loaded from server-side prepared state;
- prepared request is consumed before asynchronous verification, enforcing fail-closed one-shot semantics;
- expired request, replay, invalid proof and verifier outage prevent execution;
- successful authorization reaches only `MockExecutor`, never Gitea;
- structured audit metrics include `verification_ms`, `provider_ms`, `total_ms`, `vp_size_bytes`, `chain_depth` and `disclosed_permission_count`;
- real CI smoke path: Gateway prepare -> root DC -> child DC -> Agent signed VP -> Adapter verifier -> Gateway allow -> mock execution -> replay rejection.

Validation run for the final Phase 3 checkpoint:

`37278075507` — success.

OPA is still deliberately absent from the allow path. Phase 4 inserts OPA after successful delegation verification and before the mock executor, so Phase 5 can connect Gitea only after both authorization layers are active.

### Phase 4A — OPA contextual workflow policy

Completed.

Implemented under `poc/opa/`:

- Rego v1 default-deny policy;
- explicit policy input contract based on Gateway-owned prepared request state plus `VerifiedDelegation`;
- controlled repository enforcement for `gitea.local/thesis/iam-console-poc`;
- file operations restricted to `feature/account-suspension`;
- feature branch creation restricted to `main -> feature/account-suspension`;
- Pull Request creation restricted to `feature/account-suspension -> main`;
- `RunTests` restricted to the feature branch and fixed `poc-default` profile;
- `MergePullRequest` and unknown tools denied by default;
- missing verified-delegation context denied;
- tool/operation mismatch denied;
- policy version exposed through `data.thesis.gateway.decision`.

This policy deliberately does not duplicate the exact file-level Delegation Credential permission matrix.

### Phase 4B — Gateway OPA enforcement

Completed.

Implemented:

- OPA Data API client for `data.thesis.gateway.decision`;
- policy input built only from server-side prepared state, repository configuration and `VerifiedDelegation`;
- source-file content and Pull Request text excluded from OPA input because they are not needed for contextual authorization;
- Gateway runtime order is now `DelegationVerifier -> OPA -> MockExecutor`;
- OPA deny prevents executor invocation;
- OPA network errors, timeouts, malformed JSON, malformed decisions and non-2xx responses fail closed;
- one-shot challenge consumption still occurs before verifier/OPA execution;
- audit events now include `opa_ms`, `policy_decision` and `policy_version`;
- successful execute responses include the policy decision used;
- the local OPA container loads `poc/opa/` at startup;
- Phase 1 validation checks that policy version `phase4a-v1` is loaded;
- real CI smoke path is now Agent signed VP -> DelegationVerifier -> OPA -> MockExecutor, followed by replay rejection.

Checkpoints:

- 4B.1 OPA client + server-derived policy input: `9b4fac555b87b487c9392eb61ed597d9f6ac6a64`;
- 4B.2 OPA enforcement in the Gateway runtime: `3c6140beb8b3d8ad59098d34783b6982c4840b4f`;
- final strip-types compatibility fix: `8d920c2b729aa18a5d37de7011cacc195eb202fd`.

Validation run:

`37283853183` — success (Gateway 4B tests, OPA policy tests, Phase 1 smoke and real Adapter -> Gateway -> OPA -> MockExecutor smoke).

Gitea is still disconnected from Gateway execution. The executor remains a no-op mock until Phase 5.

### Phase 5A — Protected Gitea provider read-only integration

Completed.

Implemented:

- Gateway-owned Gitea HTTP client using the private service token generated by `bootstrap-gitea.sh`;
- repository identity validation and default-branch/object-format metadata retrieval;
- branch metadata lookup with immutable commit SHA;
- `read_file` against the exact resolved commit SHA rather than a moving branch name;
- returned read result includes branch revision, Git blob SHA, last commit SHA, size, UTF-8 encoding and source content;
- binary/non-UTF-8 files and files above the Gateway read limit are rejected;
- provider network/HTTP/response failures are mapped to structured Gateway errors;
- execution/audit records distinguish authorization decision from provider result;
- `provider_ms`, provider name and provider result are recorded without logging source contents or provider credentials;
- configurable `mock` and `gitea-readonly` provider modes;
- the Gitea service credential remains only in Gateway runtime configuration and is never exposed to Agents, OPA, or signed presentations;
- in `gitea-readonly` mode every mutation tool is rejected with `provider_operation_unavailable` before a Gitea mutation can occur.

Phase 5A was intentionally split into two implementation checkpoints:

- read-only client + immutable metadata: `6f4239e8c0dc1162bd70a37509928a56be439f38`;
- Gateway read-only provider wiring after Verifier + OPA: `c0e1fd89facec0ace58e9afe182785c1ec00e128`.

Additional validation/fix checkpoints:

- real feature-branch fixture: `0d57fd1e9a5a07fe2a591d963564e307d75e8654`;
- real Verifier -> OPA -> Gitea smoke: `5d74bd878d07303bc38bec05cfa56d831b9e761f`;
- CI Phase 5A job: `368209c09dd54757fb070b891fb7ebc7f8303d11`;
- explicit mock-mode regression fix: `de2af45d9504f8498eed0448304198e943e5270a`;
- structured provider-failure test: `3c9d89f56c0944b7a6a8f8f1ec366be9e3565fd4`.

Validation run:

`37286516299` — success.

The real smoke verified:

- imported protected feature branch revision `ea9984fa15098771fc451f9ae51c82824b6a40fd`;
- real Gitea `read_file` through Gateway after DelegationVerifier and OPA;
- returned immutable blob metadata;
- a fully authorized + OPA-allowed `update_file` is still blocked by the Phase 5A read-only provider;
- a second authorized read confirms that the protected file and branch revision did not change.

### Phase 5B.1 — Real Gitea branch mutation

Completed and validated.

Implemented:

- mutable `gitea` Gateway provider mode while preserving `mock` and `gitea-readonly`;
- Gitea client branch creation through the repository API;
- base-branch revision resolution before mutation and fail-closed validation that the created branch points to that exact revision;
- dedicated `GiteaExecutor` for the mutable provider path;
- Phase 5B.1 provider dispatch limited to `read_file` and `create_branch`; later mutations remain unavailable;
- defense-in-depth provider restriction to exactly `main -> feature/account-suspension`;
- structured `create_branch` result with branch, base branch, revision and commit SHA;
- structured provider-conflict mapping to HTTP 409;
- unit tests for branch request payloads, response/revision validation, provider dispatch and conflict handling;
- real smoke path: Orchestrator signed VP -> DelegationVerifier -> OPA -> Gitea `create_branch`;
- negative real smoke proving an out-of-policy branch request is denied before Gitea and the denied branch is not created;
- post-create protected read proving the new feature branch starts at the exact hardened baseline revision.

Validated code checkpoint:

`ad89695ede73b0fe4ec1c8692e56dc64ff6e44ba`

GitHub Actions validation run:

`37299268013` — success (`validate`, Phase 1 smoke, Phase 4 smoke, Phase 5A regression smoke and the new `phase5b1-smoke` all green).

Phase 5B.1 deliberately does **not** enable `create_file`, `update_file` or `create_pull_request`. Those remain fail-closed until their own checkpoints.

## Validation commands

```bash
cargo test
cargo fmt --check
npm --prefix poc run check:scaffold
npm --prefix poc run gateway:test
bash poc/scripts/phase4a-policy-test.sh
```

Full pre-Gateway trust closure, when a local Anvil-capable environment is available:

```bash
bash blockchain/scripts/run-pre-gateway-local.sh
```

## Frozen implementation order

`0A baseline -> 0B workspace -> 1 infra -> 2 Adapter -> 3 Gateway core -> 4 OPA -> 5 Gitea -> 6 Runner + acceptance -> 7 A2A deterministic -> 8 LLM Agents -> 9 Orchestrator + child DC -> 10 positive E2E -> 11 security/negative -> 12 reproducibility + measurements`

## Next action — Phase 5B.2

Add conditional file mutations behind the already validated `DelegationVerifier -> OPA -> GiteaExecutor` chain:

- implement `create_file` through the Gitea Contents API and reject existing paths instead of overwriting;
- implement `update_file` using the current file/blob SHA as a precondition so stale state fails instead of blind-overwriting newer content;
- generate commit metadata inside the Gateway/provider rather than accepting arbitrary Git identity or commit metadata from the caller;
- keep every write on `feature/account-suspension`; `main` remains non-writable;
- return structured commit/blob/revision metadata and add provider result identifiers to audit without logging source content;
- test the restricted `CreateFile` path for `tests/e2e/account-suspension.spec.ts`;
- add a real Phase 5B.2 smoke showing an authorized file mutation, a post-write read at the new revision, unchanged `main`, and a stale-precondition rejection.

Do not enable `create_pull_request` until Phase 5B.3, and do not implement `MergePullRequest`.
