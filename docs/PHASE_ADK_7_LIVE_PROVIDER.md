# Phase 7 — Google ADK / OpenAI real-provider readiness

Status: **unit/integration CI pending** at the time of authoring. Previous
Phase 6 keyless, protected E2E is already green. This phase adds
security-scoped live model configuration, but does not claim a real
OpenAI API request was run.

## Security boundaries

The existing `OpenAIAdkModel` now declares an explicit, constructor-scoped
`allowedToolNames` whitelist:

- Default specialized agents: `read_file`, `update_file`, `create_file`,
  `run_tests` only.
- ADK Orchestrator: **only** `run_account_suspension_workflow`. This option
  is supplied explicitly by its bootstrap. It cannot be mixed with the
  specialized tool list, and arbitrary function names are rejected.

The true authorization boundary is still the Rust Delegation Verifier plus
Cloud Access Gateway and OPA. The model can never request arbitrary
permissions, skip the deterministic Backend / Frontend / Test sequence or
merge a Pull Request.

Some numeric schema constraints produced by Google ADK's Zod converter
are not sent to the OpenAI strict function-schema dialect. The complete
Zod `FunctionTool` still validates its arguments **at tool invocation**,
and the existing role-specific Gateway / DC / OPA checks continue to
enforce branch, path and operation permissions.

## Optional paid live-provider smoke, no real repository access

`.github/workflows/adk-openai-live-smoke.yml` has
**`workflow_dispatch` only**: no push, PR or timer triggers it.
This prevents accidental paid requests and CI notification storms.

It requires a repository Actions secret called `OPENAI_API_KEY` and an
explicitly selected API-accessible model. The repository's original model
string `gpt-5.6-sol` is the default reference, not a guarantee that any
given API account can access it.

The smoke runs a real OpenAI API call via ADK `LlmAgent` and
`OpenAIAdkModel`, with a single **in-memory, read-only** `read_file`
fixture; it has no Gateway connection, Gitea token, DC/VP, file-system write,
merge operation or arbitrary shell. It fails closed unless the actual model
invokes the one permitted read tool exactly once. The script caps provider
turns at three, the response at 1536 generated tokens per turn and prints
only a sanitized success record.

The smoke is an API interoperability / model tool-use test. It **does not**
prove that a live model can implement Account Suspension or pass acceptance
testing.

## Optional live full workflow

The existing `ADK Phase 5 - Protected E2E` workflow remains keyless by
default. Only a **manual** `workflow_dispatch` selecting
`engine: adk-openai` uses OpenAI in Backend, Frontend, Test and the
Orchestrator; it also requires `OPENAI_API_KEY`. All actual Git changes
are confined to the ephemeral CI Gitea deployment; GitHub `main` and Gitea
`main` remain unchanged. The same exact-SHA test gate and explicit
non-merge guarantee are enforced, and a real model's code may fail these
acceptance tests. That outcome is a valid experimental failure and must
not be hidden or represented as a successful E2E.

## Checkpoints before shipping

1. Phase 7 mock-provider tests and previous ADK/Orchestrator regression green.
2. Manually run the read-only real-provider smoke with an authorized API key.
3. Evaluate the optional full live workflow, collecting sanitized logs.
4. Later, add MCP as a narrow transport over the Rust Adapter (no new
   authorization source), followed by human-approved, one-shot merge.
5. Re-run complete baseline and freeze new experiment measurements only once
   final behavior is stable.
