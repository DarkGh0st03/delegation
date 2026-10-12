# One shared MCP server — experimental spike

Status: **scaffold only; not integrated with the working A2A/ADK workflow**.
This package deliberately lives outside existing `poc` npm workspaces so
the frozen `poc/package-lock.json` and npm CI are untouched.

## Why this architecture

- Exactly **one shared Streamable HTTP MCP server** for all Agents and tasks.
- One operational catalog, initially only `read_file`. This is an implemented
  subset of the Rust `Operation` enum, not a new authorization vocabulary.
- Gemini supplies only tool name and application arguments. The role/task are
  authenticated from a short-lived per-task Ed25519-signed bearer.
- MCP stores only **public verification keys**, not Adapter/Gitea tokens,
  signed presentations, private signing keys or Delegation Evidence.
- MCP routes each call to the trusted worker of the authenticated Agent role.
  The private worker must independently verify the bearer, confirm that the
  task is ACTIVE in its task store, and use the existing task-scoped
  `GatewayControlledToolClient` / `DelegationEvidenceHandler`.
- Gateway derives Permission. Rust Verifier and OPA decide enforcement.
  A valid MCP bearer **does not** grant a repository Permission.

## Run

```sh
cd poc/mcp-shared
npm install             # creates an isolated lockfile for the spike
npm test
npm start
```

Environment (required): `MCP_BACKEND_PUBLIC_KEY`, `MCP_FRONTEND_PUBLIC_KEY`,
`MCP_TEST_PUBLIC_KEY`; `MCP_BACKEND_WORKER_URL`,
`MCP_FRONTEND_WORKER_URL`, `MCP_TEST_WORKER_URL`.
Optional: `MCP_BIND_HOST` (default `127.0.0.1`),
`MCP_BIND_PORT` (default `8097`).

An MCP health response does not establish that authorization works.
The worker endpoint is **not implemented** yet, so `tools/call` fails closed
until that integration is complete.

## Security and implementation gates

1. Add private Agent worker `POST /internal/mcp-tool-call`, bound to an ACTIVE
   A2A task and its existing private GatewayControlledToolClient.
2. The runtime alone mints task bearer tokens and supplies them as an HTTP
   authorization header to ADK MCPToolset. The LLM must never see them.
3. Verify Backend task A cannot use a Frontend token or inactive task B.
   These JWTs are *replayable while live*: use short expiry, TLS/isolation,
   keep them out of logs, and reject completed/cancelled tasks at the worker.
4. Preserve original Gateway `prepare → VP → execute`, Verifier and OPA.
   No direct Gitea/Runner token is allowed in MCP.
5. Preserve confirmed results for the A2A Artifact. A read-only MCP test
   is not a successful end-to-end A2A workflow: no write means no commit SHA.
6. Run complete security, functional and Gemini regressions before GO/NO-GO.

No changes to Rust, Orchestrator permission templates, OPA, Gateway or main.
