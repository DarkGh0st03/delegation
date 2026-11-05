# R322 — authenticated private ADK effect binding across processes

## Architecture
The actual agent entrypoint `poc/apps/a2a-agent/src/main.ts` now has
an explicit authority-only mode. It refuses deterministic runtime and
requires two distinct Unix control channels with owner-provisioned
independent 32-byte HMAC secrets in `0600` files under private `0700`
directories.

- **Owner → Agent binding**: authenticated private Unix socket registers
  one exact Task/Child/DID/role/branch/path/operation in the R320 registry.
  Its ACK is `task_prebound_not_authorized`, never permission to write.
- **Agent → Owner staging**: when an ADK FunctionTool receives a Gateway
  HTTP Prepare response, its privately scoped port sends ONLY its pinned
  runtime Task ID and the resulting request ID to the authenticated owner
  staging Unix socket. The owner still owns the original
  `TrustedAuthorityOnlyEffectStager`, Gateway request store,
  Task/HEAD pins, durable CAS/Runner journals, and Gateway Root/Child
  admission. No HEAD, provider credentials or DC material crosses this
  staging wire.
- Both channels authenticate method, route, timestamp, nonce and SHA-256
  of the canonical JSON body with domain-separated HMAC-SHA256.
  Invalid/replayed/stale requests are rejected with generic errors.
  Sockets are private, unique, chmod `0600`, and retired on shutdown.
- Unknown, repeated or ambiguously staged requests are terminal.
  There is no automatic retry following an uncertain owner stage result.

## How an authorized owner assembles it
The trusted Orchestrator owner creates a
`TrustedOwnerEffectStagingRegistry`, binds an already-validated one-shot
stager for the exact authorized runtime Task, and starts
`createTrustedOwnerEffectStagingServer`.
It creates two distinct secret files and provisions their paths to the
agent process. The agent starts an
`createTrustedEffectAgentBindingServer` before starting its A2A
listener. The owner uses `connectTrustedEffectAgentBindingClient`
to bind the exact Task only after signing the Engineer root and issuing
the properly attenuated Child DC; then dispatches A2A. On completion
or failure it fences both sides.

The stand-alone agent boot requires:
`DELEGATION_GATEWAY_ARCHITECTURE=authority-only`,
`AGENT_RUNTIME_ENGINE=adk`, and these path settings:
`ADK_OWNER_STAGE_SOCKET`, `ADK_OWNER_STAGE_SECRET_FILE`,
`ADK_PRIVATE_TASK_BIND_SOCKET`,
`ADK_PRIVATE_TASK_BIND_SECRET_FILE`.

Neither environment variables nor A2A metadata may supply Task/Child
grants, expected provider SHA or stager implementations. The IPC
transport is a carrier, not an authorization issuer.

## Limitations and remaining proof
The new offline tests exercise actual Unix sockets, separate HMAC keys,
a positive private one-shot staging request, spoofed-key rejection,
forged A2A Child rejection and remote retirement. Their owner ports
are intentionally fake; they DO NOT prove native Core Rust/EVM, OPA,
Gitea HEAD CAS, a live ADK model, or a distributed end-to-end pass.
The authenticated owner-side startup integration, proof of genuine A2A
caller provenance, root/Child revocation and D1 recovery still need
integration and negative testing. Do not claim the old signed-DAG
or Adapter is fully retired. Do not start paid inference or merge.
