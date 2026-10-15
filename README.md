# Delegation — current thesis PoC

This repository implements secure delegated authorization for a bounded software-engineering multi-agent workflow. The successful **13 October 2026** experiment used three Google ADK/Gemini agents (Backend, Frontend, Test) to implement Account Suspension on an IAM Console baseline.

## How the current system works

**Software Engineer → deterministic Orchestrator → A2A Tasks → three ADK/Gemini agents → one shared MCP tool interface → task-scoped private Worker → Cloud Access Gateway → Rust delegated-authority verification + OPA decision → Gitea / controlled Docker Runner**.

- The Orchestrator creates the feature branch and PR through the Gateway **directly**, not through agent MCP tools.
- Rust issues/verifies Delegation Credentials and signed Verifiable Presentations; Ethereum/Anvil provides DID/trust/status sources.
- Gemini decides which allowed tools to request, but never receives Gitea secrets, the private credential, or signing keys.
- The Docker Runner fetches an exact SHA; a separate trusted Security CI reruns the tests. Human approval is required before merge.

## Where the current implementation lives

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

**Main live entrypoint:** `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`  
**Manual paid workflow:** `.github/workflows/gemini-paid-shared-mcp-final.yml`  
**Offline E2E regression:** `.github/workflows/shared-mcp-real-positive-e2e.yml`.

The billable workflow **must never be launched automatically**.

## Verified experimental checkpoint

[GitHub run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436), framework SHA `9012c8c4e7a9244cb931bcdef411cc5f443f0c08`, generated 11 application files; the six Docker project phases, independent researcher acceptance and separately trusted exact-SHA CI passed. The pull request existed in **disposable Gitea** only, and remained unmerged (`human_approval_missing`). This is a bounded successful PoC, not a production certification.

## Read these current documents

- [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- [Current checkpoint](docs/CURRENT_CHECKPOINT.md)
- [Implementation map](docs/IMPLEMENTATION_STATE.md)
- [Current GitHub Actions](docs/ADK_MCP_ACTIONS_CATALOG.md)
- [Real Gemini run evidence](docs/LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md)
- [Independent code review](docs/GENERATED_CODE_SECURITY_REVIEW_2026-10-13.md)
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
