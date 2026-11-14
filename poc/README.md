# poc — Node.js workspace

Everything that runs in the `app`, `runner` and `staging` containers (see
[docs/LOCAL_SETUP.md](../docs/LOCAL_SETUP.md) and the [root README](../README.md)).

| Folder | Role |
| --- | --- |
| `engineer-console/` | Sigillo, the Engineer console: web UI, sessions (Planning → signed review → execution), Gemini models and budgets, repository import, staging profiles |
| `apps/gateway/` | Policy Enforcement Point: every agent operation is prepared, verified (Rust VP + OPA) and executed on Gitea or the Runner |
| `apps/orchestrator/` | Trusted Engineer host: Review Host (Planning, signed approval, operational Root) and the operational deployment of one session |
| `apps/test-runner-controller/` | Runner: runs the Engineer-signed project test profile on an exact commit in a throw-away Docker container |
| `packages/orchestrator-runtime/` | Orchestrator logic: Planner, adaptive Task decisions, Child issuance, journals and recovery |
| `packages/agent-runtime/` | Specialist agents (Google ADK + A2A): Backend, Frontend, Documentation, Data, DevOps, Test |
| `packages/plan-contracts/` | Shared contracts: agent role registry, project profile, signed approval, path containment |
| `mcp-shared/` | Private per-Task cryptography boundary (Child DCs and VPs through each role's wallet) |
| `opa/` | Rego policy and its tests |
| `scripts/` | Local preparation, OPA tests, trust bootstrap |

Tests (no paid model calls): `npm --prefix poc run console:test`, `gateway:test`,
`agent-runtime:test`, `orchestrator-runtime:test`, `orchestrator:test`,
`plan-contracts:test`, `runner:test`, `opa:test`.
