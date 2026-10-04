# Architecture Decisions

These decisions are frozen unless an implementation blocker requires a documented change.

## ADR-001 — Keep the PoC integration in the delegation repository

**Status:** Accepted

The Rust authorization framework and the runtime integration share one Git history. The protected application remains the separate repository `iam-console-poc`.

Integration code lives under `poc/`; the Rust bridge lives under `services/delegation-adapter/`.

## ADR-002 — Build authorization boundaries before A2A and LLM behavior

**Status:** Accepted

Implementation proceeds bottom-up. Authorization, policy and protected provider boundaries are implemented before A2A and GPT-backed reasoning.

## ADR-003 — TypeScript/Node.js for Gateway and Agents; Rust for delegated authorization

**Status:** Accepted

Gateway, A2A runtime and Agents are TypeScript/Node.js. The existing delegation framework remains Rust and is exposed through a narrow internal Delegation Adapter.

Cryptographic logic is not duplicated in TypeScript.

## ADR-004 — OPA is evaluated before any real provider mutation

**Status:** Accepted

A successful `DelegationVerifier` result is necessary but not sufficient.

Execution order:

`tool request -> Gateway derivation -> VP verification -> OPA -> provider/runner`

OPA is integrated while the Gateway still uses a mock executor. Gitea is connected only afterwards. OPA or verifier failure is fail-closed.

## ADR-005 — Adapter callers are bound to server-side identities

**Status:** Accepted

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

**Status:** Accepted

The Test Agent may modify project tests, but it cannot modify the independent acceptance suite used as experimental evidence.

The Controlled Test Runner executes both project tests and researcher-owned tests under `poc/runner/acceptance/`.

No LLM-controlled arbitrary shell is exposed.

## ADR-008 — Task decomposition and authority decomposition are separate

**Status:** Accepted

The Orchestrator LLM may reason about which specialized role should execute a subtask. It does not invent child permissions.

The runtime maps a selected role to deterministic templates `DC_Backend`, `DC_Frontend` and `DC_Test`.

## ADR-009 — Final merge remains human

**Status:** Accepted

The workflow may create a Pull Request from `feature/account-suspension` to `main`.

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
