# Current integration checkpoint — 13 October 2026

## Scope and architecture

Reference scripted architecture commit: `c7af6ca0a6b0254e3b9966e7631325ab1e540be5`. Verified full live Gemini framework commit: `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` on `main`.

The contribution is the integration of delegated authorization with interoperable agent execution. The cryptographic delegation foundation is reused; the experiment is a bounded software-engineering workflow, not a general autonomous developer.

The canonical coordinator is deterministic TypeScript: Backend → Frontend → Test. Each specialized role uses native Google ADK and receives a protected A2A task. Their four MCP tool types share one Streamable HTTP service; role/task-specific runtime state retains the Gateway client and authority. Rust verifies delegated authority, then OPA evaluates execution policy before provider access. Permission attenuation is exact resource/operation subset matching, not directory inheritance.

The Test role runs the exact-SHA Docker pipeline and researcher-owned acceptance. The coordinator then opens a PR. A separate trusted CI actor reruns the Docker pipeline and publishes status for that exact SHA. The final readiness check denies merge without a genuine human review. The canonical live test never creates a review or merges; its Gitea instance is disposable.

## Verified evidence at the reference commit

| Workflow | Run | Result and scope |
| --- | --- | --- |
| PoC Baseline Validation | [38365626238](https://github.com/DarkGh0st03/delegation/actions/runs/38365626238) | 22/22 jobs passed; original PoC regression |
| Phase 11 Security Experiments | [38365626239](https://github.com/DarkGh0st03/delegation/actions/runs/38365626239) | Passed; functional security regression |
| Shared MCP Production Coordinator | [38365626323](https://github.com/DarkGh0st03/delegation/actions/runs/38365626323) | Passed; scripted model, stubbed Runner |
| Shared MCP Real Docker Acceptance | [38365626204](https://github.com/DarkGh0st03/delegation/actions/runs/38365626204) | Passed; scripted model, actual Docker and independent acceptance |
| Phase 12 Reproducibility | [38365626286](https://github.com/DarkGh0st03/delegation/actions/runs/38365626286) | Failed because the old measured manifest was applied to changed dependencies; addressed by a separate current contract |

The real-Docker scripted run completed the 11-file scope (Backend 4, Frontend 3, Test 3 updates + 1 creation), six project phases and researcher acceptance. Trusted CI published pending then success under a separate identity; no approval was created and the merge was denied with `human_approval_missing`. Gitea main remained unchanged.

## Live Gemini result — PASS (13 October 2026)

[Manual paid run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) on `main` at `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` completed successfully. Backend, Frontend and Test were real Gemini roles under Google ADK/A2A, using one shared MCP service and Gateway/Rust/OPA. All 11 files, interface preflight, six Docker acceptance phases, researcher acceptance and independent trusted Security CI passed. The separate CI identity posted exact feature SHA `pending → success`.

The coordinator opened PR #1 only in temporary Gitea at feature SHA `3306f08aa57ebfe9635842e61b3a3c2a768e1ee7`. No reviewer was impersonated, and no merge took place. Readiness correctly denied `human_approval_missing`. This result establishes the bounded live-generative E2E path, not production security certification or a measured performance campaign.

[Detailed, artifact-hashed evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md) includes the original ZIP checksum and expiry (27 October 2026). The earlier [failed live run 38363401514](https://github.com/DarkGh0st03/delegation/actions/runs/38363401514) remains part of experiment history, and cannot override the later successful run.

## Reproducibility separation

- Historical measurements: `cbadb5440db408d4047d4eb870a9fb231362414a`, original `poc/experiments/reproducibility-manifest.json`, unchanged.
- Current dependency/runtime checks: `poc/experiments/adk-mcp-reproducibility-manifest.json`, separate schema and no historical measurement claims.
- New runtime reports identify the actual checked-out framework SHA. Successful contract validation does not prove generative correctness or measure authorization latency.

See [REPRODUCIBILITY.md](REPRODUCIBILITY.md).

## GitHub administration still required

GitHub API inspection at this checkpoint reported `main.protected=false` and an empty repository ruleset list. The available GitHub connector cannot modify administrative branch-protection settings. This is separate from the protected Gitea main exercised by the experiment.

Proposed development-repository rule for `main`:

- Require pull requests, passing checks and an up-to-date branch.
- Require the unconditional check contexts `validate` (PoC Baseline Validation) and `phase12b-reproducibility-contract` (Phase 12 Reproducibility Contract), selecting their GitHub Actions identities after they have completed. Do not make a path-filtered workflow an unconditional required check.
- Block force pushes and branch deletion, including administrator bypass where supported.
- Decide the independent reviewer requirement according to available collaborators; requiring one other person's approval blocks a sole maintainer from merging their own PR. GitHub development review is distinct from the mandatory human Gitea review in the thesis workflow.

This is a configuration proposal, **not a claim that protection has been enabled**. The persistent human-approved Gitea merge workflow also needs its documented environment/reviewer/identity setup; merely committing YAML does not configure those controls.

## Remaining sequence

1. Preserve the original run artifact independently before its advertised 27 October 2026 expiration; retain checksum and SHA mapping.
2. Complete a structured quality/security review of the generated 11 files before any optional *separately reviewed* persistent import.
3. Update thesis results with explicit evidence separation: historical measured baseline, scripted shared-MCP validations, and genuine live-Gemini result.
4. Review GitHub branch protection and any persistent Gitea reviewer/environment/CI setup as separate administrative deployment work. A passing disposable run does not configure these.
5. Any further paid model experiment requires a new explicit decision by the thesis owner. Routine free CI remains automatic.
