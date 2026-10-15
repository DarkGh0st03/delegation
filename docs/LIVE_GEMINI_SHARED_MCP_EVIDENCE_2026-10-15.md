# Live Gemini / ADK / A2A / shared MCP — verified 15 October 2026

**SUCCESS** — [GitHub Actions paid manual run #5 (ID 38761963415)](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415), first attempt, started 2026-10-15 15:37:27 UTC and completed approximately 15:44:32 UTC. This is the **latest authoritative tested framework checkpoint**, not a statement that every later `main` documentation commit is itself E2E-tested.

## Exact framework and configuration

- Repository: `DarkGh0st03/delegation`; ref: `main`; **framework commit: `02c3395b9111a63ccc9f441ea2c91c81865d6673`** ([commit](https://github.com/DarkGh0st03/delegation/commit/02c3395b9111a63ccc9f441ea2c91c81865d6673)).
- Manual-only GitHub Actions workflow: `.github/workflows/gemini-paid-shared-mcp-final.yml`; `workflow_dispatch`, run attempt 1, billed Gemini Developer API calls only in the model step.
- Model: `gemini-3.8-flash`; thinking level `LOW`; max output configured at 32,000 tokens per inference.
- Three real Google ADK roles: Backend, Frontend, Test. Deterministic `AccountSuspensionSequentialCoordinator`, A2A tasks, one shared Streamable HTTP MCP, task-scoped private workers, real Rust Delegation Adapter, Gateway, OPA, Anvil and an isolated Docker Runner.
- Account Suspension reference app `DarkGh0st03/iam-console-poc`, pinned baseline `405748b1e77992b6bd8630a3ab6f990658d32f6b`. The baseline is a fixture and was not merged over.
- This run followed [PR #12](https://github.com/DarkGh0st03/delegation/pull/12), which removed the redundant Compose Gitea bootstrap in isolated workflows. The paid workflow starts OPA/Anvil via Compose and uses **one job-local disposable Gitea** managed by the E2E program.

## Real agent work and Gitea revisions

| Agent | Successful MCP reads | Authorized writes | Completed model turns | Gitea revision after role |
| --- | ---: | ---: | ---: | --- |
| Backend | 8 | 4 | 10 | `2df8e0e6c5197595b5f4eec3dcca379e30c4840c` |
| Frontend | 5 | 3 | 9 | `8216738ee00587f8a89d3f4bfe251a0a50a271d1` |
| Test | 9 | 4 | 10 | `59af90790d7a94570d5bc272d47288b27812921c` |
| **Total** | **22** | **11** | **29** | **Feature HEAD: `59af90790d7a94570d5bc272d47288b27812921c`** |

No role reported failed read/write calls or duplicate reads. The 11 files are Backend 4, Frontend 3, Test 4 (three updated tests plus one new E2E test), all within delegated scopes. These revision SHAs belong to **temporary Gitea**, not to the framework's GitHub repository.

## Passed gates actually visible in job logs

- All workflow steps: `success`, including no-retry/manual-authorization check, dependencies, unit regressions, permission-scope check, OPA/Anvil/DID preparation, Rust Adapter build and startup.
- Backend/Frontend interface preflight: `PASS`, no failures.
- Real Docker project stages: `dependency_install`, `typecheck`, `backend_tests`, `frontend_tests`, `build`, `playwright_e2e` — all `pass`.
- Independent researcher-owned acceptance: `pass`.
- Trusted independent Docker Security CI: passed under a separate actor and published exact-SHA status `pending → success`.
- Temporary Gitea feature PR #1 created once; coordinator outcome `PR_CREATED_PENDING_HUMAN_APPROVAL`. Review not impersonated or synthesized; `merge_calls=0`, `merge_outcome=NOT_MERGED`, and readiness correctly denied `human_approval_missing`. Temporary Gitea `main` remained unchanged.
- Overall event: `a2a_shared_mcp_gemini_live_full_roles`, `status=PASS`, completed roles Backend/Frontend/Test.

## Gemini usage counters (not a billing invoice)

| Role | Model turns | Input tokens | Output tokens |
| --- | ---: | ---: | ---: |
| Backend | 10 | 75,530 | 2,325 |
| Frontend | 9 | 57,567 | 3,523 |
| Test | 10 | 127,960 | 4,910 |
| **Total** | **29** | **261,057** | **10,758** |

These numbers are the sums of `adk_llm_timing` records in the paid step's job log, **not** certified provider billing figures. Thinking tokens were not separately reported; no currency cost is asserted.

## Artifact identity and retention

GitHub published artifact `gemini-shared-mcp-evidence-38761963415`:

- Artifact ID: `11985464719`.
- ZIP size reported by GitHub: `10422` bytes.
- GitHub-reported ZIP SHA-256 digest: `5d188f51a7590f9b55883ba6641abfbefd91dc72a0e664a9571c7eca0b1516a7`.
- Expiry: **29 October 2026, 15:44:27 UTC** (14-day retention).
- Workflow upload log reports 12 files uploaded. As defined by the runner, the bundle should contain generated sources plus sanitized `manifest.json`; **the ZIP bytes were not independently downloaded and inspected during this documentation update**, so the GitHub digest and upload count are reported as GitHub evidence, not as a separately computed checksum or source-level review.

Save the original artifact before expiry if long-term research provenance is required; do not add ephemeral generated output into the immutable IAM baseline or mislabel it as framework source.

## Evidence boundaries and history

This is one successful bounded real-generative E2E demonstration at an exact commit, not production approval, repeatability statistics, a genuine human-approved merge or a new authorization-latency campaign. The 13 October [successful experiment](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md) at `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` remains a separate earlier datapoint. The [13 October generated-code security review](GENERATED_CODE_SECURITY_REVIEW_2026-10-13.md) applies **only to that run's generated files**, not to the newly generated 15 October artifact. The historical measured performance baseline remains `cbadb5440db408d4047d4eb870a9fb231362414a`.

No further paid Gemini calls were made to produce this document. Any additional paid run needs new explicit owner authorization.
