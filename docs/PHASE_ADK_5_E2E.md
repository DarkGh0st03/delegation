# Phase 5: Google ADK with real EVM/Gitea/OPA infrastructure

## Status and experimental boundary

The frozen Phase 10B baseline remains unchanged as the default execution
(`PHASE10B_AGENT_ENGINE=legacy`). Historical Phase 10B/12 measurements are
**not ADK measurements** and must never be relabeled.

A dedicated Phase 5 workflow now executes the same Account Suspension task
with a real ADK `LlmAgent` + `Runner` behind the existing protected A2A
transport. It uses a *scripted* `BaseLlm` to plan deterministic, sequential
single-tool requests (no real external model call), and it actually exercises:

- Transitive Delegation Credentials and EVM-backed Rust verification.
- A2A custom delegated-authorization metadata and per-task authority.
- Gateway prepare -> Adapter VP -> Gateway execute -> OPA authorization.
- Protected Gitea `feature/account-suspension` file operations and commits.
- Controlled Test Runner, project tests plus independent acceptance tests,
  verified on the exact SHA.
- Pull request creation against the unchanged protected `main` baseline.

The model has **no direct Gitea credentials, arbitrary shell, JWT signing
keys, raw DC/VP in its prompt, or bypass around Gateway**. The branch PR
remains unmerged. This test is an ADK *infrastructure E2E*, but **not a live
OpenAI inference test** and not an autonomous code-writing quality metric.

## Execution

`.github/workflows/adk-phase5-e2e.yml` runs on changes to the Phase 5
fixture or the workflow; it can also be launched manually with:

- `adk-scripted` (default): keyless, repeatable validation of real security
  components and A2A/Gitea path.
- `adk-openai`: optional live provider experiment, requires repository
  secret `OPENAI_API_KEY` and valid configured `OPENAI_MODEL`. No secret is
  hardcoded. Model autonomy may yield differing edits and failures; do not
  treat that experiment as passing until GitHub Actions confirms success.

The long-running Test Agent has a separate, configurable Gateway timeout
(`TEST_RUNNER_TIMEOUT_MS`), preserving security checks without making
the actual acceptance run fail after the shorter ordinary file-tool timeout.

## GitHub Actions notification controls

- Expensive `PoC Baseline Validation` is triggered on main, PR, or manual
  dispatch, not every `refactor/adk-integration` commit; full baseline
  remains mandatory before promotion.
- Phase 2/3 workflows trigger on PR/manual, since Phase 4 runs their same
  regression tests for feature changes.
- Phase 4 is the single fast push smoke for Agent/Orchestrator packages.
- Phase 5 full E2E triggers on fixture/workflow changes or manual dispatch.
- Concurrency cancels superseded runs within a workflow. This reduces
  redundant traffic; it never turns a failed check into a success.

Do not merge to `main` until the relevant full regression, negative
authorization tests and ADK E2E have passed and results are frozen.
