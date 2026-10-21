# Shared MCP Server — active ADK/A2A integration

## Phase 7 — Cryptographic-only MCP profile (opt-in)

The future architecture uses MCP as an interface for **delegation cryptography**
rather than a general router for repository modification. To avoid breaking
the previously validated Account Suspension E2E, this branch introduces a
separate profile selected at startup:

```sh
MCP_TOOL_PROFILE=crypto npm --prefix poc/mcp-shared start
```

The **new `crypto` profile** advertises **only**
`delegation_create_presentation`. It accepts an existing Gateway
`request_id`, never a caller-chosen credential, operation, audience,
resource URI or challenge. The profile forwards the request over the
authenticated role/task worker bridge. The private worker requires a
**previously staged Gateway challenge** supplied exclusively by trusted
runtime code (`PrivateMcpTaskRegistry.stageGatewayChallenge`).
An unknown or expired challenge, a stopped A2A task, or token
role/task mismatch is rejected before cryptographic signing.

The private Agent Worker uses its existing **Rust Adapter-backed**
`DelegationEvidenceHandler` and per-task delegated credential. The
signed JWT VP remains **in that private process** and is never returned
to the MCP endpoint or Gemini. The MCP result contains an opaque
`proof_ref` and safe credential metadata. Only a trusted in-process
consumer may retrieve the VP through the one-shot
`PrivateMcpTaskRegistry.takeSignedPresentation(taskId, proofRef)` API;
there is no HTTP route for that operation.

No issuing keys, Adapter caller secrets, DC contents, signed VPs or
Gitea/Runner credentials are stored in the shared MCP process. Neither
MCP profile grants permissions: the Gateway, Rust verifier and OPA
enforce them independently.

**Migration boundary:** the `legacy` profile is the default during
this stage to preserve the historical scripted/live workflows.
It exposes the original four tools through the original worker path.
Do **not** point those ADK clients at `MCP_TOOL_PROFILE=crypto` yet:
the current ADK tool configuration still expects `read_file`,
`update_file`, `create_file` and `run_tests`. The trusted Gateway
prepare → crypto-MCP proof-ref → Gateway execute wiring, and the
subsequent direct-Core Rust Gateway integration, remain future work.
This change only validates the new secure cryptographic MCP surface,
not a completed live-system cutover or paid Gemini E2E.

The dedicated `Cryptographic MCP Profile (Offline)` workflow tests
both profiles with the official MCP SDK and the existing protected
ADK/A2A agent unit suites. It uses **no paid AI calls**.


One shared **Streamable HTTP MCP** server exposes four agent-facing operations: `read_file`, `update_file`, `create_file` and `run_tests`. Google ADK exposes `read_file`, `update_file` and `create_file` through `MCPToolset`. For `run_tests`, a dedicated ADK `FunctionTool` still calls this same shared MCP endpoint with the MCP SDK and an explicit bounded request timeout, rather than bypassing MCP. The Orchestrator's `create_branch` and `create_pull_request` are **direct Gateway calls**, not MCP tools.

## Actual secure path

```text
Google ADK Agent → MCPToolset / bounded MCP SDK run_tests → Shared MCP Server
    → TaskRouter → private Agent Worker
    → task-specific GatewayControlledToolClient
    → Gateway prepare → signed VP (Rust Adapter)
    → Gateway execute → Rust verification → OPA decision
    → Gitea or exact-SHA Controlled Docker Runner
```

- `src/catalog.ts`: controlled tool names and argument schemas.
- `src/http-server.ts`: shared MCP server/transport.
- `src/task-token.ts`: signed, short-lived JWT bound to role and task.
- `src/task-router.ts`: routes requests to the configured private Agent Worker.
- `poc/packages/agent-runtime/src/private-mcp-task-registry.ts`: active-task-only private Gateway client context.

MCP does **not** hold DC evidence, Adapter service secrets or Gitea/Runner tokens. The JWT proves trusted task routing, not delegated authority; the Gateway and Rust/OPA still authorize every operation.

## Run/tests

```bash
npm --prefix poc/mcp-shared ci --ignore-scripts --no-audit --no-fund
npm --prefix poc/mcp-shared test
npm --prefix poc/mcp-shared start
```

For the standalone listener, configure `MCP_BACKEND_PUBLIC_KEY`, `MCP_FRONTEND_PUBLIC_KEY`, `MCP_TEST_PUBLIC_KEY` and fixed `MCP_<ROLE>_WORKER_URL` values before starting. The listener defaults to `127.0.0.1:8097`.

The historical three-role live experiment [run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) used real Gemini and shared MCP at SHA `9012c8c4e7a9244cb931bcdef411cc5f443f0c08`. The later paid [15 October run 38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) is associated with SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673`. Neither result automatically validates later audit refactors; the paid path forbids automatic merge.

**Limitations:** tokens must remain confidential; task-binding is enforced by the private runtime, not by an A2A-signed DC task claim. The single Account Suspension scenario is not a universal authorization policy.
