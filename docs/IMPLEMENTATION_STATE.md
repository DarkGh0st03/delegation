# Current implementation state — 15 October 2026

The active thesis PoC runs **three Google ADK/Gemini roles**, protected A2A tasks, **one shared Streamable HTTP MCP server**, private task workers, deterministic Orchestrator, Gateway/Rust/OPA authorization, Gitea, exact-SHA Docker Runner, independent researcher acceptance, trusted CI and human merge gate.

## Reference experiment

- [Live Gemini run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436), framework SHA `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` (13 October 2026): **PASS**.
- Backend, Frontend and Test together produced 11 files on a disposable Gitea feature branch.
- Preflight, six project Docker phases, independent researcher acceptance and separately trusted CI passed.
- PR opened but **no human approval and no merge** (`human_approval_missing`).
- Historical measured checkpoint `cbadb5440db408d4047d4eb870a9fb231362414a` is **not** a performance measurement of this code.

## Locate each part in source

| What | Entry point |
| --- | --- |
| GitHub Actions | `.github/workflows/gemini-paid-shared-mcp-final.yml` |
| Live orchestration/bootstrap | `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs` |
| Coordinator and child DC templates | `poc/packages/orchestrator-runtime/src/sequential-coordinator.ts`, `permission-templates.ts` |
| A2A/ADK | `poc/packages/agent-runtime/src/server.ts`, `executor.ts`, `adk-a2a-handler.ts` |
| Task-specific tool Worker | `poc/packages/agent-runtime/src/private-mcp-task-registry.ts` |
| Shared MCP | `poc/mcp-shared/src/http-server.ts`, `task-router.ts` |
| Gateway | `poc/apps/gateway/src/prepare.ts`, `execute.ts`, `canonical.ts` |
| Rust adapter and crypto | `services/delegation-adapter/src/http.rs`, `src/delegation/` |
| OPA | `poc/opa/policy.rego` |
| Controlled tests/CI | `poc/apps/test-runner-controller/src/isolated-executor.ts`, `trusted-security-ci.ts` |
| Human gate | `poc/packages/orchestrator-runtime/src/merge-readiness.ts` |

## Important boundaries and limitations

The Orchestrator, not MCP, calls `create_branch` and `create_pull_request` through the Gateway. Private DC evidence never enters Gemini's model-visible context; the Gateway derives the requested file/branch permission and requires both a valid Rust-delegation result and allow from OPA. The scenario, permission templates, policy, integration preflight and acceptance tests are intentionally specific to IAM Console, not generalized.

**Do not** launch another paid Gemini run without explicit authorization. Read [current checkpoint](CURRENT_CHECKPOINT.md), [live run evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md), [security review](GENERATED_CODE_SECURITY_REVIEW_2026-10-13.md), [active workflows](ADK_MCP_ACTIONS_CATALOG.md) and [architecture decisions](ARCHITECTURE_DECISIONS.md).

Old phase diaries are available by checking out the old Git commits rather than appearing among current source directories.
