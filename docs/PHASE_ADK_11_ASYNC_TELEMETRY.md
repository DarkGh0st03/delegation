# Phase ADK 11 — Nonblocking A2A, safe lifecycle and timing

## Why
The real Gemini Backend-only run 37971388496 made ten model requests,
then the single blocking `sendMessage(returnImmediately:false)` HTTP call
failed with `UND_ERR_HEADERS_TIMEOUT`. This is **not** evidence that
Gemini quota was exhausted or that the model was inherently unable to
write code. The old Phase 12C baseline measured scripted tool execution,
not real LLM inference.

## Transport changes
`DeterministicA2AOrchestrator.sendProtectedTask` keeps the public
`{card,task}` contract but uses native SDK 1.3.0 nonblocking A2A:
`returnImmediately:true`, followed by `getTask({id,historyLength:0})`
with bounded backoff. A task must be `COMPLETED` to return; FAILED,
CANCELED, REJECTED, INPUT_REQUIRED and AUTH_REQUIRED all fail closed.
The default hard deadline is twelve minutes, **not a performance target**;
deadline attempts best-effort cancellation and reports failure.
The polling requests send only the task ID, never DC or VP.

## Lifecycle and private evidence
The executor publishes SUBMITTED/WORKING, and on expected errors a
sanitized FAILED status, without exposing raw model/provider exceptions.
Explicit cancellation uses an AbortController per task, propagates the
signal into ADK Runner and Gateway/Adapter HTTP operations, and prevents
late successful Artifact publication. Abort of an already dispatched
remote write is best-effort; it cannot mathematically roll back a write
already accepted by Gitea. The exact-SHA acceptance gate still applies.

The SDK's ResultManager implicitly inserts the inbound A2A Message in
Task.history. That Message has DC evidence in metadata. The dedicated
PrivateEvidenceTaskStore strips all persistent history and status
messages so subsequent getTask/listTasks cannot disclose bearer
materials. The initial client also requests historyLength zero. A second,
public-response boundary (PrivateEvidenceRequestHandler) enforces zero
history on the initial sendMessage response regardless of a caller's
historyLength preference, and also on getTask. Streaming/resubscription
is explicitly disabled, consistently with the Agent Card. This prevents
external clients from asking for the original authority-bearing Message.
The raw inbound Message is used transiently by the protocol, while
the DC needed by the agent remains in the private task-context store.

## Numeric observability
The ADK wrapper emits `adk_llm_timing` with role, turn, call latency and
provider token counts when available; `adk_tool_timing` with tool
name/status/latency; `adk_role_timing` with role total; and
`a2a_timing` with overall wall time, HTTP submission time, cumulative polling HTTP time and poll count. Wall time includes waiting for remote work and MUST NOT be called pure network overhead. Diagnostics contain
no file content, prompts, authority evidence, signing keys or API
credentials. Existing Gateway Phase 12C historical metrics remain
separate from these NEW measurements.

## Validation rules
- No real-provider API calls are needed for deterministic transport tests.
- Slow simulated A2A task must return COMPLETE and a single Artifact.
- Failed task must persist FAILED without raw exception details.
- Deadline must cancel and suppress late artifacts.
- Stored Task history must never contain DC evidence.
- Existing ADK runtime and protected scripted E2E must remain green.
- The GitHub workflow triggered by a push runs scripted ADK only;
  Gemini/OpenAI live E2E remains explicit workflow_dispatch only.
- Keep main at its frozen SHA; work on refactor/adk-integration only.

Next actual Gemini checkpoint: **one** Backend-only attempt after
deterministic regressions, followed by performance diagnostics.
Do not increase turn limits, enable cloud billing, implement MCP
or automate a merge to address this transport issue.

## Deterministic result (10 October 2026)
- Native ADK regression: https://github.com/DarkGh0st03/delegation/actions/runs/38034952658 — SUCCESS.
- Protected EVM full scripted ADK:
  https://github.com/DarkGh0st03/delegation/actions/runs/38034952655 — SUCCESS.
- State `pr_created`, three roles completed, project tests PASS,
  researcher acceptance PASS, main unchanged, no auto-merge.
- All above use scripted model turns; these results do NOT constitute
  a successful real Gemini Account Suspension implementation.
