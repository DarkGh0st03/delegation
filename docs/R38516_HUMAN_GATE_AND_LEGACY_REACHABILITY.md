# R385.16 — Human Gate & legacy reachability (read-only)

**Source SHA:** `cb7edf175c82e4b93b33e836faeabcf48cade199`
**Date:** 2026-11-08
**Evidence:** [Fast CI #42473310606](https://github.com/DarkGh0st03/delegation/actions/runs/42473310606) — **SUCCESS (2/2 jobs)**, including the offline Docker failure-evidence regression. The logs report `R38516_STATIC_GATE_PASS`, `HUMAN_GATE_STATIC_OK`, `BOUNDARY_PROVENANCE_OK`, zero issues, and **6/6 new R385.16 tests PASS**.

## Human authorization boundary

The [manual workflow](../.github/workflows/human-approved-gitea-merge.yml) is `workflow_dispatch`-only and gates `refs/heads/main`, the configured operator, the rerun actor and `protected-gitea-merge` environment. The privileged [CLI](../poc/packages/orchestrator-runtime/scripts/human-merge.mjs) must be invoked with exactly `--execute` under GitHub Actions; it validates the PR number, exact 40-digit head and operator confirmation **before** loading tokens. The [merge executor](../poc/packages/orchestrator-runtime/src/trusted-merge.ts) validates review, CI, branch protection and operator identity, revalidates the same evidence, then submits a head-pinned Gitea request without force, deferred execution or automatic branch deletion.

**Static proof only:** no workflow was dispatched for a merge, no merge token was loaded, no Gitea write was performed by this audit. The actual GitHub Environment required-reviewer settings, protected main configuration, external runners and future remote deployment are **not verified** by source inspection. A green R385.16 does not authorize a real merge.

## Exact cleanup inventory

The automated read-only audit uses the existing R6 parsed static/dynamic/configured reference scanner and the exact R385.4 signed-DAG provenance rules; **it is not a general dead-code detector**.

| Source path | Disposition |
| --- | --- |
| `poc/mcp-shared/src/owner-private-crypto-stdio.ts` | **RETAIN** — private cryptographic MCP |
| `poc/mcp-shared/src/owner-private-crypto-stdio-server.mjs` | **RETAIN** — private stdio server |
| `poc/mcp-shared/src/owner-private-native-crypto-stdio.mjs` | **RETAIN** — native transport |
| `poc/mcp-shared/src/owner-private-child-mcp.ts` | **RETAIN** — signed Child/MCP |
| `poc/packages/orchestrator-runtime/src/trusted-reviewed-approved-dag.ts` | Review historical gated callers |
| `poc/packages/orchestrator-runtime/src/trusted-operational-repair-planner.ts` | Review historical gated callers |
| `poc/packages/orchestrator-runtime/src/trusted-repair-dag-controller.ts` | Review historical gated callers |
| `poc/packages/orchestrator-runtime/src/authority-client.ts` | Review remaining original/legacy dependencies |
| `poc/packages/orchestrator-runtime/src/authority-adapter-transport.ts` | Review HTTP Adapter dependencies |

Additional workflow migration candidates observed:

- `.github/workflows/phase11-security.yml` still permits `main` push experiments building the **legacy HTTP Adapter**. This is not evidence that the authority-only launcher uses it; nonetheless the workflow must be classified or migrated before claiming all legacy execution entrypoints are gone.
- `.github/workflows/isolated-positive-security-ci.yml` targets the historical `feat/shared-mcp-spike` push branch (plus manual dispatch), rather than the active authority-only branch. Do not treat its existence as a post-cleanup green Security CI gate.
- The old paid Shared MCP workflow stays retired; **do not re-enable or execute it** as part of cleanup.

**Outstanding uncertainties:** the scanner reported **117 unresolved runtime indirections** repository-wide. It cannot prove computed imports, generated code, external launchers or deployments do not reference a candidate. In particular **zero observed importers never imply deletion approval**.

## Gates before selective physical deletion

1. Enumerate static and literal dynamic importer paths, configuration commands, workflow triggers, package scripts and external owner launchers for **each** candidate; classify canonical vs historical vs disposable CI vs external/unknown.
2. Remove or migrate an executable historical workflow only after confirming its regression coverage is retained elsewhere. Never delete the private MCP crypto/stdio code based on the package name `mcp-shared`.
3. Run existing R385.4 closure tests, the new R385.16 Human Gate tests, Fast CI, native Rust/EVM/OPA/Gitea/MCP/A2A E2E and Docker FAIL→PASS on a **single post-cleanup SHA**, with original Root/Child limits and independent Draft PR attestation.
4. Verify GitHub environment reviewers and protected merge configuration through the authorized administrator before human merge readiness is considered complete. A real merge still requires the explicit human action; it is **never** a CI cleanup step.
5. A Gemini generative pilot remains **unapproved** until the separate explicit budget consent and required gates.

**Files executed by R385.16 CI:** `poc/scripts/r38516-human-gate-and-legacy-reachability.mjs`, `poc/scripts/test/r38516-human-gate-and-legacy-reachability.test.mjs`, plus mock-only `manual-merge-intent.test.ts`, `merge-readiness.test.ts` and `trusted-merge.test.ts`. None executes a privileged merge or provider inference.
