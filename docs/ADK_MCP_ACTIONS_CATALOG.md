# Current GitHub Actions map — ADK/A2A/shared MCP

These are the retained working workflows. Earlier provider probes, numbered ADK integration stages, artifact replay and the old measurement campaign are preserved in Git history, not run as current CI.

| Workflow | Why it is retained | Gemini API costs |
| --- | --- | --- |
| `poc-baseline.yml` | Unconditional free core, Adapter, contract and agent-runtime regression | No |
| `shared-mcp-production-coordinator.yml` | Three scripted ADK roles, A2A/MCP, protected Gitea and PR; stubbed Runner | No |
| `shared-mcp-real-positive-e2e.yml` | Scripted three-role flow with actual Docker, researcher acceptance and trusted CI | No |
| `disposable-simulated-approval-merge.yml` | Synthetic approval/merge **only inside disposable Gitea** | No |
| `isolated-positive-security-ci.yml` | Independent real Docker/CI positive regression | No |
| `merge-protection-offline.yml` | Offline billing-guard and protected merge readiness checks | No |
| `phase11-security.yml` | Current negative functional-security experiment suite | No |
| `phase12-reproducibility.yml` | Current ADK/MCP runtime/lockfile contract, preserves historical manifest distinction | No |
| `gemini-paid-shared-mcp-final.yml` | **Explicit manual-only paid Gemini** full E2E | **Yes** |
| `human-approved-gitea-merge.yml` | Separately privileged actual Gitea merge; authentic reviewer/env config required | No |

The **latest verified real-Gemini run** is [38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) (15 October 2026, tested framework SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673`, run #5 / first attempt). It confirms the single-disposable-Gitea workflow fix and passed all 11 delegated writes, six Docker phases, independent acceptance and trusted CI. The PR existed only in disposable Gitea; no genuine approval or merge took place. See [15 October evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-15.md). The previous [13 October run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) at `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` remains separately archived in [historical evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md).

The paid workflow has **no push or schedule trigger**. No agent may create a real review or merge. The human merge workflow is separate from free CI and is not automatically activated by keeping its YAML file in the repository.
