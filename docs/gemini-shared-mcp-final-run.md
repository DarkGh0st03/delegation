# Manual Gemini full E2E — three ADK roles through one shared MCP (updated 15 October 2026)

## Purpose and verified result

**LATEST LIVE GEMINI E2E PASSED** on [run #5 / 38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415), exact source SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673`, 15 October 2026 (first attempt). The single-disposable-Gitea correction is included at this tested framework SHA. Three native Google ADK Gemini roles completed 11 delegated Account Suspension files, six real Docker phases, independent researcher acceptance and trusted exact-SHA Security CI. The disposable Gitea PR was created but correctly blocked without human approval. [Exact latest run metadata and GitHub artifact digest](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-15.md).

The earlier 13 October [successful run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436), framework SHA `9012c8c4e7a9244cb931bcdef411cc5f443f0c08`, remains a distinct historical result with [original artifact evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md); its separate generated-code security review must not be applied automatically to the 15 October generated files.

The initial [run 38363401514](https://github.com/DarkGh0st03/delegation/actions/runs/38363401514) had failed during Backend inference; it is superseded by the later successful runs, not erased from experiment history. Do not automatically rerun this paid experiment: its success is already established and further billing requires renewed owner authorization.

Workflow: `.github/workflows/gemini-paid-shared-mcp-final.yml`  
Program: `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`

The program reuses the established **AccountSuspensionSequentialCoordinator**, DelegatedA2ARoleRunner, real A2A endpoints for Backend/Frontend/Test, one shared Streamable HTTP MCP endpoint, real Rust Delegation Adapter, Gateway and OPA policies, the immutable IAM Console baseline, disposable loopback-only Gitea, real Docker Runner and independent researcher acceptance, then an independent second Docker-backed trusted CI status publication. The three models are live Gemini; the Orchestrator is intentionally deterministic and does not need an additional billed model.

### Independent free evidence (distinct from the successful live run)

- Isolated real Docker positive Security CI: passed.
- Three ADK roles with scripted output, shared MCP, real Gitea/Gateway/Rust/OPA: passed.
- Full 11-file scripted role workflow with actual Docker tests and researcher acceptance: passed.
- Trusted independent CI publishes pending then success on the exact commit: passed.
- Without human approval, merge readiness denies. A separate test with **synthetic** approval permits a protected merge only inside disposable Gitea: passed.

These scripted results alone did **not** establish that real Gemini would generate correct code. The later successful live run established the bounded generative path for this single task. It remains non-production evidence, and additional paid experiments are not routine regressions.

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

## Historical manual invocation procedure (do not routinely repeat)

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
