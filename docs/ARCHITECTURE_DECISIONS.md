# Architecture Decisions

**Historical ADR series.** These decisions record how the architecture
evolved during October–November 2026. Where a later decision changed the
design (for example the sequential Orchestrator, the HTTP Adapter or the
shared HTTP MCP), the current system is the one described in the
[root README](../README.md) and in [LOCAL_SETUP.md](LOCAL_SETUP.md):
Engineer-signed permission scope, native Rust for Engineer core, wallets and
Gateway verifier, dynamic ADK Planner and Orchestrator, A2A specialist agents
and private per-role wallets for Child DCs and VPs.

## ADR-001 — Keep the PoC integration in the delegation repository

**Status:** Accepted

The Rust authorization framework and the runtime integration share one Git history. Protected applications are separate repositories, imported into the local Gitea from the Engineer's GitHub account; none is part of this repository.

Integration code lives under `poc/`; the Rust bridge lives under `services/` (`delegation-adapter` library, `delegation-engineer-node` and `delegation-core-node` Node-API addons).

## ADR-002 — Build authorization boundaries before A2A and LLM behavior

**Status:** Accepted

The implementation was built bottom-up: authorization, policy and protected provider boundaries preceded A2A and model-backed reasoning. The final specialized roles use Google ADK/Gemini; the Orchestrator itself does not require a model.

## ADR-003 — TypeScript/Node.js for Gateway and Agents; Rust for delegated authorization

**Status:** Accepted

Gateway, A2A runtime and Agents are TypeScript/Node.js. The existing delegation framework remains Rust and is exposed through a narrow internal Delegation Adapter.

Cryptographic logic is not duplicated in TypeScript.

## ADR-004 — OPA is evaluated before any real provider mutation

**Status:** Accepted

A successful `DelegationVerifier` result is necessary but not sufficient.

Execution order:

`tool request -> Gateway derivation -> VP verification -> OPA -> provider/runner`

Historically, OPA was integrated against a mock Gateway executor before connecting Gitea. The current path authorizes real Gitea and controlled Docker Runner operations. OPA or verifier failure is fail-closed.

## ADR-005 — Adapter callers are bound to server-side identities

**Status:** Superseded by ADR-013 (no Adapter HTTP service; per-role wallets)

The Delegation Adapter must not allow a caller to choose an arbitrary holder or issuer identity through request data.

Each internal service is authenticated independently and mapped server-side to the identities and operations it may use.

Examples:

- Backend service -> Backend Agent DID for VP creation;
- Frontend service -> Frontend Agent DID for VP creation;
- Test service -> Test Agent DID for VP creation;
- Orchestrator service -> Orchestrator DID and child-issuance capability;
- Gateway service -> verification capability only.

## ADR-006 — OPA handles workflow context, not exact delegated file authority

**Status:** Accepted

The Delegation Credential and verifier enforce exact `ResourceUri + Operation` authority.

OPA enforces contextual rules such as no writes to `main`, feature-branch restriction, PR direction, no automated merge, controlled repository/provider and `RunTests` branch restriction.

The file-level permission matrix is not duplicated in Rego.

## ADR-007 — Controlled test execution includes researcher-owned acceptance tests

**Status:** Superseded — PASS means the project's own tests pass (ADR-014)

The Test Agent may modify project tests, but it cannot modify the independent acceptance suite used as experimental evidence.

The Controlled Test Runner executed both project tests and researcher-owned tests. The acceptance suite and its failure catalog have since been removed from the code.

No LLM-controlled arbitrary shell is exposed.

## ADR-008 — Task decomposition and authority decomposition are separate

**Status:** Superseded by ADR-012

The final Account Suspension Orchestrator deterministically runs Backend → Frontend → Test. Each specialized ADK/Gemini role reasons about its assigned task, but cannot invent child permissions or choose the workflow order.

The runtime maps each role to deterministic templates `DC_Backend`, `DC_Frontend` and `DC_Test`. Earlier plans for model-selected task decomposition are historical; they are not the final coordinator behavior.

## ADR-009 — Final merge remains human

**Status:** Accepted

The workflow may create a Draft Pull Request from the Engineer-signed work branch to the base branch.

`MergePullRequest` is not delegated and no merge tool is exposed.

## ADR-010 — Experimental instrumentation starts in the Gateway core

**Status:** Accepted

From Gateway Phase 3 onward, audit events should capture stable identifiers and measurements including:

- `prepare_ms`;
- `verification_ms`;
- `opa_ms`;
- `provider_ms`;
- `total_ms`;
- `vp_size_bytes`;
- delegation `chain_depth`;
- `disclosed_permission_count`;
- tested/resulting commit SHA when applicable;
- effective model ID for LLM-backed runs.

Sensitive credential or presentation payloads are not recorded in full.

## ADR-011 — Use the official A2A 1.0 JavaScript SDK and keep authority out of Artifacts

**Status:** Accepted

Introduced in Phase 7, the active A2A runtime uses the official `@a2a-js/sdk` package, pinned to `1.3.0`, with the
A2A Protocol v1.0 HTTP+JSON binding.

The delegated-authorization extension URI is frozen as:

`urn:thesis:a2a:delegated-authorization:v1`

The Agent Card advertises the extension as required. The Orchestrator activates
it using the A2A `A2A-Extensions` service parameter, the Message declares the
same URI in `Message.extensions`, and serialized Delegation Evidence is carried
in `Message.metadata.delegation_evidence`.

The remote Agent stores Delegation Evidence in internal task context. External
task responses request zero message history and Artifacts contain result data
only. A2A transports task context; it never replaces the
`Delegation Credential -> Gateway -> DelegationVerifier -> OPA` authority path.

## ADR-012 — Authority-only approval: the Engineer signs permissions, not Tasks

**Status:** Accepted (replaces the signed Task DAG)

The Orchestrator proposes only the maximum permission scope; the Engineer
signs a subset of it. The Orchestrator then creates, reorders and repairs
Tasks freely, each with its own Child DC inside the operational Root. The
signed-DAG path, its approved-plan registry and plan IPC were removed from the
code base.

## ADR-013 — Cryptography through private per-role wallets and an in-process verifier

**Status:** Accepted

Each agent signs its VPs with its own key through a private MCP session to its
native Rust wallet; the Orchestrator issues Child DCs the same way. The Gateway
verifies VPs with the native Rust verifier in its own process. No Adapter HTTP
service is deployed.

## ADR-014 — Evidence over claims

**Status:** Accepted

A Task is complete only on independent evidence: the Gitea effect at an exact
revision, and a Runner PASS of the project's tests on the exact commit
proposed for the Draft PR. Agents accept only signed Tasks (Gateway dispatch
ID, exact file grants, Runner flag). Merge remains human.

