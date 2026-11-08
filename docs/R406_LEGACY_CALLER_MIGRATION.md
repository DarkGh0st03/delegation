# R406 — Gradual legacy caller migration: neutral D1 repair model contract

**8 November 2026** — development branch `refactor/post-prof-plan-contracts-20261021`, PR #38 Draft, no merge, no paid inference.

## Verified baseline and scope

R405 validated the chained command scanner and separate Engineer approval suites on SHA `d5c409f60ab20184111337c044cb85bbe271f63e`: [Fast CI #42510634648](https://github.com/DarkGh0st03/delegation/actions/runs/42510634648) SUCCESS 2/2; [Engineer Approval CI #42510634639](https://github.com/DarkGh0st03/delegation/actions/runs/42510634639) SUCCESS. The R385.17 audit still identifies **five historical runtime modules with known non-test imports**; computed/indirect/external reachability is not cleared.

This first R406 migration only removes a **type-level coupling**: `trusted-owner-operational-repair-handoff.ts` and `trusted-adk-operational-repair-proposer.ts` no longer depend on the historical `trusted-operational-repair-planner.ts` for the shape of `TrustedRepairModelInput`.

The four exported interfaces `TrustedRepairPlanningObservation`, `TrustedRepairDiscoveryObservation`, `TrustedRepairDiagnosticSource` and `TrustedRepairModelInput` are extracted verbatim into `trusted-operational-repair-model-contracts.ts`. This file contains only types and an `import type` for pre-existing failure summaries. The historical executable Planner imports/reexports these types so its validation behavior and existing consumers are unchanged. The original runtime authority and its original sequence of authenticated Gateway reads, Rust-root scope checks, model preflight, epoch admission, Child issuance and A2A execution remain in their existing modules, *untouched*.

A new Fast CI test checks that stripping TypeScript types from the neutral module yields **zero JavaScript module imports**, confirms the ADK and owner dependencies point to the neutral contract, and explicitly asserts that historical fail-closed planner and controller safeguards are **still present**.

## Explicit remaining migration blockers

- `authority-client.ts` and `authority-adapter-transport.ts` remain necessary for the opt-in HTTP fixture and the historical Runner scenario. Do not substitute them into the native Rust route.
- Three old GitHub/scripted/fresh repair handoffs still load `trusted-reviewed-approved-dag.ts` dynamically after their owner gates.
- `trusted-owner-operational-repair-handoff.ts` still dynamically loads the historical repair Planner and DAG controller after Gateway/failure preflight. This is a **real execution dependency**, unlike the type-only import removed here.
- The four private `owner-private-*` crypto MCP modules must remain intact.
- The strict R385.17 caller allowlist and R385.4 closure gate remain active. No runtime module is marked deletable by this patch.

## Next gate

Complete Fast CI and the relevant native Rust/Security CI on the R406 SHA before treating this isolated contract extraction as verified. Next, inspect historic handoff entry points against canonical authority-only execution and identify a caller whose *runtime* dependency can be migrated without weakening Engineer approval, Root retirement, Task/Child/VP boundaries, Gateway attestation, or negative tests. No model calls or automatic merge.

## R406.2 — Neutral owner repair DAG port contract

The second static type dependency is now migrated. `trusted-owner-operational-repair-handoff.ts` describes its trusted repair DAG ports through the new `trusted-repair-dag-contracts.ts` rather than `Parameters<typeof executeTrustedAdmittedRepairDag>` imported from the executable old controller. The original controller itself consumes **the same exact extracted Readonly configuration shape**. It still performs the existing live Root, signed epoch, Gateway-confirmed Task and A2A execution checks. The new contract has only `import type` dependencies and strips to zero runtime imports.

The R385.3 fail-closed regression is updated to require the neutral type path while still checking original-root retirement, bounded dynamic loading and no claimed Docker PASS or PR. The R406 offline test independently asserts the neutral DAG-port module cannot import the historical controller.

**Still blocked:** owner recovery's `await import("./trusted-repair-dag-controller.ts")` and `await import("./trusted-operational-repair-planner.ts")` remain deliberately live behind Gateway and signed-root guards. This patch does **not** remove them or declare them dead. Retiring their executable paths requires a separate behavioral migration with equivalent signed Child/VP and native E2E attestation.

## R406.4 — Native Engineer Rust port type isolation

The native Node-API Engineer Core port and native Unix socket port previously used `import type` aliases from the old HTTP Adapter transport and `authority-client.ts`. Both now depend directly on the existing neutral `trusted-credential-contracts.ts` for `IssuedDelegationCredential` and `TrustedEngineerCoreConfig` (bearer and optional timeout). This removes those historical type couplings **without changing runtime code or the security contract**. R240 and the R406 offline guards now prove the canonical native ports cannot import the old HTTP sources. The legacy fixture selector and its separate explicit opt-in remain intact.

The five historical runtime modules are **still present**: this isolates the native path, but is not proof that the opt-in HTTP issuer or the three signed-DAG execution routes may be deleted. No paid model call or merge is triggered.
