# R411 — Legacy wrapper and runtime caller closure, no deletion authorization

8 November 2026 · PR #38 Draft · branch `refactor/post-prof-plan-contracts-20261021`.

## Validated precondition

On **the same SHA `21bd1725`**, [Fast CI #42516352824](https://github.com/DarkGh0st03/delegation/actions/runs/42516352824) and [isolated Security CI #42516352991](https://github.com/DarkGh0st03/delegation/actions/runs/42516352991) passed. The native integration proved real Rust Engineer/Child/VP + private crypto MCP, OPA, Gitea, signed Test FAIL → controlled scripted recovery → independent Docker PASS and Draft PR; no merge and zero paid-model inference. This **does not** establish autonomous generative model decisions.

## Complete tracked caller inventory at R410

| Historical module | Exact observed callers | R411 disposition |
| --- | --- | --- |
| `authority-client.ts` | 5: 3 historical/native tests, 1 opted-in Engineer MCP HTTP runtime, 1 historical Runner dynamic EVM fixture | RETAIN; privileged legacy HTTP behavior still live only under explicit fixture policy |
| `authority-adapter-transport.ts` | 1: `authority-client.ts` | RETAIN; removing transport would break its live fixture caller |
| `trusted-reviewed-approved-dag.ts` | 3 static historical tests, zero actual owner runtime callers | RETAIN named-export compatibility shim; preserve test and unknown direct clients |
| `trusted-operational-repair-planner.ts` | 2 static historical tests, zero owner runtime callers | RETAIN star-export shim; old tests exercise same real Owner implementation |
| `trusted-repair-dag-controller.ts` | 2 static callers: Gateway behavioral test and historical native planning E2E; zero owner runtime caller | R411 migrate **native planning E2E** to new Owner core, retaining Gateway historical compatibility tests |

The `118` unresolved R385.17 runtime-indirection hints across the whole repository are **not an exact per-module count**, and external/published consumer existence has **not** been established either way. The private package has an `exports: "./src/index.ts"` canonical API, but direct relative imports of historical files exist; that fact alone cannot approve deletion. The four private crypto stdio MCP modules must not be retired.

## Concrete R411 changes

1. `poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs` now imports `executeTrustedAdmittedRepairDag` from `trusted-owner-repair-dag-execution.ts`, rather than resolving via the legacy compatibility shim. No change to test workflow behavior, to engine authorization or to the signed Root.
2. `poc/scripts/test/r411-legacy-compatibility.test.mjs` imports all three retained compatibility modules **alongside the Owner cores**, verifies at runtime that all preserved exported functions and values are `===` the true implementations (including every actual exported Planner value), checks native E2E new path, and asserts exact historical importer inventory, MCP presence and `deletionAuthorized:false`.
3. R385.4's exact allowlist now includes the new compatibility-identity regression for each wrapper and removes the native E2E from the old DAG wrapper importers. Reintroduction of extra runtime/static sources or a computed historical loader remains blocked by existing R385.4/R385.17 gates.
4. Both Fast CI and no-AI isolated native Security CI run the R411 test. The positive workflow watches the native EVM harness and R411 test files; thus changes retrigger the native Rust/OPA/A2A/Gitea/Docker gate on the same SHA.

This is **not** an endorsement to delete source or tests. Static provenance and export-identity tests do not rule out external users or computed paths. After both CIs pass, any further migration must target the explicitly opted-in HTTP issuer/Runner with an equivalent **tested** native Rust lifecycle or close a specific dynamic dependency, without model billing, permission expansion, loss of negative tests or automatic merge.

## R411.2 — Conservative terminal Child expiry margin correction

The first R411 native Security CI on SHA `77e7d394` failed **closed** at the final Test Task's Child issuance: `Child cannot outlive current Engineer operational root`. The original operational Root TTL is 1800 s and the former final Test Child requested 1500 s **starting at the time of the last task**. Thus its timestamp could fit only if the 25-task recovery reached that final Child in the first 300 s of Root lifetime. A genuine initial `run_tests` failure took approximately 202 s and pushed the final task past that boundary.

R411.2 changes the **disposable scripted fixture's final Test Child** validity from 1500 s to **900 s**; the signed operational Root remains 1800 s, its grants and scope are unchanged, and the issuer's `Child end <= both Root expiries` assertion remains intact. This tightens the final Child lifetime rather than extending any authority. Other Child credentials keep their original TTLs. The R385.8/R411.2 offline regression locks in the Root and Child lifetimes and rejects removal of the issuer's checks.

If work still runs past the available Root lifetime, the workflow must fail closed and retire/reconcile; no increase of privileges, Root renewal, or authority bypass is authorized. This is a timing-robustness fixture change, not evidence of generative AI behavior.
