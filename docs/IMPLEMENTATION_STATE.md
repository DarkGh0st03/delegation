# Delegation — implementation state (authority-only)

**Updated:** 8 November 2026. This is the current architecture; the historical 15 October shared-MCP PoC is explicitly separated in [README](../README.md).

## Implemented and tested

| Layer | Implementation | Evidence and remaining limit |
| --- | --- | --- |
| Rust crypto and authorization | Engineer root issuance/revocation directly in Rust; Gateway verifies DC/VP directly in Rust, with OPA | Native E2E successful; legacy HTTP never canonical |
| Approval and trust boundary | Engineer signs immutable permissions; preliminary read-only Root is revoked before operational Root | Task DAG is dynamic and **not** the signed authority |
| Planning and execution | ADK planner/decision proposer, bounded read-first recovery, A2A Backend/Frontend/Test | Scripted end-to-end PASS; **real Gemini autonomy not yet proven** |
| AgentCards / FunctionTools | Role-checked startup and signed grant visibility | Native Test Agent currently cannot `create_file`; implementing signed test-only create remains open |
| Task cryptography | Task-local private/stdin-stdout MCP for Child DC and VP | **Retain** `poc/mcp-shared/src/owner-private-*`; no shared HTTP MCP as canonical route |
| Provider execution | Gitea real pinned reads / atomic HEAD CAS, controlled Docker Runner, researcher-owned acceptance | Tests are pinned to actual revisions and receipts |
| PR and security | Disposable Gitea Draft PR from verified PASS, separate Security CI | Separate jobs do not yet prove status on the **same PR** |
| Human merge | `workflow_dispatch` with independent operator and approval verification | Live GitHub Environment reviewers and Gitea admin protection are not proven by offline tests |
| Legacy isolation | HTTP Engineer fixture exact opt-in, denied in authority-only; legacy DAG/workflows pinned and under review | Runtime caller inventory still has unknown/indirect references |

## Validated regression snapshots

- **Full positive native chain + historical Runner regression:** [Security CI #42477209043](https://github.com/DarkGh0st03/delegation/actions/runs/42477209043), 2/2 SUCCESS, plus [Fast CI #42477209047](https://github.com/DarkGh0st03/delegation/actions/runs/42477209047), 2/2 SUCCESS; identical SHA `bbb60fa09d88b0f2949a5c6452f340aedbc33f54`.
- **Engineer HTTP fail-closed change:** [R385.19 native full run #42478904754](https://github.com/DarkGh0st03/delegation/actions/runs/42478904754) SUCCESS and [Fast CI #42478904760](https://github.com/DarkGh0st03/delegation/actions/runs/42478904760) SUCCESS; exact SHA `8bf19fd59e042b7e4f189f9a543aa8933a169680`.
- **Cleanup of milestone reports:** 69 Markdown reports deleted, [Fast CI #42479660224](https://github.com/DarkGh0st03/delegation/actions/runs/42479660224) SUCCESS on `c97bf3ef`.
- **Follow-on workflow/checkpoint cleanup:** 7 historical positive workflows and 7 trigger JSONs removed, with all their source test scripts retained. [Fast CI #42480100756](https://github.com/DarkGh0st03/delegation/actions/runs/42480100756) SUCCESS on `b3b42eb3`. Full same-SHA native CI after all cleanup is the next integration gate.

## Direct pointers

- [Active roadmap and ordered remaining work](ACTIVE_AUTHORITY_ONLY_ROADMAP.md).
- [Architecture decision history (with supersession notice)](ARCHITECTURE_DECISIONS.md).
- [Human Gate / static reachability audit](R38516_HUMAN_GATE_AND_LEGACY_REACHABILITY.md).
- [Workflow migration / caller inventory](R38517_WORKFLOW_AND_CALLER_MIGRATION.md).
- [Native Security CI integration / caller pinning](R38518_NATIVE_SECURITY_CI_AND_LEGACY_CALLER_GATES.md).
- [Reproducibility](REPRODUCIBILITY.md).

The cleanup does not rewrite Git history. The 15 October Gemini PoC evidence is historical, **not** a current certified or autonomously generative system. No paid-model inference or automatic merge is allowed in the cleanup workflow.
