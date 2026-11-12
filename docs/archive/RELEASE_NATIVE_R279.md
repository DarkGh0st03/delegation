# R279 — Native Engineer post-F1 free release checkpoint

**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**Date:** 2026-11-04  
**Candidate parent:** `f7bb80281215ecd2763a316ef936fba38c935892` (R278)  
**Candidate:** the single new R279 commit that changes the three free checkpoint JSONs and this document. Each GitHub Actions run must independently report its exact `head_sha` equals the committed R279 SHA.

## Why this release checkpoint is now eligible

R278 proved the no-AI real-Gitea F1 Planning-only path on the direct Engineer native Rust owner after pinning its EVM DID publisher/resolver scripts to the checkout root:

- Fast CI R278: **completed/success**, https://github.com/DarkGh0st03/delegation/actions/runs/41919029553
- F1 Real Gitea Planning-only R278: **completed/success**, https://github.com/DarkGh0st03/delegation/actions/runs/41919029715
- F1 structured receipt: `f1_real_gitea_planning_only_verified`, `status: pass`, `gemini_calls: 0`, `approval_created: false`, `pr_created: false`. Its Gitea source SHA is the disposable fixture revision, **not** the repository release commit.

F1 deliberately stops **before** Engineer approval. It does not test a signed operational DAG, a repaired D1 Task or live Gemini inference. This final free checkpoint covers the first two using scripted ADK and independently exercises real Rust/EVM/Gitea/Docker.

## Verified R279 results — all four successful

The same R279 commit `75bb066df63fd2fe3c2106699427171418fd4867`
was independently verified by all four required GitHub Actions:

- Fast CI: **SUCCESS** — https://github.com/DarkGh0st03/delegation/actions/runs/41921999098
- Direct Engineer native Rust EVM / VP: **SUCCESS** — https://github.com/DarkGh0st03/delegation/actions/runs/41921999157
- Signed Gitea/Docker DAG: **SUCCESS** — https://github.com/DarkGh0st03/delegation/actions/runs/41921999104
- Signed Gitea/Docker recovery D1: **SUCCESS** — https://github.com/DarkGh0st03/delegation/actions/runs/41921999063

This closes the R279 **scripted/native architecture** checkpoint, without
claiming any real Gemini agent success. A subsequent R280 patch to the
manual-only paid workflow pins the trusted Rust DID publisher and resolver
paths in *both* manual jobs, matching the successful no-AI F1 R278 proof.
The paid manual gate requires another free exact-SHA verification after that
workflow change; no paid execution is authorized by this document.

## Exact-SHA independent free release gate

| Required workflow | Checkpoint trigger | Status |
| --- | --- | --- |
| Fast CI — Development (`fast-ci.yml`) | Automatic on every branch push | Await R279 exact-SHA completion |
| Engineer Direct Rust Core — EVM VP (`engineer-direct-native-evm-e2e.yml`) | `.github/ci-checkpoints/engineer-evm-request.json` | Await R279 exact-SHA completion |
| Engineer Embedded Rust — Signed Gitea Docker DAG (`engineer-embedded-signed-dag-e2e.yml`) | `.github/ci-checkpoints/engineer-full-dag-request.json` | Await R279 exact-SHA completion |
| Engineer Embedded Rust — Signed D1 Recovery (`engineer-embedded-signed-d1-e2e.yml`) | `.github/ci-checkpoints/engineer-d1-request.json` | Await R279 exact-SHA completion |

The three marker edits share **one** R279 commit so that independent, parallel workflows prove the same checked-out code. Do not mark this gate as closed until **all four** runs finish `completed/success` on that SHA. Previous R270 4/4 SUCCESS is historical evidence, not substitute evidence for R279.

## Target architecture and security invariants

- **Software Engineer:** trusted host calls the embedded Rust `CryptoRuntime` through a fixed Node-API module, in-process for root issue/revoke. No socket/MCP/HTTP hop between Engineer and its Rust library for those operations.
- **Orchestrator and Backend/Frontend/Test:** signed Task/role-scoped local cryptographic MCP, authenticated native delegate socket to **that one** Engineer Rust runtime for Child DC and VP only; no separate root authority.
- **Gateway:** independent public-only native Core Rust verification of EVM DID/status/VP + deterministic OPA authorization; no signing-key capability. Actual repository and Docker Runner effects are authorized through direct Gateway FunctionTools, not Shared MCP.
- **Planner/DAG/recovery:** immutable Ed25519 approval, root attenuation, limited Task authorizations, independent Docker tests, D1 repair within signed permissions and unmerged review PR.
- **Legacy:** Rust `delegation-adapter` library is the shared cryptographic implementation required by the native addon. Its **HTTP executable** is explicitly opt-in with Cargo `legacy-http` for old tests; canonical workflow never starts it.

## Closure limits

A successful R279 scripted E2E proves the production-shaped architecture and tested security gates, **not** the general reasoning ability of real LLM agents. No human Engineer approval was exercised by the signed test fixture. A billed Gemini multi-agent positive/recovery run has **not** been authorized and must never be dispatched automatically.

No merge to `main`, root grant escalation, new scenario, new paid workflow or automatic rerun is part of this checkpoint. If a test fails, inspect the failed phase and stop; fix on a later SHA, then decide if another exact-SHA gate is justified.
