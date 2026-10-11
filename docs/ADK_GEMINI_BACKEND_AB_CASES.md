# Gemini Backend: manual A/B/C inference diagnosis

Status: offline regression required before any new live calls. **No live Gemini calls are triggered by pushes.** This experiment does not replace the full delegated-authorization E2E.

## Motivation

The isolated Gemini ADK `adk-function` smoke previously passed once, while Backend-shaped requests have produced structured HTTP 503 errors or a 60-second inference timeout. This does not establish that tool count or prompt size *causes* the provider errors. We compare request shapes under the same explicit Gemini Developer API model, same API secret, one upstream model request per manual run, and the same generation configuration:

- Model: `GEMINI_MODEL` (default `gemini-3.8-flash`)
- `maxOutputTokens: 1024`; `temperature: 0`
- No Vertex AI, OpenAI, paid-provider fallback, automatic reruns, chained real model calls, or repository writes

## Cases

| Case | Prompt / task | Declared ADK functions | What it compares |
| --- | --- | --- | --- |
| A (`backend-a`) | Short, explicit synthetic read task | `read_file` | Single Backend-style tool baseline |
| B (`backend-b`) | **Identical** short prompt and user task as A | `read_file`, `update_file` | Isolates addition of the second declared tool (A versus B) |
| C (`backend-c`; legacy `backend-shape`) | Full Backend instruction and structured Account Suspension task | Same two functions as B | Combined effect of longer system instruction **and** more detailed task input (B versus C) |

A intentionally uses the *Backend's* `read_file` schema, not the distinct hardcoded schema from the successful historic `adk-function` script. Thus A, B, and C share the same Backend tool definition, making the A/B comparison more controlled; success on the old smoke is not a same-time control.

The actual FunctionTool wrappers are created with `createAdkSpecializedAgent`; for A and B, only the available tools and instruction are changed. No workflow may select multiple cases per run.

## Safety contract

The probe runs with a synthetic in-memory controlled tool client. One `read_file` is allowed for an allowlisted fixture path. Every `update_file` is rejected without performing I/O. There is no Gitea, Gateway, Rust Adapter, credential material, filesystem mutation, or external repository access. The ADK model wrapper delegates only its **first** model turn to Gemini; an optional next ADK turn is completed locally and does not invoke the provider.

Log only: `probe_case`/case ID, numeric request-shape counts, classified error code, first-turn model/tool counters, and pass/fail labels. Never print prompts, file contents, tool arguments, credential data, or raw upstream error text.

## Running and interpreting

1. Confirm offline CI passes on `refactor/adk-integration`.
2. Expose the **manual-only** `backend-a`, `backend-b` and `backend-c` choices in the default-branch workflow menu only with explicit approval. Do not merge application changes to `main`.
3. For each independent, user-approved live run: GitHub Actions → **ADK Gemini Native Live Smoke** → select `refactor/adk-integration` and **one** `backend-a`, `backend-b` or `backend-c` mode. Do not loop automatically.
4. Compare timestamps, HTTP status/category, first model-call duration, declared-tool count and prompt-shape metrics. A passed request and a later 503 do not prove deterministic incompatibility; provider availability can vary over time.

The standard `adk-function` smoke remains unchanged for historical comparisons.
