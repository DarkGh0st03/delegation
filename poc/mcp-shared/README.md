# Shared MCP — cryptographic delegation only (R197)

## Supported architecture

The standalone MCP service is **crypto-only**. It advertises exactly
`delegation_create_presentation`, bound to an authenticated signed Task.
The former MCP repository/Runner tools (`read_file`, `update_file`,
`create_file`, `run_tests`) were physically retired from this server
and its private Agent Worker. They are implemented as controlled ADK
**FunctionTools → Gateway → Rust verifier → OPA**, independently of MCP.

```text
Signed approved Task / ADK specialized agent
   ├─ FunctionTools → Gateway prepare → verification/OPA
   │                              └─ Gateway execute → Gitea / exact-SHA Docker Runner
   └─ TrustedCryptoMcpBridge → crypto-only MCP → private Task worker
                                        └─ trusted Rust Adapter evidence signer
                                             → opaque proof_ref (VP never exposed to model)
```

For each signing request, the trusted Gateway-prepared challenge is
registered in `PrivateMcpTaskRegistry` by the private runtime.
The MCP client may only supply the previously staged `request_id`,
not the credential, operation, audience, resource URI or challenge.
The private worker validates the signed Task bearer, role, active Task
and single-use challenge before invoking its trusted signer. Signed VP
bytes remain in the private process; MCP returns an opaque
`proof_ref` and safe metadata. Only the trusted in-process consumer
may retrieve the VP once using
`takeSignedPresentation(taskId,proofRef)`.

The shared service has no delegated credential, status-list secret,
Adapter bearer, Git provider token, source-file contents or Docker
Runner execution authority. Gateway + Core Rust + OPA remain
authoritative; a Task routing JWT is not a delegated permission.

## Run the supported server

```sh
npm --prefix poc/mcp-shared ci --ignore-scripts --no-audit --no-fund
npm --prefix poc/mcp-shared test
MCP_TOOL_PROFILE=crypto npm --prefix poc/mcp-shared start
```

The default profile is also `crypto`. `MCP_TOOL_PROFILE=legacy`
is **rejected**, not a supported opt-in. Configure
`MCP_BACKEND_PUBLIC_KEY`, `MCP_FRONTEND_PUBLIC_KEY`,
`MCP_TEST_PUBLIC_KEY` and the authenticated
`MCP_<ROLE>_WORKER_URL` endpoints before starting the listener.
The default bind address is loopback `127.0.0.1:8097`.

On the A2A side, the only supported MCP endpoint configuration is
`ADK_MCP_CRYPTO_URL` plus the corresponding trusted Task signing keys.
`ADK_MCP_SHARED_URL` and the old `ADK_MCP_UPDATE_FILE`,
`ADK_MCP_CREATE_FILE`, `ADK_MCP_RUN_TESTS` selectors cannot
enable repository MCP routing. Internal ADK library callers supplying
retired repository MCP options also fail closed.

Key source boundaries:
- `src/main.ts`: validated crypto-only launcher
- `src/http-server.ts`: official MCP SDK server; one crypto tool
- `src/crypto-catalog.ts`: strict presentation request schema
- `src/crypto-worker-router.ts`: role/task-bound private crypto worker
- `src/task-token.ts`: short-lived signed Task JWT
- `poc/packages/agent-runtime/src/private-mcp-worker-http.ts`:
  `/internal/mcp-crypto-call` only
- `poc/packages/agent-runtime/src/private-mcp-task-registry.ts`:
  active-task challenge and one-time private VP custody

There is no `task-router.ts`, `legacy-repository-tools.ts`,
repository `/internal/mcp-tool-call` route, model-facing
`MCPToolset`, or repository MCP argument catalog in this supported
implementation. Historic source and experiment results remain in Git
history, not in executable entrypoints.

## Verification and limits

The free `Cryptographic MCP Profile (Offline)`,
`Trusted Crypto MCP Gateway Bridge (Offline)`, Fast CI and signed
Functional DAG/Recovery workflows test the relevant components and
negative authorization behavior. Earlier successful runs validate
their **own** commit hashes, not newer changes. The R197 same-SHA
full integration checkpoint is the release verification gate.

These scripted tests do not establish that Gemini has successfully
completed a fully autonomous paid end-to-end execution and repair.
Neither an MCP routing token nor a Task-scoped cryptographic VP
proves a model's internal reasoning or establishes automatic merge
authority. All paid Gemini workflows require separate explicit consent.
