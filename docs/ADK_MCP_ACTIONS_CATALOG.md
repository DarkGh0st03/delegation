# Thesis ADK / A2A / Shared MCP — GitHub Actions map

The ADK/A2A/shared-MCP integration is merged into **main**. Scripted architecture checkpoint: `c7af6ca0a6b0254e3b9966e7631325ab1e540be5`. Verified live Gemini checkpoint: `9012c8c4e7a9244cb931bcdef411cc5f443f0c08`, [successful paid run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) (13 October 2026). See [live evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md); paid workflow must not be rerun automatically.

## Current actions

| Workflow | Trigger | Role and evidence | Charges Gemini API? |
| --- | --- | --- | --- |
| `merge-protection-offline.yml` | Automatic scoped push to feature/main and pull request; optional manual | Fast unit regressions, protected merge checks, validates billing guards, checks archival workflows are disabled | **No** |
| `shared-mcp-production-coordinator.yml` | Automatic push to feature/main on relevant code | Scripted ADK Backend/Frontend/Test, A2A, one shared MCP, real Rust/OPA/Gateway and disposable Gitea, deliberately stubbed Controlled Runner | **No** |
| `shared-mcp-real-positive-e2e.yml` | Automatic push to feature/main on relevant code | Scripted ADK output, **real Docker Runner** including independent acceptance, separate trusted Security CI, exact-SHA PR; without review the merge is denied | **No** |
| `isolated-positive-security-ci.yml` | As configured by the workflow | Independent disposable Gitea real Docker positive Security CI, real acceptance, trusted status | **No** |
| `disposable-simulated-approval-merge.yml` | Automatic scoped test | End-to-end authorization and merge against an **ephemeral** Gitea with explicitly **synthetic** reviewer; never a real human's approval | **No** |
| `gemini-paid-shared-mcp-final.yml` | **Manual `workflow_dispatch` only** | The only intended final live Gemini 3.8 Flash three-agent integration, real Docker Runner and trusted CI; no approval, no merge, job-local Gitea | **YES** — ONLY after explicit typed authorization |
| `human-approved-gitea-merge.yml` | **Manual `workflow_dispatch` only**, after administrative setup and human review | Privileged Gitea merge executor with exact SHA, authentic review, independently verified CI and protected environment | No Gemini calls, but **this performs an actual merge**, not a test |

The automatically triggered paths are deliberately scoped: editing the **billable Gemini script** starts the fast, free billing-safety check instead of always initiating two complete Docker E2E jobs. Changes in common authorization, shared MCP, Gateway, Rust or protected agent runtime still run the relevant independent full-stack regressions. Manual triggering of each free action is not part of the normal development process.

## Historical workflows (do not use for final thesis acceptance)

- `adk-phase5-e2e.yml`: an old `refactor/adk-integration` workflow retained as a **scripted-only historical regression**. Legacy billable provider modes and the former one-shot push marker are disabled, and no provider keys are handed to this workflow.
- `adk-gemini-live-smoke.yml` and `adk-openai-live-smoke.yml`: **ARCHIVED**, with their only jobs disabled. Their pre-retirement behavior and evidence remain in Git history.
- `adk-phase1-smoke.yml` through `adk-phase4-smoke.yml` and replay/measurement workflows retain earlier integration and original PoC coverage. Their results do not prove live-Gemini shared-MCP acceptance.
- `phase11-security.yml` still provides current functional security regression. `phase12-reproducibility.yml` now validates the separate current ADK/MCP contract on pull requests and main; the original measured manifest remains unchanged.

Do not remove or rewrite the old measured-baseline results to appear to describe the newer ADK + MCP implementation.

## Critical boundaries

1. **Offline scripted tests are not generative Gemini tests.** Their PASS is evidence for the architecture and enforcement, not for quality of AI-generated code.
2. **`main` on GitHub is not the same as protected `main` inside the disposable Gitea.** Check GitHub default-branch protection and review settings separately. At the time of this draft, the GitHub API reported `main.protected=false`. This is a rollout gap; it does not invalidate the Gitea protections verified in the E2E fixtures.
3. **No automatic paid inference.** The final Gemini workflow contains only `workflow_dispatch`, requires the full confirmation text, rejects job retries and delivers `GEMINI_API_KEY` only to the live inference step.
4. **No unattended human approval or persistent merge.** The simulated-review workflow is isolated and labeled as such. The actual merge workflow additionally requires an authenticated Gitea reviewer and a separately configured GitHub protected environment.
5. **No model key or credential in an Actions artifact.** The paid job stores only the generated source files after scanning for known secrets and a bounded evidence manifest. A failed run may leave incomplete evidence.
6. **Live-model success has exact provenance, not universal scope.** Run `38379922436` passed; this does not certify production code, genuine human merge approval or new latency measurements.

## References

- `docs/gemini-shared-mcp-final-run.md`: billing, model selection, preflight, evidence and review.
- `docs/human-approved-gitea-merge.md`: privileged manual merge controls and deployment prerequisites.
- `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs`: authoritative offline E2E with actual Docker acceptance.
- `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`: billable real Gemini integration; initial attempt `38363401514` failed before any write; run `38379922436` completed successfully after contract/preflight corrections.
