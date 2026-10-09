# Phase 3 — ADK behind the existing protected A2A 1.0 server

Implementation: `adk-a2a-handler.ts` + `server.ts` + `adk-specialized-agents.ts`.

- The existing `@a2a-js/sdk@1.3.0` server, Agent Cards, required
  `urn:thesis:a2a:delegated-authorization:v1` extension and message metadata
  continue unchanged.
- `startSpecializedAgentServer({adk:{...}})` opts into the ADK engine.
  An absent `adk` preserves the old deterministic/custom handler path.
  Supplying both `adk` and `taskHandler` is rejected.
- Every A2A request receives a **new ADK Runner and in-memory Session**.
  Its input contains only `task_id`, `role` and `subtask`, never the
  delegation credential, signed VP, Adapter token, nor internal service keys.
- The server keeps the evidence in `AgentTaskContext`, constructs
  `DelegationEvidenceHandler` and `GatewayControlledToolClient` server-side,
  and creates a `LlmAgent` using the Phase 2 role-specific factory.
- ADK FunctionTool calls invoke `ControlledToolRegistry`, which delegates to
  `Gateway prepare -> Adapter signed VP -> Gateway execute -> Rust verifier ->
  OPA -> provider`. This order remains authoritative; prompts cannot grant rights.
- Repository commit SHAs, changed-file lists and Runner test verdicts in the
  Artifact are constructed only from Gateway-confirmed tool results. Model prose
  cannot invent commits, tests, permissions or authorization outcomes.
- Controlled failures and missing confirmed repository revision fail the A2A
  task, without emitting an authorized completed Artifact.
- `maxModelTurns` (default 8) is a server-controlled fail-closed bound.
- Existing runtime, Orchestrator, and experimental baseline are unchanged.

**Validation:** CI calls real in-process A2A HTTP+JSON server/client and real
ADK `LlmAgent`/`Runner`, with a scripted LLM and mocked Gateway/Adapter
HTTP responses (no service keys or real model calls). This proves protocol
wiring and fail-closed handling, **not** a live Gitea E2E.

**Remaining for Phase 4/5:** production OpenAI-to-ADK `BaseLlm` adapter,
agent process bootstrap/configuration, LLM audit and token budget parity,
live service orchestration, regression E2E, measurements. Do not switch the
default controller until these pass.
