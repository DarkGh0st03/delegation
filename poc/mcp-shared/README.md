# Delegation — cryptographic MCP boundary (R262)

## Canonical approved-plan architecture

The approved signed DAG uses **task-local, in-process MCP**, not a
standalone Shared MCP HTTP service:

```text
Software Engineer (trusted host)
   → delegation-engineer.node → one Rust CryptoRuntime
   → preliminary/operational root DC issue/revoke (Engineer only)

Orchestrator → trusted signed Task DAG
   → owner-private, one-shot crypto MCP → authenticated native Rust Child DC
Backend / Frontend / Test (signed A2A Task)
   ├─ approved Gateway FunctionTools → Gateway → public Rust verifier → OPA
   │                                      → Gitea / exact-SHA Docker Runner
   └─ LocalCryptoMcpBridge (one-shot MCP SDK) → private task registry
        → role-authenticated native Rust socket (same CryptoRuntime)
        → signed VP used privately for Gateway Execute
```

The native Gateway verifier is **public-only** and independent of the
Engineer-owned signer. The model cannot call root issuance, alter delegated
permissions, read signing keys or access VP bytes. The MCP catalog offers
only `delegation_create_presentation`; repository/Runner tools belong to
the Gateway FunctionTools, with signed plan and OPA enforcement.

Production implementation: `poc/packages/agent-runtime/src/local-crypto-mcp-bridge.ts`,
`private-mcp-task-registry.ts`, `native-crypto-ipc.ts`,
`poc/mcp-shared/src/owner-private-child-mcp.ts`, and
`poc/packages/orchestrator-runtime/src/trusted-engineer-direct-core-port.ts`.
There is **no** `poc/mcp-shared/src/main.ts` executable or npm `start`
command. The obsolete remote `TrustedCryptoMcpBridge` SDK client has
also been physically removed.

## Compatibility remaining outside the canonical runtime

The legacy `poc/mcp-shared/src/http-server.ts`,
`crypto-worker-router.ts`, and the agent's
`private-mcp-worker-http.ts` are retained only by isolated historical
HTTP regressions. They do **not** run in the signed A2A/Engineer DAG.
Do not re-enable an HTTP MCP listener, Adapter URL or model-facing
repository MCP tool to make an old fixture pass. The historical Rust
Adapter HTTP implementation also remains pending its own deletion gate;
its underlying Rust `CryptoRuntime` library must be preserved.

## Verification

Use the **free** task-local MCP and native Rust regressions, Fast CI,
and the Engineer-embedded signed Gitea/Docker DAG and D1 workflows.
The 4 November R258 positive DAG and R261 D1 both succeeded on their
respective SHAs; a new source change still needs its own green Fast CI
and a final consolidated same-SHA checkpoint. These scripted tests
do not certify autonomous Gemini repair.

No paid Gemini invocation, `main` merge, automatic PR merge or new
experiment is authorized by this cleanup.
