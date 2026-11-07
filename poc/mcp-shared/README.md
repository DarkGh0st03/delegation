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

## R381.0 — independent stdio MCP transport prototype (no secrets)

The new `owner-private-crypto-stdio-server.mjs` runs in a **different
Node process**, uses the official MCP SDK `StdioServerTransport`, and
publishes **exactly one** role-selected owner-private cryptographic
operation. Its only request value is the one-time opaque
`owner_crypto_<uuid>` reference; it never receives the original Root,
Child, permissions, signer bearer, signed VP, provider credentials, or
repository source. The trusted caller uses `StdioClientTransport`
with a minimal child environment and checks the one-time response,
including a different child PID, before executing the original
owner-local Rust signing callback. Failure, replay, concurrent
invocation, closure before start, unknown operation, and private
signer errors are fail-closed.

The static catalog `owner-private-crypto-catalog.mjs` is shared with
the existing in-process MCP implementation to avoid divergent tool
names. The child process has **no HTTP or A2A listener** and cannot
mint/revoke authority by itself.

**Proof boundary:** R381.0's opt-in
`createOwnerPrivateInterprocessMcpSession` is verified by offline
subprocess tests in `test/owner-private-crypto-stdio.test.ts`.
**R381.1** also exposes `privateMcpTransport:"stdio"` exclusively on
the original `TrustedAuthorityOnlyChildIssuer` constructor, AFTER its
immutable Task/Child/journal admission. The default remains
`"in-process"`. An independent offline issuer regression verifies
that the same original owner-native Rust signer port is invoked once,
the issued credential is not leaked by MCP, and invalid Child/replay
cannot reissue. There is no automatic stdio fallback to the legacy
MCP transport on failure.

This option is **not yet activated by the canonical production
launcher**, and the crypto callback still executes inside the
original owner, after the MCP acknowledgement. These tests demonstrate
a real interprocess MCP capability/transport boundary and optional
Child-issuer adoption, **not** complete signing through a standalone
MCP cryptographic service, not root/VP service migration, not the
whole B architecture gate, and not an AI-generated workflow.
The production default, single original Rust signer, Gateway and OPA
remain unchanged. Next, prove a native Rust/EVM Child/DC/VP with the
trusted owner-selected stdio option, then evaluate an authenticated
service-side signing channel without introducing another signer or
exposing a public crypto endpoint.

## Retired remote compatibility paths

R264 physically removes the old `poc/mcp-shared/src/http-server.ts`,
`crypto-worker-router.ts`, and
`poc/packages/agent-runtime/src/private-mcp-worker-http.ts`,
plus their obsolete HTTP integration tests. The formerly remote
`TrustedCryptoMcpBridge` client was removed at R262.
Canonical A2A startup regressions continue checking that the private
crypto and repository HTTP worker routes are absent.

The historical Rust Adapter HTTP executable and separately selected
older credential transports still exist pending their own architecture
gate. They are **not** the canonical signed Engineer/Gateway path.
The underlying Rust `CryptoRuntime` crate must be preserved.

## Verification

Use the **free** task-local MCP and native Rust regressions, Fast CI,
and the Engineer-embedded signed Gitea/Docker DAG and D1 workflows.
The 4 November R258 positive DAG and R261 D1 both succeeded on their
respective SHAs; a new source change still needs its own green Fast CI
and a final consolidated same-SHA checkpoint. These scripted tests
do not certify autonomous Gemini repair.

No paid Gemini invocation, `main` merge, automatic PR merge or new
experiment is authorized by this cleanup.
