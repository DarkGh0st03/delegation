# Delegation — implementation state (authority-only)

**Updated:** 9 November 2026. This is the current architecture; the historical 15 October shared-MCP PoC is explicitly separated in [README](../README.md).

**Current verified HEAD — R458:** `b3652cc01eccc2a150b1b44d52f16430163cf6c7` on `refactor/post-prof-plan-contracts-20261021` (Draft PR #38). The [R458 native fourth-role test](https://github.com/DarkGh0st03/delegation/actions/runs/42628486939) and [Fast CI](https://github.com/DarkGh0st03/delegation/actions/runs/42628486999) succeeded. R458 demonstrates a separately owner-pinned, read-only scripted `reviewer` with live A2A/HMAC, native Rust Child DC/VP, OPA, Gitea read and independent Gateway completion. **The canonical Gemini manifest still admits exactly Backend, Frontend and Test; `reviewer` is test-only.** The single continuous manifest-to-scripted-Planner-to-bootstrap-to-provider proof and same-SHA complete native Security CI have **not** yet been verified.

**R459 verified:** [Free scripted Planner-to-reviewer A2A #42637168243](https://github.com/DarkGh0st03/delegation/actions/runs/42637168243) SUCCESS on SHA `c847f961`. The model is deterministic/offline; Task selection is checked against the trusted four-role *test* registry, followed by live HTTP A2A, private per-role Unix HMAC and fixture-based owner/Gateway completion. Negative tests reject an unprovisioned role, write escalation, invented dependency and Task replay. The canonical Gemini configuration still contains exactly Backend/Frontend/Test. **Do not conflate R459 fixture completion with R458 native Rust/EVM/OPA/Gitea evidence; their union is not yet a single physical end-to-end proof.**

**Legacy audit (read-only, after R458):** the three Owner DAG/repair cores are not safe to delete by file name alone. `trusted-owner-reviewed-dag-execution.ts` is dynamically imported by `trusted-admitted-github-handoff.ts`, `trusted-admitted-scripted-handoff.ts`, and `trusted-fresh-repair-reviewed-dag.ts`; `trusted-owner-repair-planning-core.ts` and `trusted-owner-repair-dag-execution.ts` are dynamically imported by `trusted-owner-operational-repair-handoff.ts`. R408/R409/R411 migration regressions explicitly require these active Owner cores while keeping the obsolete wrappers absent. Consequently, this targeted final cleanup retains all three cores rather than deleting required security functions. Unresolved computed/external consumers remain unproven. No paid Gemini run or merge is authorized.

**R402 verified:** [Fast CI #42506638774](https://github.com/DarkGh0st03/delegation/actions/runs/42506638774) SUCCESS on SHA `5a7f88cc`. The conservative audit observed 4,692 source/configuration edges, 226 unresolved indirections, 5 guarded legacy modules and 4 protected private MCP components. No runtime source was authorized for deletion. R403 classifies historical documents separately, with explicit safeguards.

## Implemented and tested

| Layer | Implementation | Evidence and remaining limit |
| --- | --- | --- |
| Rust crypto and authorization | Engineer root issuance/revocation directly in Rust; Gateway verifies DC/VP directly in Rust, with OPA | Native E2E successful; legacy HTTP never canonical |
| Approval and trust boundary | Engineer signs immutable permissions; preliminary read-only Root is revoked before operational Root | Task DAG is dynamic and **not** the signed authority |
| Planning and execution | ADK planner/decision proposer, bounded read-first recovery, dynamic trusted Agent Card registry R401, A2A Backend/Frontend/Test | Scripted end-to-end PASS; extra Planner roles need separately provisioned A2A/signer; **real Gemini autonomy not yet proven** |
| AgentCards / FunctionTools | Role-checked startup and signed grant visibility; R387/R388 Test `create_file` and R395 Test `run_tests` through independent signed Child | The canonical PoC still provisions Backend/Frontend/Test; R401 makes Planner role/skill selection registry-derived but does not deploy a new specialist |
| Task cryptography | Task-local private/stdin-stdout MCP for Child DC and VP | **Retain** `poc/mcp-shared/src/owner-private-*`; no shared HTTP MCP as canonical route |
| Provider execution | Gitea real pinned reads / atomic HEAD CAS, controlled Docker Runner, researcher-owned acceptance | Tests are pinned to actual revisions and receipts |
| PR and security | R399.2 links separate Security CI status to the **same native Draft PR HEAD**; Human Gate denies its Draft status | Disposable Gitea and scripted model; real GitHub branch protection/reviewers remain externally unverified |
| Human merge | `workflow_dispatch` with independent operator and approval verification | Live GitHub Environment reviewers and Gitea admin protection are not proven by offline tests |
| Legacy retirement | R432 removes the historical HTTP Engineer issuer, its private MCP/HTTP fixture and opt-in gate; the three obsolete signed-DAG wrappers were already retired | The genuine Owner DAG/recovery implementations remain active. Indirect/external callers are not exhaustively proven absent; protect source-level anti-regression guards |
| SDK A2A trusted roster (R435) | Original Owner now checks exact specialist endpoint and private stage/bind keys and requires the same full set of independently verified live Cards before ADK decisions | Additional roles cannot run until the underlying SDK role runtime, signer and owner-private bindings are implemented; native Rust/OPA/Gateway remain unchanged |
| Additional A2A Card verification (R436) | Read-only startup probe can verify an extra role against Owner-supplied DID/name/skill/capability ceiling, with distinct loopback URL and no unsafe Test powers | Optional verifier is not yet wired into executable SDK; additional workers need private per-role signer/IPC binding and native E2E |
| Owner-private IPC and native A2A (R458) | Added owner-pinned synthetic `reviewer` worker, distinct per-role HMAC, native Rust-issued Child DC/VP, Gateway/OPA and genuine Gitea read E2E; original SDK transport and independently witnessed completion | Free scripted read-only proof is SUCCESS; a continuous scripted Planner-to-bootstrap E2E and same-SHA native Security CI are still outstanding. No fourth Gemini specialist |

## Validated regression snapshots

- **R432.2 Engineer HTTP retirement and type-decoupling:** 1,119 tracked files; historical HTTP issuer, port and gate physically absent, nine type-only imports moved to `trusted-credential-contracts.ts`. [Fast CI #42575458875](https://github.com/DarkGh0st03/delegation/actions/runs/42575458875) SUCCESS on SHA `595a50b9`. A same-SHA full native Security CI result is **not claimed** here. R433 adds automatic native CI triggers for these credential, Child and A2A surfaces. PR #38 remains Draft; no paid Gemini or merge.
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
