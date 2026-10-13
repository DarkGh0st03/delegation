# Verified real Gemini / ADK / A2A / shared MCP end-to-end experiment

**13 October 2026 — SUCCESS**: [GitHub Actions run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436), run number 3, first attempt of this manual dispatch.

## Exact provenance

- GitHub framework ref: `main`, `9012c8c4e7a9244cb931bcdef411cc5f443f0c08`.
- Workflow: `.github/workflows/gemini-paid-shared-mcp-final.yml`, manual `workflow_dispatch` only. The model-key access was limited to the actual paid stage.
- Configured Gemini model: `gemini-3.8-flash`, thinking `LOW`, max output 32,000 tokens per inference.
- Real Google ADK roles: Backend, Frontend, Test. The Orchestrator is deterministic TypeScript, using protected A2A tasks, one shared Streamable HTTP MCP server and delegation enforcement through Gateway/Rust/OPA.
- Hardened reference-app baseline: `DarkGh0st03/iam-console-poc` at `405748b1e77992b6bd8630a3ab6f990658d32f6b`.

## Generated code

| Agent | Generated files | Ephemeral Gitea commit |
| --- | ---: | --- |
| Backend and shared API contract | 4 | `67af85001a2485c9c479b1acac5aeff3da4fc2f4` |
| Frontend | 3 | `3c207436589b8f44c06414fdfacb8e749d2417d7` |
| Test | 4 | `3306f08aa57ebfe9635842e61b3a3c2a768e1ee7` |
| **Total** | **11** | **Final SHA: `3306f08aa57ebfe9635842e61b3a3c2a768e1ee7`** |

## Checks actually observed

- Read-only Backend/Frontend API contract preflight: `PASS`, no failures.
- Real Docker Runner: dependency installation, typecheck, backend tests, frontend tests, build and Playwright E2E: all `PASS`.
- Independent researcher acceptance: `PASS`.
- Independent trusted Security CI: separate identity reran real Docker tests; exact feature SHA status `pending → success`.
- Feature PR **#1 in disposable job-local Gitea only**: created; merge-readiness **DENIED** with `human_approval_missing`. No reviewer was fabricated, no actual merge occurred, and temporary `main` remained unchanged.
- Overall live three-role runtime verdict: `PASS`. This is the first successful real-Gemini shared-MCP full workflow after earlier unsuccessful attempts.

## Gemini telemetry, not invoice

| Role | Completed inferences | Input tokens | Output tokens |
| --- | ---: | ---: | ---: |
| Backend | 13 | 82,800 | 2,341 |
| Frontend | 6 | 49,322 | 3,693 |
| Test | 9 | 116,731 | 5,195 |
| **Total** | **28** | **248,853** | **11,229** |

These are runtime-reported counters for completed responses. Thinking tokens were not reported separately; the monetary amount actually invoiced has not been independently certified.

## Artifact and retention

The original [run artifact](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) is `gemini-shared-mcp-evidence-38379922436`, ID `11802414698`, containing **11 generated source files plus `manifest.json`**. Its downloaded ZIP hash matches GitHub's digest:

`sha256:60245281abc619bce3eeaf195d85a6cb1184fb15ed0aa2ffcf6a9fd0f759269f`.

GitHub advertises expiry at **2026-10-27 10:04:45 UTC**. Back up the original ZIP separately under project-approved access controls; this Markdown summary does not preserve those source bytes. Generated code and the temporary PR were **not** merged into a persistent app repository.

## What this proves — and does not prove

The test demonstrates the bounded, live-generative execution path with three real Gemini roles and independently enforced authorization/CI gates. It does **not** establish production readiness, reliable behavior across untested tasks, a genuine human-approved merge, or new end-to-end authorization latency measurements.

Preliminary inspection found consistent `/suspend` and `/reactivate` routes, 404/409 state-transition handling, matching accessible frontend buttons and generated backend/frontend/E2E tests. The reference application uses an in-memory user repository and a client-supplied `x-demo-role: admin` header: neither is a production-grade identity/access design. Independent code and security review is needed before any persistent import.

Historical Phase 12 performance measurements remain exclusively pinned to `cbadb5440db408d4047d4eb870a9fb231362414a`. The early [failed Gemini run 38363401514](https://github.com/DarkGh0st03/delegation/actions/runs/38363401514) remains part of the history, but must not be confused with this success.

**Next work:** archive the ZIP, review generated code and limitations, and update the thesis evaluation. Do not repeat paid Gemini runs automatically; another billable test needs the thesis owner's explicit decision.

See [CURRENT_CHECKPOINT.md](CURRENT_CHECKPOINT.md), [manual experiment procedure](gemini-shared-mcp-final-run.md), and [human merge boundary](human-approved-gitea-merge.md).
