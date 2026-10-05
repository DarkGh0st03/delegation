# Implementation State

Last updated: 2026-10-05

This file is the primary continuation checkpoint for the thesis PoC. A future implementation session should read it before proposing architectural changes.

## Current milestone

**Phase 8B — specialized Backend, Frontend and Test Agents: COMPLETE**

Completed checkpoints:

- **Phase 5A — protected Gitea read-only integration: COMPLETE**
- **Phase 5B.1 — mutation contracts + real `create_branch`: COMPLETE**
- **Phase 5B.2 — conditional `create_file` + `update_file`: COMPLETE**
- **Phase 5B.3 — real `create_pull_request` + provider closure: COMPLETE**
- **Phase 6A — Controlled Test Runner contract: COMPLETE**
- **Phase 6B — exact-SHA isolated execution + Gateway integration: COMPLETE**
- **Phase 6C — researcher-owned acceptance suite: COMPLETE**
- **Phase 7 — deterministic A2A 1.0 flow: COMPLETE**
- **Phase 8A — shared LLM Agent runtime and OpenAI Responses API client: COMPLETE**
- **Phase 8B — specialized Backend, Frontend and Test Agents: COMPLETE**

Next checkpoint: **Phase 8C — authority-boundary tests for model-driven tool attempts**

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

Phase 5B.1 deliberately did **not** enable `create_file`, `update_file` or `create_pull_request`; later mutations remained fail-closed until their own checkpoints.

### Phase 5B.2 — Conditional Gitea file mutations

Completed and validated.

Implemented:

- Gitea Contents API `create_file` through POST with UTF-8 content encoded to base64;
- existing-path create attempts fail closed as structured provider conflicts instead of overwriting;
- `update_file` resolves the current protected file snapshot and sends its exact blob SHA as the Gitea update precondition;
- stale SHA conflicts are mapped to HTTP 409 at the Gateway boundary;
- Gateway/provider-generated deterministic commit messages; callers cannot supply Git author/committer identity or arbitrary commit metadata;
- defense-in-depth write restriction to `feature/account-suspension`; `main` remains non-writable;
- structured create/update results include branch, path, resulting revision/commit SHA and blob SHA; updates also surface the blob SHA used as the precondition;
- successful Gitea execution audit now records resulting revision/commit/blob identifiers without logging source content;
- unit tests cover create payloads, duplicate-create conflicts, conditional update payloads, stale preconditions, branch restrictions and audit metadata;
- real smoke uses root + child Delegation Credentials for Orchestrator, Backend Agent and Test Agent, then exercises `create_branch`, protected read, real `update_file`, post-write read and restricted `create_file`;
- duplicate `create_file` is rejected and a stale Gitea SHA write is rejected;
- the smoke verifies that `main` remains exactly at the hardened baseline revision.

Validated code checkpoint:

`63edba4a06391348384d0b9de2088b7a7edb6de5`

GitHub Actions validation run:

`37303157783` — success (`validate`, Phase 1 smoke, Phase 4 smoke, Phase 5A regression smoke, Phase 5B.1 regression smoke and the new `phase5b2-smoke` all green).

Phase 5B.2 deliberately left `create_pull_request` disabled until Phase 5B.3. `MergePullRequest` remained absent from the automated workflow.

### Phase 5B.3 — Protected Gitea Pull Request creation

Completed and validated.

Implemented:

- Gitea Pull Request creation through the repository API;
- exact head revision resolution before PR creation and fail-closed validation that the returned PR still points to that revision;
- mutable provider dispatch for `create_pull_request` only in the frozen direction `feature/account-suspension -> main`;
- structured PR result with provider, PR id/number, optional URL, head/base and head revision;
- duplicate/conflicting PR creation mapped to a structured provider conflict;
- audit metadata includes PR identifiers and provider revision without logging source content, credentials or the signed VP;
- `run_tests` remains unavailable in the Gitea executor and is reserved for the Controlled Test Runner;
- no `MergePullRequest` tool or provider operation was added;
- real smoke path creates the feature branch, performs an authorized backend file mutation, proves a reverse-direction PR is denied by OPA before Gitea, creates the allowed PR after DelegationVerifier + OPA, rejects a duplicate PR, and confirms `main` remains at the hardened baseline revision.

Validated code checkpoint:

`807caac8a99101e508fec0bf4eaffdb58129f2c4`

GitHub Actions validation run:

`37304548966` — success (`validate`, Phase 1 smoke, Phase 4 smoke, Phase 5A regression smoke, Phase 5B.1 regression smoke, Phase 5B.2 regression smoke and the new `phase5b3-smoke` all green).

At this checkpoint the mutable Gitea provider supports exactly the PoC Git operations needed before the Runner: `read_file`, `create_branch`, `create_file`, `update_file` and `create_pull_request`. Automated merge is intentionally unavailable.

### Phase 6A — Controlled Test Runner contract

Completed and validated.

Implemented:

- dedicated `test-runner-controller` service boundary;
- structured run request containing only request id, controlled repository URI, frozen feature branch, exact 40-character commit SHA and fixed `poc-default` profile;
- internal Gateway bearer authentication;
- strict rejection of unexpected caller-controlled execution fields such as `command`, `shell` or `script`;
- contract and HTTP tests for exact-SHA validation, fixed repository/branch/profile and unauthorized requests.

Validated checkpoint:

`34fdd7fa3e66eea2c3e91abcec56193cff22c7f5`

GitHub Actions validation run:

`37306807144` — success.

### Phase 6B — Exact-SHA isolated execution and Gateway integration

Completed and validated.

Implemented:

- read-only Runner credential for the protected Gitea repository;
- exact branch-head precondition before execution and fail-closed rejection when the requested SHA is stale;
- exact repository archive download by commit SHA;
- execution inside an ephemeral constrained Docker container, with the snapshot copied into the container instead of bind-mounting a writable host workspace;
- fixed pipeline: dependency install, typecheck, backend tests, frontend tests, build and Playwright E2E;
- deterministic startup of backend and frontend services before the Playwright phase, with explicit readiness checks;
- `researcher_acceptance` remains intentionally skipped until Phase 6C;
- structured phase results and private log references;
- container destruction after every run;
- Gateway `run_tests` integration after `DelegationVerifier -> OPA`, with Runner-specific audit metadata;
- negative smoke proving an invalid presentation is rejected before Runner invocation;
- exact-SHA isolated smoke and full Gateway-Verifier-OPA-Runner smoke.

Validated code checkpoint:

`f480106e02e4249264f68da8b60f1edcd60923c6`

GitHub Actions validation run:

`37313384537` — success. Both `phase6b-isolated-smoke` and `phase6b-gateway-smoke` are green, together with all Phase 5 regression smoke jobs.

Phase 6B does **not** include the researcher-owned acceptance suite. That is the next isolated checkpoint.

### Phase 6C — Researcher-owned acceptance suite

Completed and validated.

Implemented:

- researcher-owned acceptance tests under `poc/runner/acceptance/`, outside the protected `iam-console-poc` repository and outside specialized Agent write authority;
- acceptance coverage split into explicit criteria for `ACTIVE -> SUSPENDED`, `SUSPENDED -> ACTIVE`, duplicate-transition rejection with HTTP 409, and frontend state/action behavior;
- acceptance files are mounted into the ephemeral Runner container as a read-only bind mount, independently from the exact application snapshot fetched from Gitea;
- the fixed project pipeline remains unchanged and Phase 6B regression jobs explicitly run with researcher acceptance disabled;
- normal Runner operation enables researcher acceptance by default;
- Runner output now separates `project_tests` from `researcher_acceptance`, while the overall result includes both verdicts;
- the Gateway parses and propagates both verdicts and records separate audit status fields;
- CI verifies the researcher-owned source remains unchanged and that the execution container is destroyed after the run.

The hardened baseline intentionally does not contain the Account Suspension feature. Therefore the Phase 6C smoke expects the baseline project tests to pass while the independent researcher acceptance verdict fails. The CI job itself succeeds only when this separation is observed. Later, the Agent-produced feature branch must make both verdicts pass.

Validated code checkpoint:

`2956a9c5c36eff0203d8efa3c178dc25e69a3cd7`

GitHub Actions validation run:

`37317272950` — success. `validate`, `phase6c-acceptance-smoke`, both Phase 6B regression smoke jobs, all Phase 5 regression smoke jobs, Phase 4 smoke and Phase 1 smoke are green.

### Phase 7 — Deterministic A2A 1.0 interoperability

Implementation complete; final validation is running on the current HEAD.

Implemented:

- official `@a2a-js/sdk` pinned to `1.3.0`, targeting A2A Protocol v1.0;
- HTTP+JSON Agent Cards for Backend, Frontend and Test Agents with `application/json` media modes;
- frozen delegated-authorization extension URI `urn:thesis:a2a:delegated-authorization:v1`;
- extension activation through the official `A2A-Extensions` service-parameter helper;
- `Message.extensions` plus `Message.metadata.delegation_evidence` transport for child Delegation Evidence;
- internal per-task context retention of Delegation Evidence;
- deterministic task lifecycle and result-only Artifact Builder;
- external task responses request `historyLength: 0` so authority-bearing Messages are not echoed back;
- deterministic Orchestrator discovery and `sendMessage` over HTTP+JSON;
- configurable Backend/Frontend/Test A2A service launcher;
- incompatible-Agent-Card rejection before protected task execution;
- a three-Agent smoke covering discovery -> Message -> Task -> Artifact for every specialized role.

The A2A layer does not grant repository authority. The existing `Delegation Credential -> Gateway -> DelegationVerifier -> OPA -> provider` boundary remains authoritative.

Validated checkpoint:

`5df2417b529c376e72396c7066682482a74c26e6`

GitHub Actions validation run:

`37322686937` — success. `validate`, `phase7-a2a-smoke`, and all regression smoke jobs completed successfully.

### Phase 8A — Shared LLM Agent runtime

Completed and validated.

Implemented:

- OpenAI Responses API client with configurable `OPENAI_MODEL` and effective `model_id` capture;
- bounded Agent Controller reasoning/tool loop;
- controlled Tool Registry;
- Delegation Evidence Handler that owns credential/presentation material outside model-visible context;
- Gateway wrapper hiding `prepare -> signed VP -> execute`;
- controlled outcomes for authorization denial, test failure, invalid calls and iteration limits;
- model-visible secrecy checks for credential, VP and service-token material;
- protected smoke proving an allowed backend read/update reaches Gitea while an out-of-scope security write is denied by the authorization infrastructure.

Validated checkpoint:

`392234c042668906d056236f4d1b937e47c6a79a`

GitHub Actions validation run:

`37327753671` — success, including `phase8a-agent-runtime-smoke` and all regression jobs.

### Phase 8B — Specialized Backend, Frontend and Test Agents

Completed and validated.

Implemented:

- frozen role profiles for Backend, Frontend and Test Agents;
- role-specific system prompts containing the exact writable/read-only target files from the permission matrix;
- Backend Tool Registry: `read_file`, `update_file`;
- Frontend Tool Registry: `read_file`, `update_file`;
- Test Tool Registry: `read_file`, `update_file`, `create_file`, `run_tests`;
- explicit prompt language that scope text is guidance rather than the authorization boundary;
- shared specialized-controller factory over the Phase 8A runtime;
- unit coverage for role prompts, skills and tool exposure;
- real Adapter/Gateway/Gitea sandbox smoke for all three roles;
- Backend allowed to modify a delegated backend file and denied a Frontend mutation;
- Frontend allowed to modify a delegated frontend file and denied a Backend mutation;
- Test allowed to create the delegated E2E test and denied application-source mutation;
- child Delegation Credentials are issued through the Orchestrator identity in the smoke, preserving the PoC root-authority rule.

Validated code checkpoint:

`b76645ce9d0b2a00e024297e858c868d37a41725`

GitHub Actions validation run:

`37331735246` — success, including `phase8b-specialized-agents-smoke`, `phase8a-agent-runtime-smoke`, `phase7-a2a-smoke` and all regression jobs.

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

## Next action — Phase 8C

Harden and automate the model-driven authority-boundary matrix before Phase 9:

- exercise Backend attempts against Frontend and `security/` resources;
- exercise Frontend attempts against Backend resources;
- exercise Test `update_file` attempts against application source;
- include an operation mismatch case where a resource is readable but not writable;
- prove denied operations do not mutate Gitea and do not start the Controlled Test Runner;
- keep prompt text unchanged during these tests so denial is attributable to Delegation Credential / Gateway / verifier / OPA enforcement;
- record the effective model id for every boundary run.

Do not start Phase 9 authority templates until Phase 8C is green.
