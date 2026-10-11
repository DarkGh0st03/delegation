# Phase ADK 12 — Gemini Backend inference diagnosis and conservative guardrails

## What the last live test actually proved

Evidence: https://github.com/DarkGh0st03/delegation/actions/runs/38035728675

- A2A asynchronous transport stayed alive through the whole Backend task:
  94 polling requests and only ~142 ms cumulative polling HTTP time.
- Backend: 10 calls to the real Gemini API, eight successful read_file
  calls, one unsuccessful read_file, zero confirmed writes.
- The first nine model requests were reported with about 5-15 seconds each;
  the final model call took 183,220 ms and ended with sanitized category
  `api_service_unavailable`. The task failed correctly without an Artifact.
- The token context grew (promptTokenCount 557 on turn 1 and 4,811 on turn 9).
- **Important unknown:** the former telemetry did not record whether reads
  touched distinct files. Eight successful reads could be the eight listed
  Backend writable/read-only context files, NOT eight repeated reads of the
  same file. Do not assert Gemini was stuck in an identical-file loop.
- The last failed call does not prove a paid tier issue, quota exhaustion
  or an objectively worse model. Its exact provider-side root cause
  remains unverified.

## Changes

1. `AdkToolProgress` counts successful reads, distinct paths, duplicate
   reads, failed reads, writes and write failures **without exposing any
   path**, file contents or user/delegation tokens to telemetry.
2. Specialized-agent instructions clarify that permitted file lists are
   guidance, not a mandatory read checklist, that already-retrieved
   content should be reused, and that update_file **replaces the complete
   file** (not a diff). No changes to capability templates, tool
   allowlists, Gateway/OPA authorization or the exact-SHA PR gate.
3. `BoundedModel` now imposes a separate per-provider-call deadline,
   default 60 seconds and bounded by 1-120 seconds. Google ADK Gemini
   forwards AbortSignal to the Google GenAI client. Exceeding the limit
   fails closed with `api_inference_timeout`, not a silent retry or paid
   provider fallback. The overall A2A deadline remains separately
   enforced.
4. Both successful role telemetry and sanitized error diagnostics
   include the new aggregate counters; future runs can establish
   whether reads repeat and whether a write ever occurs.

## Test strategy

- Deterministic unit tests for distinct vs duplicate reads, safe metrics,
  read/modify prompt invariants and abort behavior of a simulated
  3-second unresponsive model with a 1-second call deadline.
- The existing ADK phase 4 regression and protected phase 5 scripted E2E
  must stay green; they do **not** make calls to real Gemini.
- Do not reactivate the one-shot Gemini trigger in this change. The
  next live checkpoint should require explicit agreement after seeing
  deterministic green CI. Use only the existing Free Tier project,
  bounded model calls, no paid fallback and one Backend run, never full
  E2E before a valid backend commit.

## Interpretation

This hardening does not make Gemini generate correct code by itself.
It prevents multi-minute stalls and provides enough non-sensitive data
to decide if prompt context, tool-use planning, provider performance or
model selection should change. Comparing pre-ADK scripted measurements
directly to real inference times would be methodologically invalid.

## CI validation (10 October 2026)

Code commit: `5641f14eee070c8822cd9d779e6cfbaa0dd80eeb`

- ADK runtime regression:
  https://github.com/DarkGh0st03/delegation/actions/runs/38036620854
  **SUCCESS** — 52/52 Agent Runtime tests; the model-call timeout,
  private progress counters and safe prompt rules are among those tests.
- Protected EVM + Gateway + OPA + Rust + Gitea full scripted ADK:
  https://github.com/DarkGh0st03/delegation/actions/runs/38036620847
  **SUCCESS** — `pr_created`, Backend/Frontend/Test completed,
  project tests `pass`, researcher acceptance `pass`,
  `main_unchanged:true`, `automatic_merge:false`.
- No real Gemini request was issued by these CI regressions. Native ADK
  provider performance and correct real-LLM implementation remain
  open questions; the next step is one specifically authorized,
  bounded Backend-only live run.
