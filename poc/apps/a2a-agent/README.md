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
