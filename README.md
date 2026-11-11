# Delegation — authority-only thesis PoC

## Quick start (local, Docker only)

Requirements: Docker (on Windows: Docker Desktop). From the repository root:

```bash
cp .env.example .env        # then set ENGINEER_PASSWORD in .env
docker compose up -d --build
```

Open **http://127.0.0.1:8700** and sign in as `engineer`. The first build compiles the
native Rust modules and takes several minutes. Compose starts Gitea, OPA and Anvil,
prepares accounts, the example repository and the on-chain registries automatically,
then the Engineer console. Full guide (Italian): [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

**Current status of the local application:** login, environment checks, repository
selection/import, per-repository policy parameters and requirement drafts work.
Planning with permission review, signed approval and agent execution are being
wired into the console next; until then the full authority-only chain is exercised
by the scripted native E2E described below.

**Start here:** [Current authority-only roadmap](docs/ACTIVE_AUTHORITY_ONLY_ROADMAP.md) and [implementation map](docs/IMPLEMENTATION_STATE.md). The 15 October Google ADK/Gemini experiments described in older documents are **historical**, not the current execution architecture.

## Canonical authority-only execution

1. An independently authenticated **Software Engineer** uses the **Rust cryptographic Core directly** to issue a read-only preliminary Root. Orchestrator/ADK Planning explores the pinned Gitea revision through the Gateway.
2. The Engineer reviews and **Ed25519-signs only the immutable permission scope**. The proposed task DAG is **not** an immutable, Engineer-signed execution plan. The preliminary Root is revoked before a distinct operational Root is issued.
3. The **Planner/Executor** dynamically selects and revises operations under that scope. The current Account Suspension PoC has Backend, Frontend and Test agents via Google ADK/A2A; the signed Child delegations are attenuated and checked per task.
4. The **Gateway directly uses Rust verification** and OPA. The task-local **private/stdio cryptographic MCP** handles signed Child DC and VP material; the historical shared HTTP MCP/worker path is **not** the canonical path.
5. Gitea reads and HEAD/CAS updates are independently verified. The controlled Docker Runner and researcher-owned acceptance supply exact-revision evidence. Test failures can cause signed diagnostic reads and bounded new repairs **without expanding authority**.
6. The owner may create a **Draft PR on disposable Gitea** only after a verified PASS. Separate Security CI and Human Gate remain independent; **no automatic merge**.

### Verified results, with boundaries

- [Fast CI #42477209047](https://github.com/DarkGh0st03/delegation/actions/runs/42477209047) and [positive Security CI #42477209043](https://github.com/DarkGh0st03/delegation/actions/runs/42477209043) passed on the **same SHA** `bbb60fa09d88b0f2949a5c6452f340aedbc33f54`. The positive Security CI contains both a historical Runner regression and a full native Rust/Child/VP/MCP E2E.
- [Native R385.19 #42478904754](https://github.com/DarkGh0st03/delegation/actions/runs/42478904754) and [Fast CI #42478904760](https://github.com/DarkGh0st03/delegation/actions/runs/42478904760) passed on SHA `8bf19fd59e042b7e4f189f9a543aa8933a169680`: real Docker **FAIL → 10 authenticated diagnostic reads and 10 CAS → PASS**, researcher acceptance and independent Draft PR checks, **0 paid model calls**.
- The latest cleanup removed 69 superseded milestone reports and 7 obsolete milestone workflows plus their 7 trigger JSONs. Source tests, the native E2E, private cryptographic MCP and the specific negative Rust/EVM and stale-CAS regressions remain.
- **Critical limit:** native recovery patches and decisions are **scripted**. These PASSes do **not** prove autonomous real-Gemini code generation, arbitrary repository support, actual GitHub protected-environment reviewer configuration, or Security CI status on the **same native Gitea PR**.

## Essential source and CI

| Boundary | Current entrypoint |
| --- | --- |
| Engineer Root and direct Rust selection | `poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts` |
| Canonical owner bootstrap | `poc/apps/orchestrator/src/trusted-authority-only-owner-bootstrap.mjs` |
| Dynamic ADK decision proposer | `poc/packages/orchestrator-runtime/src/trusted-authority-only-adk-decision-proposer.mjs` |
| Agent Cards and tools | `poc/packages/agent-runtime/src/cards.ts`, `adk-specialized-agents.ts` |
| Private cryptographic MCP | `poc/mcp-shared/src/owner-private-*` |
| Real Docker / Security CI | `.github/workflows/isolated-positive-security-ci.yml` |
| Full native Rust/OPA/Gitea/MCP/A2A E2E | `.github/workflows/r38513-native-strict-full-recovery.yml` |
| Manual Human Gate | `.github/workflows/human-approved-gitea-merge.yml` |

**Historical Engineer HTTP access is disabled by default** and additionally forbidden in native authority-only mode; old offline fixtures must opt in explicitly with `DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE=1`. No model may select this transport or the trusted signing authority.

## Local, no-paid-model checks

Run on the selected commit, with pinned dependencies available:

- `npm --prefix poc ci --ignore-scripts --no-audit --no-fund`
- `npm --prefix poc run check:scaffold`
- `npm --prefix poc run gateway:test`
- `npm --prefix poc run agent-runtime:test`
- `npm --prefix poc run orchestrator-runtime:test`
- `npm --prefix poc run audit:r6:references`
- `cargo test --locked`

**Never trigger a billable Gemini workflow without explicit cost approval. Never merge `main` automatically.** The Human Gate requires an independently authorized human.

### Historical, separately bounded research evidence

The [15 October 2026 manual Gemini run #38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) did succeed on the **older shared-MCP sequential architecture**, SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673`. It does **not** validate the current authority-only execution. See [historical evidence](docs/LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-15.md), [historical security review](docs/GENERATED_CODE_SECURITY_REVIEW_2026-10-13.md), and the git history of [older checkpoint](docs/CURRENT_CHECKPOINT.md). Do not re-enable the retired paid Shared MCP workflow as a substitute for the current architecture.
