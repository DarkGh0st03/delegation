# Deterministic A2A Agent

Phase 7 launcher for the Backend, Frontend and Test Agent services.

The same process is configured with `AGENT_ROLE=backend|frontend|test` and a
dedicated `AGENT_PORT`. It exposes:

- `/.well-known/agent-card.json`;
- A2A HTTP+JSON v1.0 under `/a2a/rest`.

The service uses the shared `@thesis/agent-runtime`. Phase 7 is deliberately
non-LLM: it validates discovery, extension negotiation, Message -> Task ->
Artifact semantics and internal Delegation Evidence handling before Phase 8
adds model-driven reasoning.

## Explicit shared MCP tool opt-ins

The ADK launcher only turns on shared MCP when
`ADK_MCP_SHARED_URL` and task signing keys are supplied. With no tool flags
set, **only `read_file` uses MCP**, preserving existing FunctionTools for
other operations. The following environment variables are strict
`true`/`false` values (default: false), independent of one another:

- `ADK_MCP_UPDATE_FILE=true` — Backend, Frontend or Test with their existing
  separate role- and task-bound write permissions (Gateway/OPA still decide).
- `ADK_MCP_CREATE_FILE=true` — **Test Agent only**, exact allowed E2E file.
- `ADK_MCP_RUN_TESTS=true` — **Test Agent only**, predefined Runner profile.

Any flag enabled without `AGENT_RUNTIME_ENGINE=adk` or shared MCP URL fails
startup. Enabling create/test for Backend or Frontend fails startup. Other
values (e.g. `1` or `yes`) also fail startup rather than silently altering
the authorization boundary. The shared MCP listener remains one server for
all roles; individual Agent workers retain private task registries.

Offline regressions: `npm --prefix poc run test -w @thesis/a2a-agent`.
**Note:** the real positive researcher acceptance cannot pass until the
Account Suspension feature is fully implemented in the isolated test branch.
The existing real Runner negative smoke validates failure propagation only.
