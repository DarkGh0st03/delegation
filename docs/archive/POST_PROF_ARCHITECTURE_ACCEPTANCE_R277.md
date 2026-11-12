# Delegation — post-professor architecture acceptance register (R277)

**Date:** 2026-11-04  
**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**Inspected source baseline:** R276 `1fe6e3ed6667127bc060aea40293aa0b721505a5`  
**Reference completed release checkpoint:** R270 `7cd438b43d0ddcce42fae92af6a9a8c4e4ae3b1e`

> **R279 status update (2026-11-04):** R278 zero-billing real-Gitea F1 is
> **SUCCESS** on SHA `f7bb80281215ecd2763a316ef936fba38c935892`: [run #41919029715](https://github.com/DarkGh0st03/delegation/actions/runs/41919029715).
> Fast CI on that SHA also passed ([#41919029553](https://github.com/DarkGh0st03/delegation/actions/runs/41919029553)).
> The R276 failure and R277 draft details below are retained as historical
> observations; see [RELEASE_NATIVE_R279.md](RELEASE_NATIVE_R279.md) for
> current release readiness. Free EVM, signed DAG, D1 and Fast CI must pass
> on the single **R279** SHA before this checkpoint is closed.
>
> This register supersedes the *status* (not the historical audit trail) in
> `post-prof-migration-audit-2026-11-03.md` and
> `REPOSITORY_CLEANUP_R229.md`. Earlier headers describe R197–R229
> source states and must not be interpreted as the current architecture.

## Professor's binding constraints and current implementation

| Obligation | Canonical implementation | Evidence and remaining qualification |
| --- | --- | --- |
| Software Engineer calls Rust **directly** for root DC issue/revoke, without an intermediate HTTP, socket, or MCP hop | `poc/packages/orchestrator-runtime/src/trusted-engineer-direct-core-port.ts` calls the fixed `delegation-engineer.node` Node-API addon from the trusted host. `services/delegation-engineer-node` embeds a single Rust `CryptoRuntime`. | R270 native EVM and signed DAG/D1 green; this claim is for **canonical native mode**, not separately selected historical fixtures. |
| Orchestrator and A2A Backend/Frontend/Test use one strictly scoped private crypto service | `local-crypto-mcp-bridge.ts` uses an in-memory MCP SDK session with `private-mcp-task-registry.ts` and authenticated `native-crypto-ipc.ts` for one-shot Task-bound VP. Trusted Child DC issuance goes through a scoped private port backed by the **same** Engineer-owned Rust runtime. | No model-facing root issuance, key access, general tool router, or independent Rust signer is in this path. |
| Gateway directly verifies with independent public-only Rust and OPA | `poc/apps/gateway/src/direct-core-loader.ts`, `runtime.ts`, signed plan and EVM status checking. Gateway does **not** own an issuing key. | Independent EVM/VP and real Gitea/Docker DAG proofs were green on R270. |
| The Shared MCP repository router, private HTTP worker, and intermediate crypto HTTP routes are retired | Shared MCP `src/main.ts` was removed and its npm `start` entry retired. R262–R264 removed `trusted-crypto-mcp-bridge.ts`, `private-mcp-worker-http.ts`, `mcp-shared/src/http-server.ts` and `crypto-worker-router.ts`, with new native/no-route regressions. | Fast CI covers canonical MCP boundaries; old sources must not be restored to fix a historical fixture. |
| Planner creates immutable reviewed signed DAG and agents execute only approved Tasks | `trusted-adk-planner.ts`, Ed25519 plan/approval store, `trusted-approved-child-issuer.ts`, Task- and branch-bound Gateway FunctionTools and OPA. Generic approved specialized profiles apply to Backend, Frontend and Test; Account Suspension files are scenario fixtures. | R270 positive signed DAG and D1 scripted recovery both green, with real disposable Gitea/Docker and unmerged PR. This **does not prove autonomous Gemini coding or repair**. |
| Historical Adapter HTTP is not reachable in the canonical signed run | R271 made `tiny_http` optional and the `delegation-adapter` binary conditional on Cargo feature `legacy-http`. The reusable Rust library remains mandatory to the direct addon. | R273 Rust Multipermission and Fast CI succeeded. Explicit historical CI opts into `legacy-http`; physical deletion of legacy executable is a separate compatibility migration, **not** deletion of the `CryptoRuntime` crate. |
| Billed Gemini workflow uses the same native owner | R267–R269 rewired manual Gemini infrastructure to direct Engineer Rust and exact-SHA four-free-CI gate, with fresh, separate billing consent. | No paid pilot or autonomous model end-to-end success is established; manual dispatch remains prohibited absent explicit user approval. |
| F1 zero-billing real-Gitea planning uses the same Engineer owner | R276 switched `f1-real-gitea-planning-parity.yml` to the Engineer Node-API + public-only Gateway verifier and forbids an Adapter HTTP process. | R276 Fast CI succeeded, but free F1 run `41913348534` FAILED during the isolated planning subprocess. The parent saw no validated native-phase receipt, so its cause is not established. R277 adds a pre-import diagnostic wrapper (offline-only); its full integration has not yet been verified. |

## Exact completed evidence

**R270, SHA `7cd438b43d0ddcce42fae92af6a9a8c4e4ae3b1e`: 4/4 same-SHA free runs completed/success.**

1. Fast CI — https://github.com/DarkGh0st03/delegation/actions/runs/41899589208
2. Engineer native EVM and VP — https://github.com/DarkGh0st03/delegation/actions/runs/41899589155
3. Engineer signed real Gitea/Docker DAG — https://github.com/DarkGh0st03/delegation/actions/runs/41899589143
4. Engineer signed recovery D1 — https://github.com/DarkGh0st03/delegation/actions/runs/41899589296

**Post-R270 confirmations (not a replacement for a same-SHA full gate):**

- R273 Fast CI and Rust Multipermission succeeded on
  `ab0f4b24714a71afb3770e210ee07be20809746f`: 
  https://github.com/DarkGh0st03/delegation/actions/runs/41909505562 and
  https://github.com/DarkGh0st03/delegation/actions/runs/41909505754
- R276 Fast CI succeeded on
  `1fe6e3ed6667127bc060aea40293aa0b721505a5`:
  https://github.com/DarkGh0st03/delegation/actions/runs/41913348483
- R276 real-Gitea F1 free run (**FAILURE**, phase not yet classified):
  https://github.com/DarkGh0st03/delegation/actions/runs/41913348534

## Closure classification

**Architecture as implemented in the canonical scripted path:** passed R270.
**Legacy HTTP executable:** isolated and opt-in, not physically deleted.
**Zero-billing F1 on newly migrated native owner:** R276 failed, and R277 requires a fresh result. R277 instrumentation cannot be counted as a passing implementation proof.
**Latest code after R270:** no consolidated 4/4 same-SHA full gate yet.
**Autonomous Gemini signed DAG and D1:** not demonstrated or authorized.

The remaining sequence is (a) classify and resolve the F1 subprocess failure
using the bounded R277 pre-import receipt, without relaunching unrelated
costly suites; (b) freeze a candidate and run
exactly one free native four-workflow checkpoint on that single candidate SHA;
(c) update this register and audit after verified results; and (d) request
fresh user authorization before *any* billed Gemini invocation.

No `main` merge, automatic PR merge, real paid model call, or permission
expansion is authorized by this register.
