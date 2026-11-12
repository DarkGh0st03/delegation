# ADR — ADK 2.2.1: native A2A interop vs. trusted signed-DAG dispatcher

**Date:** 2026-10-28. **Decision status:** spike only, no architecture replacement and no Gemini API charges.

## Current code, not legacy main

The 15-page handoff describes the older `adk-orchestrator.ts` with `run_account_suspension_workflow`, but on feature branch `refactor/post-prof-plan-contracts-20261021` that file is absent. The feature branch already has:
- `trusted-adk-planner.ts`: real ADK `LlmAgent`, bounded read-only `FunctionTool` discovery, signed-plan **proposal** (never approval).
- `trusted-approved-a2a-dispatcher.ts`: authenticated, immutable Engineer-approved DAG, independently scoped Task children, protected A2A dispatch and trusted completion.
- Separate Gateway / Core Rust / OPA and provider effect verification.

Therefore **do not reintroduce the old hardcoded orchestrator or rewrite the active one from scratch**.

## Pinned Google ADK source verification

Both packages pin `@google/adk@2.2.1`. The upstream **adk-v2.2.1** source (commit `1c220db`) exports `RemoteA2AAgent`; its configuration has `agentCard`, `client`, `clientFactory`, `beforeRequestCallbacks`, `afterRequestCallbacks` and `metadata`. It translates ADK session history into A2A requests. Its callbacks are extension points but **do not implement signed Engineer authority**.

ADK `LlmAgent` supports `outputSchema`/`outputKey`. In v2.2.1, `outputSchema` disables agent-transfer paths when subagents are configured. Tool-driven discovery and dynamic subagent transfer should therefore be tested separately, not casually combined with one output-schema setting.

Official source:
- https://github.com/google/adk-js/blob/adk-v2.2.1/core/src/a2a/a2a_remote_agent.ts
- https://github.com/google/adk-js/blob/adk-v2.2.1/core/src/agents/llm_agent.ts
- https://github.com/google/adk-js/releases/tag/adk-v2.2.1

## Evaluation: candidate A vs. candidate B

| Requirement | Current FunctionTool + signed dispatcher | RemoteA2AAgent alone |
| --- | --- | --- |
| Dynamic Planner and ADK sessions | Already integrated | Available |
| Trusted prebound Task ID before any A2A send | Implemented | Custom integration needed |
| Authenticated Engineer-approved plan digest | Implemented | Not supplied |
| Per-Task child DC and VP with private keys | Implemented | Not supplied |
| Resource URI + Rust Operation + OPA | Gateway / Core Rust | Not supplied |
| Minimized A2A task context | Explicit trusted projection | ADK forwards session-derived context; needs scrutiny |
| Gateway provider effect and artifact corroboration | Implemented | ADK event conversion is not sufficient |
| Protected A2A transport helpers | Custom | Possible simplification |

**Interim decision:** retain existing dispatcher as trusted boundary. Evaluate `RemoteA2AAgent` ONLY as a replaceable transport/conversation adapter after an offline proof that preserves each invariant. Merely adding the remote agents as `subAgents` is not a safe replacement for signed DAG dispatch.

## Approval semantics to resolve deliberately

The handoff suggests an execution plan generated after the Engineer authorizes a permission set; the current code signs the **task graph, agent assignment, resources, and permitted operation rows together**. They are different authority models.

Preserve the latter unless there is an explicit design decision and updated threat model. Scheduling independent nodes and bounded technical retries do not require approval changes; new Task IDs, resources, role assignment or permission expansion do.

## Spike gates, offline and no billed model

1. Import actual ADK 2.2.1 `RemoteA2AAgent`, `LlmAgent` and `FunctionTool` in a test; do not upgrade dependencies.
2. In a fake-client ADK Runner invocation, reject an A2A request from an unbound native session via a pre-request callback **before** the fake remote transport is called.
3. Show that native metadata/subagent transfer alone cannot demonstrate a signed plan, credential or authenticated artifact.
4. Compare an isolated successful A2A exchange later to existing signed dispatcher for context minimization, task IDs, scoped child credentials, retries, streaming and evidence verification.
5. Build the Engineer GUI mock early in CI as requested in the PDF; do not defer it until local runtime migration.
6. Keep acceptance requirements of Account Suspension in scenario fixtures. General plan and permission contracts remain scenario independent.

The tests are only an ADK API/security-boundary probe; passing them does **not** prove end-to-end replacement safety. Next decision is based on verified CI and observed differences, not ADK feature marketing.

**No changes to `main`, no model API calls, no auto-merge.**
