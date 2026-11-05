# R283 — R0 audit and first R1 authority-only contract

**Date:** 2026-11-05  
**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**Baseline:** R282 `ce0e97f89614ad32e7b6e0f23fdb10a0b0988de0`  
**Scope:** pure contract and negative tests, **no operational cutover**.

## Authoritative architectural decision

For the new architecture, the Software Engineer approves a **set of
(ResourceURI, Operation) permission pairs**, plus a pinned security context:
session, repository, feature branch, requirement digest, base revision,
Engineer identity and expiration. The Engineer does **not** sign individual
Task IDs, agent assignments, DAG dependencies, or future local repair tasks.

The Orchestrator may select agents and derive narrower child delegations
under the same independently authenticated operational authority. It
must never add a missing root permission. R2/R3 separately define **safe
hierarchical resource containment**, rather than approximating directory
membership with a text prefix.

## R0 — code-path audit

| Boundary | Current R282 implementation | Migration requirement |
| --- | --- | --- |
| Planning | `trusted-adk-planner.ts` produces Task/role/DAG/permission plan | Split into authorization proposal and unapproved execution draft |
| Review/signature | `plan.mjs`, `signed-approval.mjs`, `review-bridge.mjs` bind approved permission IDs to full plan digest | Sign permission-only authority and bound context; never sign DAG |
| Existing envelope | `authorization-envelope.mjs` signs repo, branch, exact pairs and expiry, but lacks session/requirement/base SHA | Retain as low-level canonical URI validator; R283 adds the missing signed context |
| File store | `signed-approval-store.ts` validates the old signed plan receipt | New trusted authority receipt store + session/replay and expiration checks |
| Engineer root | `trusted-engineer-authority.ts` calls `assertApprovedPlanScope` on Task-bound plan | Mint root from the authority-only grant after preliminary-root revocation |
| Gateway | `approved-execution-plans.ts` registers/authorizes immutable Task-bound plan | Enforce authority ceiling plus trusted current execution epoch |
| Dispatcher | `trusted-approved-a2a-dispatcher.ts` freezes and walks signed DAG | Trusted dynamic Task binding and independent delegated child issuance |
| D1 | Previous signed-epoch recovery respects root but couples to original plan | Generalize dynamic repair under root, while preserving no-escalation checks |
| Rust/OPA | Rust VP/DC enforcement and deterministic OPA pass free native CI | Add hierarchical scope containment in Rust/OPA only after negative proofs |

**The old signed-DAG route remains authoritative** until all replacement
boundaries are implemented, integrated, and proven. Do not switch to a
model-proposed unsigned DAG by simply removing `assertApprovedPlanScope`
or Gateway Task checks.

## R1 — first implemented, zero-billing contract

`poc/packages/plan-contracts/src/authority-only-approval.mjs` provides:

- `validateAuthorityProposal`: exact versioned request schema with canonical
  trusted catalog operations and scoped resources, session, pinned Git SHA and
  requirement.
- `selectAuthorityOnlyGrant`: Engineer's approved subset of requested pairs;
  no auto-invented or duplicate permission.
- `signAuthorityOnlyGrant` and `verifyAuthorityOnlyGrant`: domain-separated
  Ed25519 receipt, independently pinned Engineer DID/public key, explicit
  expiration (max 24h) and canonical bound context.
- `assertExecutionWithinAuthority`: exact-pair **preflight only** that allows
  separate agent/DAG arrangements but rejects changed session, requirement,
  repository, branch, SHA or permission. Verified results are in-process
  branded so an untrusted JSON object cannot masquerade as an already
  verified Engineer receipt.

This initial contract is **intentionally not** a root issuance API,
Gateway authorization decision or model tool. A new trusted host must
re-verify the signed receipt locally rather than treating a serialized
`authenticated` field as evidence.

## Fail-closed boundaries and next integration steps

1. Implement a **new read-only signed authority store** with protected file
   handling and pinned trust, plus durable one-use activation/replay journal.
   Keep the legacy signed-plan store separate during migration.
2. Teach the trusted Engineer and Rust issuer to revoke the preliminary DC,
   confirm revocation, and issue the independent operational root from the
   verified grant (not Task-specific permission IDs).
3. Implement Rust permission containment for directory/resource descendants
   and formal attenuation (R2) with traversal, sibling-prefix, branch/repo,
   and multi-hop negative tests. Only then enable directory-scoped grants.
4. Extend Gateway/OPA Task enforcement to confirm each dynamic Task and child
   credential against the authenticated root; allow dynamic execution state
   only via trusted coordinator, not public MCP/A2A JSON.
5. Separate the preapproval proposed authority from postapproval execution
   refinement, preserving the session objective and a host-signed immutable
   authority ceiling. Do not authorize model-generated root credentials.
6. Add trusted Agent Card availability and dynamic task handling/recovery.
   Audit race/replay/lease expiration and independent Runner test SHA.
7. Prove negative and positive end-to-end offline on the **same SHA** before
   retiring the old runtime. No paid Gemini run until separately authorized.

## What is NOT yet implemented

- R1 runtime cutover or authority-based Rust root issuance; the new contract
  cannot execute any Task.
- Directory/recursive scope attenuation (R2/R3), dynamic Gateway registration,
  autonomous recovery/redelegation (R7/R8), or Planner composite reads (R9).
- A GUI/real human approval, dynamic repository import, final local demo.
- Any successful Gemini end-to-end pilot on the new architecture.

## CI

This isolated module and its negative tests are picked up by the existing
Fast CI wildcard `node --test poc/packages/plan-contracts/test/*.test.mjs`.
No new expensive workflows or Gemini calls are needed at this step.
