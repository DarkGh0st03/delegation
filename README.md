# Delegation — thesis PoC (current refactoring)

**Active work branch:** `refactor/post-prof-plan-contracts-20261021`  
**Source baseline:** `main` at `62c5c2f4c81c92218a262204a3f1a5acb00f8867` (unchanged during refactoring).

The current research architecture is **not** the old Account Suspension
sequential coordinator. Its canonical path is:

1. A read-only Rust-issued preliminary delegation permits ADK Planning
   over a pinned Gitea revision through the Gateway.
2. A signed checkpoint binds plan, digest and source revision. An
   authenticated Software Engineer independently Ed25519-signs an
   approved permission subset (GitHub OIDC authenticates a CI job,
   **not** Engineer approval).
3. The trusted Coordinator revokes the preliminary root and creates
   a distinct operational root with only the approved permissions.
4. `TrustedApprovedA2ADispatcher` schedules the approved Task DAG
   through specialized ADK/A2A Backend, Frontend and Test agents.
5. The shared MCP/private cryptographic MCP path, Gateway, native
   Rust DC/VP verifier, signed-plan Task checks and OPA protect the
   actual Gitea/Docker effects. Exact-SHA tests and independently
   checked provider receipts gate PR creation, never automatic merge.
6. Gateway closure and Rust root revocation close the trusted session.

**Current validation:** offline cumulative CI uses scripted LLM
decisions, real Rust/EVM/OPA and disposable Gitea/Docker Runner. It
exercises Account Suspension and Department Directory on the same
IAM Console source tree. This is **not** proof of arbitrary-repository
code generation or of real Gemini Planning on the refactored stack.

**R5 is NO-GO:** The existing paid Gemini workflow still launches the
*historical* fixed sequential coordinator. A separately authenticated,
persistent Engineer/runner deployment and a Gemini driver using the
same signed Planning/Execution path must be demonstrated before a
paid experiment, which requires explicit user authorization.

### Current implementation and operational references

- [Canonical architecture, source map and offline integration](poc/docs/R0_Canonical_Route_Legacy_Inventory_2026-10-23.md)
- [R4 security gate and R5 readiness blockers](poc/docs/R4_Security_Gate_and_R5_Readiness_2026-10-23.md)
- [R6 legacy dependencies and removal evidence](poc/docs/R6_Legacy_Reference_Baseline_2026-10-24.md)
- [Trusted Engineer host service](poc/apps/orchestrator/README.md)
- [Cumulative offline CI](https://github.com/DarkGh0st03/delegation/actions/workflows/cumulative-refactoring-offline.yml)

R6 policy: do not re-expose the historical sequential coordinator as a
canonical API, and never delete a file while an intended runtime,
workflow, deployment or regression caller still depends on it.
Run `npm --prefix poc run audit:r6:references` before cleanup changes.

---

## Historical live Gemini baseline (15 October 2026; not the new signed workflow)

This repository implements secure delegated authorization for a bounded software-engineering multi-agent workflow. The latest successful **15 October 2026** live experiment used three Google ADK/Gemini agents (Backend, Frontend, Test) to implement Account Suspension on an IAM Console baseline. It validated the framework after the single-disposable-Gitea workflow correction; the earlier 13 October success is retained as historical evidence.

### Historical sequential architecture

**Software Engineer → deterministic Orchestrator → A2A Tasks → three ADK/Gemini agents → one shared MCP tool interface → task-scoped private Worker → Cloud Access Gateway → Rust delegated-authority verification + OPA decision → Gitea / controlled Docker Runner**.

- The Orchestrator creates the feature branch and PR through the Gateway **directly**, not through agent MCP tools.
- Rust issues/verifies Delegation Credentials and signed Verifiable Presentations; Ethereum/Anvil provides DID/trust/status sources.
- Gemini decides which allowed tools to request, but never receives Gitea secrets, the private credential, or signing keys.
- The Docker Runner fetches an exact SHA; a separate trusted Security CI reruns the tests. Human approval is required before merge.

### Historical component map

| Path | Responsibility |
| --- | --- |
| `src/delegation/` | Rust VC/DC/VP, accumulators, issuance, trust and revocation |
| `services/delegation-adapter/` | HTTP interface to the Rust core |
| `blockchain/` | DID/Anvil/EVM registries and trust anchors |
| `poc/packages/orchestrator-runtime/` | Deterministic workflow, child authority and PR gate |
| `poc/packages/agent-runtime/` | A2A server, ADK/Gemini, private evidence and Task Worker |
| `poc/mcp-shared/` | Shared tools, task JWT verification, TaskRouter |
| `poc/apps/gateway/` | Permission canonicalization, prepare/execute, Rust/OPA/provider clients |
| `poc/apps/test-runner-controller/` | Exact-SHA Docker runner and trusted Security CI |
| `poc/opa/` | Rego policy |
| `poc/runner/acceptance/` | Researcher-owned tests outside model-editable repository |
| `poc/infra/` | Local Gitea, OPA, Anvil bootstrap |

**Historical live entrypoint (NOT R5):** `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`  
**Historical paid workflow (NOT R5):** `.github/workflows/gemini-paid-shared-mcp-final.yml`  
**Offline E2E regression:** `.github/workflows/shared-mcp-real-positive-e2e.yml`.

The billable workflow **must never be launched automatically**.

### Historical tested checkpoint

**Latest authoritative tested framework commit:** [`02c3395b9111a63ccc9f441ea2c91c81865d6673`](https://github.com/DarkGh0st03/delegation/commit/02c3395b9111a63ccc9f441ea2c91c81865d6673); **manual paid run #5:** [38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415), **15 October 2026, SUCCESS** (first attempt). Three real Gemini ADK/A2A roles wrote all 11 delegated files via a single shared MCP and one disposable Gitea. The six Docker project phases, independent researcher acceptance and separate trusted exact-SHA Security CI passed. The temporary Gitea PR stayed open; merge was blocked (`human_approval_missing`). This result verifies the code at the **tested SHA**, not any later documentation-only commit or future checkout.

The earlier successful [13 October run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) at `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` remains a distinct historical experiment. Neither run is a production certification or a new latency measurement.

### Historical reference documents

- [PR #10 technical audit and file decisions](docs/PR10_TECHNICAL_AUDIT.md)
- [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- [Current checkpoint](docs/CURRENT_CHECKPOINT.md)
- [Implementation map](docs/IMPLEMENTATION_STATE.md)
- [Current GitHub Actions](docs/ADK_MCP_ACTIONS_CATALOG.md)
- [Latest real Gemini run evidence — 15 October 2026](docs/LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-15.md)
- [Earlier real Gemini run evidence — 13 October 2026](docs/LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md)
- [Independent code review of the **13 October** generated output only](docs/GENERATED_CODE_SECURITY_REVIEW_2026-10-13.md)
- [Reproducibility and pinned historical comparisons](docs/REPRODUCIBILITY.md)
- [Human-approval boundary](docs/human-approved-gitea-merge.md)

The older ADK/OpenAI experiments, obsolete numbered-phase integration scripts and stage-by-stage diaries have been removed from the working tree, **not erased from Git history**. Historical latency measurements remain valid only at `cbadb5440db408d4047d4eb870a9fb231362414a`, not for the latest Gemini build.

## Offline unit checks

```bash
npm --prefix poc ci --ignore-scripts --no-audit --no-fund
npm --prefix poc run check:scaffold
npm --prefix poc run gateway:test
npm --prefix poc run agent-runtime:test
npm --prefix poc run orchestrator-runtime:test
npm --prefix poc run test -w @thesis/test-runner-controller
npm --prefix poc/mcp-shared ci --ignore-scripts --no-audit --no-fund
npm --prefix poc/mcp-shared test
cargo test --locked
cargo test --manifest-path services/delegation-adapter/Cargo.toml
forge test --root blockchain
```
