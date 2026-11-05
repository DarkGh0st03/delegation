# R320 — owner-pinned per-Task effect binding for ADK/A2A

## Security change
The R317 `trustedEffectStager` injected a shared, potentially reusable
one-shot port into every ADK A2A Task on a host. R320 retires that global
handler configuration. A trusted owner may instead create and populate
`TrustedEffectStagingTaskRegistry` **before** A2A dispatch with immutable
Task/role/Child DID/credential, feature branch, tool and exact file pins.
No Task or effect registration route is exposed over A2A, Gateway HTTP,
MCP, CLI environment variables or model FunctionTools.

The A2A handler calls `selectFor(context)` before starting ADK. An
unbound, forged, mismatched or replayed Task fails before the model or
a Gateway tool can be invoked. A partially matching forged Task consumes
its slot; the owner must separately reconcile any suspicious outcome.
Each successful selection receives a private one-use `stage(request_id)`
port that delegates to the owner's existing stager, which independently
resolves the original PreparedRequestRecord and checks authority. The
selected slot is retired on task completion/failure/cancellation and
all slots are fenced during A2A host shutdown.

The signed A2A metadata is only an **untrusted candidate** for matching
the owner's prebinding. The registry is not a delegated-authorization
decision: Rust VP/EVM status, OPA, Gateway, and durable provider intent
remain mandatory. The ordinary standalone ADK CLI is intentionally
unable to invent a registry from environment configuration; explicit
`DELEGATION_GATEWAY_ARCHITECTURE=authority-only` with no trusted
registry fails startup. A real **remote** owner→agent authenticated IPC
binding is still required for process-separated deployment.

## Validation
Free offline Node tests cover positive/negative per-Task selection,
credential/DID/branch/plan mismatches, duplicate Child IDs, one-shot
effects, cross-Task isolation and retirement. No paid LLM, native
Rust/EVM or Docker runs are claimed by these tests.
The in-flight native R318 checkpoint remains isolated; R320 does not
restart Docker or change the checkpoint.
