# R282 — Generic agent creation and capability-card discovery

**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**Parent:** R281 `2c1807a052a16f73e9769e14072bc4cde17008a8`  
**Date:** 2026-11-05

## Verified discrepancies from the November 5 audit

- R281's generic signed specialist profile and Planner operation matrix
  allowed `create_file` only for the Test role. Backend and Frontend can
  legitimately create newly required source files, but their Task must
  explicitly request this operation for a discovered directory.
- The ADK Planner was supplied only three role identifiers and trusted
  `did`/`card_ref` records. It could not invoke a tool to inspect A2A
  Agent Card skill descriptions before selecting a specialist.

## Narrow implementation

1. Add `create_file` as a **capability** of generic Backend and Frontend
   specialists and as an allowed proposed operation in the Planner compiler.
   The Planner still requires a prior discovered directory, canonical file
   URI, immutable Task/operation binding and independent Engineer approval.
   The specialist ADK tool still appears only when that exact signed Task
   contains a matching `create_file` grant. Rust credential verification,
   Gateway and OPA independently enforce every provider effect.
2. Add a read-only `read_agent_card(role)` ADK FunctionTool. The bounded
   trusted-host lookup uses the SAME `createSpecializedAgentCard`
   `approved-plan` factory used by A2A role services, and returns only
   public skill identifiers, descriptions and the trusted registry's
   `card_ref`. It does **not** fetch arbitrary URLs or accept model-supplied
   identity/permission data; it never issues or expands delegation. The
   Planner is explicitly instructed to consult cards before role selection.
3. Add offline tests that call the real ADK FunctionTool with a scripted
   model, check the returned skill descriptions, and prove create-file grants
   are still Task-scoped. No paid model or dynamic project data is used.

## Deliberately not changed

- The *signed plan remains immutable* after Engineer approval. There is
  still **no second generative post-approval DAG planner**; that would require
  a separate two-stage signed-authority contract and review.
- Signed agents continue to suppress file-operation tools when the Task has
  no matching signed operation/path grant. The broader proposal to expose
  every forbidden tool deliberately to the model, and rely on runtime Gateway
  denials, is **not implemented here**; that behavior risks avoidable
  denied calls and must be tested separately without weakening authority.
- Agent cards are generated from the host's published approved-plan card
  factory, not freshly fetched and independently verified from remote A2A
  endpoints. Distributed dynamic card discovery is **not claimed**.
- Composed Gateway reads are not yet exposed as one Planner FunctionTool.
- Adapter/Rust issuer, Gateway/OPA rules, existing Task signatures, D1
  recovery, legacy migration, full UI, and dynamic repository selection
  are unchanged.

## Evidence gate

A branch push triggers free Fast CI plus relevant offline workflow tests.
Successful R281 checks do not certify R282 by inheritance. A future billed
Gemini pilot requires a fresh exact-SHA four-workflow native gate and
**separate explicit payment consent**. This commit does NOT dispatch or
authorize any billed model run.
