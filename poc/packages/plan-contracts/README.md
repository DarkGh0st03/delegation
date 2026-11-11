# Delegation plan contract — stage 1

This directory contains the first **versioned contract** for the new
Gemini Planning → Engineer Approval → A2A Execution workflow.

- `schema/workflow-plan.schema.json`: proposed/human-edited plan shape.
- `src/plan.mjs`: dependency-free structural and semantic validation,
  canonical SHA-256 plan digest, and per-task execution compliance checks.
- `test/plan.test.mjs`: offline positive and negative tests.

Run from the repository root:

```sh
node --test poc/packages/plan-contracts/test/plan.test.mjs
```

## Trust boundaries (mandatory)

1. The LLM may **propose** task IDs, registered agent IDs, dependencies,
   resources and permissions, but none of these are trusted because the
   model emitted them.
2. The validated repository, pinned Git SHA, allowed agent registry/Agent
   Cards, canonical resource URIs and Rust Operation catalog must be
   checked independently by the future trusted backend. Call
   `validatePlan(plan, {allowedOperations})` with a catalog supplied by a
   conformance-checked Rust source. Missing catalogs are rejected.
3. A human-edited plan is a **new version**. Each trusted approval is bound
   to `plan_id`, `session_id`, `version` and the canonical plan digest.
4. `makeApproval` is a helper for a **trusted, authenticated backend**.
   Its output is NOT an authenticating signature or a credential. The
   actual backend must authenticate the Engineer, verify their authority,
   and persist an immutable approval decision. An untrusted client can
   recompute a SHA-256 digest; digest equality alone never proves consent.
5. `assertApprovedExecution` is plan-compliance preflight. The caller
   must load the authentic approved plan and approval decision from
   trusted storage. Every protected effect must ALSO be authorized via
   DC/VP verification in Core Rust, the Gateway and OPA.
6. A plan can reorder independent tasks or retry a transient action
   within bounded limits; it cannot assign a task to a different agent,
   change the covered operation/resource or expand the approved scope.
   Substantive edits require a new plan version and approval.
7. The mock UI at `poc/workflow-ui/` remains a separate unauthenticated
   demo; its current `0.1-mock` fixture is NOT this trusted contract.
   We will migrate UI fixtures only after agreeing on the contract.

The module intentionally does not issue roots/child DCs, reach Gitea,
call Gemini, expose secrets, or update any branch. It is independent of
the draft VC/VP conformance PR.

## Stage 9 — Plan approval verification for DC issuance

The `assertApprovedPlanScope(plan, approval, {allowedOperations,
expectedEngineerDid})` helper validates a trusted immutable approval
record **without** supplying fabricated completed-task IDs. It checks
the pinned plan digest/version, exact approved permission IDs,
Engineer identity and plan-level agent/task/resource assignments.

It does not attest who authenticated the Engineer. That is the
responsibility of the trusted `TrustedApprovalStore` backend, not the
LLM or the standalone hash function. The resulting permissions are
subsequently filtered through the actual Gateway support set and
canonical URI restrictions by the Engineer authority session.

`assertApprovedExecution` remains independent: its
`completedTaskIds` must be sourced from trusted task state once the
execution phase is implemented. The root DC cannot replace that
execution-time plan gate or Rust Core/OPA authorization.

