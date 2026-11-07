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
**R381.2 native checkpoint PASS:** the original R292 authority-only
E2E now optionally enables the stdio broker for one native Child and
all three native Backend VPs. In the disposable run
[#42378351480](https://github.com/DarkGh0st03/delegation/actions/runs/42378351480)
the same Rust CryptoRuntime issued the Root/Child and three presentations;
the independent Core Rust/EVM/status verifier and real OPA checked the
delegation. The Gateway still rejected unauthorized execution, an
unbound Child and the VP after native Root revocation. The structured
receipt reports exactly three brokered presentations, three native
presentation calls, zero provider effects and zero paid AI calls.
[Fast CI #42378351487](https://github.com/DarkGh0st03/delegation/actions/runs/42378351487)
also passed on the same SHA `71eebebd`.

The production default remains in-process. Importantly, the broker
acknowledges a one-shot owner request in its own process; **the actual
Rust signing callback still runs in the original owner after the MCP
ACK**, not in the broker subprocess. Therefore R381.2 is an authenticated
end-to-end **transport opt-in proof**, not a standalone interprocess
cryptographic signer/service. The full signed-workflow E2E and actual
server-side MCP signing boundary remain separate follow-up gates.
Never interpret the broker as holding a second signer, and do not
expose an MCP crypto method to an ADK model or public A2A client.

## R381.3 — trusted native Rust execution INSIDE private MCP stdio

The opt-in `createOwnerPrivateNativeCryptoMcpSession` is a different boundary
from the R381.0–R381.2 ACK-only broker. A short-lived MCP subprocess receives a
role-scoped bearer, exact native request and private Unix socket path **only
over its owner-controlled stdio MCP channel** (not argv, environment, HTTP,
A2A, or an ADK FunctionTool). Its selected operation is fixed before launch:
**Child issuance** or **presentation creation** only. Root issuance and
revocation remain direct Software Engineer → Rust. The subprocess invokes
the existing `invokeNativeCrypto` native Rust socket client and sends the
signed credential or VP back in a private MCP response, not to the model.
The existing native Rust CryptoRuntime remains the sole signer and the
independent Gateway verifier/OPA path is unchanged.

`TrustedAuthorityOnlyChildIssuer` offers owner-only
`privateMcpTransport:"native-stdio"` when its `rust-native` port implements
`issueChildViaPrivateMcp`; the default continues to be in-process. Journal
reservation, immutable Task permission checks, native result validation,
replay tombstones and fail-closed behavior are retained. The old `"stdio"`
choice remains the ACK-only R381.2 proof and MUST NOT be described as
server-side signing.

The free offline test `test/owner-private-native-crypto-stdio.test.ts` uses a
disposable Unix socket to prove that the native IPC request and response
traverse the MCP subprocess, including one-shot, no root tools, shutdown,
malformed reply and sanitized errors. The R292 native Rust/EVM harness has
a separate explicit `R3813_NATIVE_MCP_SIGNING=1` opt-in for both Child and
VP, but **this does not attest a native green run until that exact mode has
been executed and independently checked on the same SHA**. Production
launcher opt-in, real end-to-end Rust/EVM proof, and A/B/C architecture
closure remain distinct gates. Do not enable this transport for untrusted
clients; the role-scoped native bearer is a privileged secret inside the
isolated MCP process, and must never enter a model prompt or diagnostic log.

## R381.4 — original ADK/A2A Agent presentation port

The trusted A2A host can now opt in to the private native Rust MCP signing
service for Gateway-bound presentations (Backend, Frontend and Test):
`DELEGATION_PRIVATE_NATIVE_MCP_SIGNING=1` is accepted ONLY in
`authority-only` architecture with ADK and a private original Rust socket.
The default remains unchanged. The selector belongs to the authenticated
host, not an A2A Task, model prompt, FunctionTool or Agent Card.
`DelegationEvidenceHandler` uses the prebound Child credential ID,
Gateway challenge and exact required permission, creates a new owner-private
stdio MCP session, and receives the signed VP from the **same original Rust
CryptoRuntime**. It never retries through direct IPC or legacy Adapter HTTP
if MCP fails or returns malformed results. The task-local in-process MCP
bridge can continue consuming the same handler via its original private
Task registry. No second signer or public cryptographic MCP listener exists.

Free tests in `native-crypto-ipc.test.ts` and `mcp-tool-flags.test.ts`
cover the actual Agent presenter socket request, VP result, no HTTP fallback,
sanitized failure, invalid mode/legacy launch rejection, and missing native
socket. The A2A production host remains opt-out by default, and these
unit tests do **not** certify full native A2A/Gitea/Docker execution or
autonomous Gemini coding. The combined same-SHA CI gate remains mandatory.

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
