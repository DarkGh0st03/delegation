# Manual Gemini full E2E — three ADK roles through one shared MCP (13 October 2026)

## Purpose and current readiness

This run is the **only billed Gemini test** intended for manual launch by the thesis owner. It is a separate action from all free scripted smoke tests and from an actual privileged human-authorized merge. The first execution, [run 38363401514](https://github.com/DarkGh0st03/delegation/actions/runs/38363401514) on `a59819e...`, failed in the Backend at the third model call (120-second inference timeout), after eight successful reads and no writes. Commit `c7af6ca...` includes the correction to 300 seconds per call for each role. **Successful live acceptance remains pending**; do not treat the scripted evidence as a live-model result.

Workflow: `.github/workflows/gemini-paid-shared-mcp-final.yml`  
Program: `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`

The program reuses the established **AccountSuspensionSequentialCoordinator**, DelegatedA2ARoleRunner, real A2A endpoints for Backend/Frontend/Test, one shared Streamable HTTP MCP endpoint, real Rust Delegation Adapter, Gateway and OPA policies, the immutable IAM Console baseline, disposable loopback-only Gitea, real Docker Runner and independent researcher acceptance, then an independent second Docker-backed trusted CI status publication. The three models are live Gemini; the Orchestrator is intentionally deterministic and does not need an additional billed model.

### Existing free evidence (not a prediction of live success)

- Isolated real Docker positive Security CI: passed.
- Three ADK roles with scripted output, shared MCP, real Gitea/Gateway/Rust/OPA: passed.
- Full 11-file scripted role workflow with actual Docker tests and researcher acceptance: passed.
- Trusted independent CI publishes pending then success on the exact commit: passed.
- Without human approval, merge readiness denies. A separate test with **synthetic** approval permits a protected merge only inside disposable Gitea: passed.

These scripted results do **not** establish that real Gemini will generate correct code. The live workflow may fail or run up model usage charges. A passing result is required before describing the generative path as validated.

## What the live model must accomplish

Backend must update the four delegated shared/backend paths, Frontend must update the three delegated frontend paths, and Test must update three existing test files, create the permitted Playwright E2E spec, and call `run_tests`. Each agent receives the role's established ADK system prompt, path-scoped tools and bounded delegation; no precomputed reference source is fed to the model. After the Test Agent runs all six project stages and independent acceptance, the coordinator opens the PR. Then an isolated trusted CI service reruns the full Docker-based check and posts status `pending → success` for the exact Gitea feature HEAD. Trusted CI and human review are merge requirements, not prerequisites for opening that PR.

Passing produces an open PR in **temporary job-local Gitea only**. No genuine human review or merge is performed. The Gitea instance and its repositories are destroyed during teardown.

## Billing safeguards

The workflow contains **only** `workflow_dispatch` (no automatic push/schedule trigger), requires the operator to enter exactly:

```text
I AUTHORIZE GEMINI API CHARGES
```

The application separately requires `GITHUB_ACTIONS=true`, `GITHUB_EVENT_NAME=workflow_dispatch`, `GITHUB_RUN_ATTEMPT=1`, GitHub repository `DarkGh0st03/delegation`, an allowed feature/main branch and the same confirmation. A rerun is rejected, as are unconfirmed or automatic jobs. The Gemini API key is provided **only to the live inference step**, not to Rust/bootstrap/unit-test steps. The full run uses Gemini Developer API explicitly, without a billable OpenAI fallback. Inference is capped by bounded turns and per-call timeout, but **no fixed maximum charge can be guaranteed** because model token consumption varies. There are no automated retries of the paid job.

Currently staged defaults: `gemini-3.8-flash`, thinking `LOW`, `maxOutputTokens=32000` per model inference and `maxModelTurns=40` per specialized role and `maxModelCallMs=300000` per inference. Confirm API access, quota and the correct available model name independently before dispatch.

## Preflight and first manual invocation

1. Confirm that the latest **free** `Protected Merge Offline Security Regression` and scripted shared-MCP real-Docker regressions are green.
2. The workflow and timeout correction are already on the GitHub default branch, `main`. Select the reviewed current `main` revision after its free checks pass and record the exact SHA before dispatch. No additional feature-branch promotion is required for the checkpoint documented here.
3. Verify the GitHub repository secret `Delegation_Thesis_Gemini` is present without displaying its contents. Ensure the model ID is accepted by the API and sufficient quota is available.
4. **Only the thesis owner**, when ready to incur charges, manually selects *Actions → Gemini Paid - Shared MCP Full E2E (Manual Only) → Run workflow*, chooses the appropriate reviewed ref/model, and types the exact billing confirmation. Do not manually dispatch all the free regression workflows.
5. Wait for the run. Review the final JSON status, exact revisions, real Docker phases, acceptance, trusted CI and open PR checks. Do not mark partial or failed runs PASS.
6. Download the artifact `gemini-shared-mcp-evidence-<run_id>` from that paid Action. The artifact contains role-generated source under `files/` and a sanitized `manifest.json` with completed roles, SHAs and test status. It may be partial if the run fails. The code may be sensitive to the thesis project; store it only in the intended repository's Actions artifacts.

The secret is never printed by the workflow. The artifact code is checked against known actual credentials before writing. Do **not** upload prompt histories, model request bodies, authentication headers, DC/VP objects or environment files.

## Post-run evaluation

A green scripted run is not a substitute for code review. Even a green real-model run must be inspected for code quality, security, edge cases and adherence to the delegated scope before incorporation into a lasting repository. Generated files live in an ephemeral Gitea clone and will need a **separately reviewed** import process if they are to be preserved in persistent code. Do not treat the ephemeral PR as a production PR or as a genuine human approval. No privileged merge will occur automatically.

If the live run fails, stop: do not launch repeated billed attempts without the thesis owner's new explicit authorization. Use the saved partial artifact and logs to diagnose, correct only offline code or orchestration problems, then run the free regressions again.
