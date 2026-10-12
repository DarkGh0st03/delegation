# One shared MCP server — experimental spike

Status: **shared MCP scaffold + optional private A2A worker endpoint implemented**.
The end-to-end `MCPToolset → MCP → worker → Gateway → Rust → OPA` path is **NOT yet
validated**. The existing ADK agents still invoke their original local
`FunctionTool` wrappers. Do not count MCP as integrated with Gemini.

The standalone `poc/mcp-shared` package is deliberately outside existing
`poc` npm workspaces for this spike: the frozen `poc/package-lock.json` and
baseline CI are unchanged.

## Architecture

```text
                   ONE shared MCP server (Streamable HTTP)
       Backend Agent ──┐           │
       Frontend Agent ─┼── MCP authenticated tools/call
       Test Agent ─────┘           │
                                 ▼
                     role-routed private worker
                                 │
                  ACTIVE task registry, task_id + jti
                                 │
                     task-scoped Gateway client
                                 │
                       prepare → signed VP → execute
                                 │
                       Rust Verifier → OPA → Gitea
```

- The MCP service stores only public Ed25519 verification keys and fixed
  worker endpoints. It **never** receives the Adapter token, Delegation
  Evidence or a Gitea/Runner token.
- A task-scoped signed bearer is issued by the trusted Agent runtime. The token
  carries role, task_id, audience, issued/expiry timestamps and a random jti;
  it is NOT a Delegation Credential and does not authorize repository access.
- A private `POST /internal/mcp-tool-call` worker is mounted on the existing
  Agent A2A Express server **only when** `mcpTaskSigning` is explicitly supplied
  in `startSpecializedAgentServer({role,adk,mcpTaskSigning})`.
- The worker checks the token signature, exact active task id and current jti.
  It then uses that task's EXISTING `GatewayControlledToolClient`, which owns
  its own `DelegationEvidenceHandler`. Task cancellation/finish deregisters it.
- The only supported tool in this spike is `read_file`. The Gateway (not MCP)
  computes the authoritative ResourceUri and Operation.
- Cross-role or cross-task token selection is not an LLM-controlled argument.

## Running the shared server

```sh
cd poc/mcp-shared
npm install
npm test
npm start
```

The MCP server expects `MCP_BACKEND_PUBLIC_KEY`, `MCP_FRONTEND_PUBLIC_KEY`,
`MCP_TEST_PUBLIC_KEY`, plus the three fixed `MCP_<ROLE>_WORKER_URL` values.
By default it binds `127.0.0.1:8097`.

The private Agent worker must be enabled using the matching keypair in trusted
runtime configuration. The runtime's private signing key is never given to MCP.
The worker listens on the Agent's existing private network endpoint.

**Current limitation:** the runtime has the task token available internally,
but ADK `MCPToolset` has not yet been wired to consume it. A successful
`/health` response does not demonstrate functional MCP authorization.

## Security limitations (deliberate / not yet solved)

1. A task bearer can be replayed by whoever possesses it until it expires,
   rotates, or the worker deregisters the task. It is scoped to one active
   task/Agent and still subject to Gateway/DC/VP/OPA, but must be protected
   in transport, memory and logs. Keep the worker on a private network.
2. The existing VP does not carry a cryptographically signed A2A task_id claim.
   This spike enforces cross-task isolation through trusted active-task
   association, not by modifying Rust cryptography.
3. MCP results must be adapted to the existing Gateway-confirmed ADK tool
   outcomes. An LLM's claimed success is never sufficient for an A2A Artifact.
4. read_file-only cannot complete a full positive A2A task, which currently
   requires a confirmed repository revision. Test MCP read separately before
   the full write/Artifact integration.
5. Real MCP SDK and ADK transport integration, cross-task HTTP tests, provider
   smoke and security regression remain mandatory before any GO decision.

No modifications to core Rust, OPA, Gateway, Orchestrator templates or main.
