# R100 / 2026-10-29 — Authority vs. operational Task epoch inventory

Baseline HEAD: 821825e7ab843ec6a26607311fd68482affabfc4 (R99.1).
Branch: refactor/post-prof-plan-contracts-20261021. No main merge or paid models.

## Existing cryptographic authority: PRESERVE
- src/delegation/issuance/delegation_issuer.rs: Rust child DC permissions, inherited
  parent scope, hierarchy, temporal constraints and cryptographic witnesses.
- src/delegation/verification/delegation_verifier.rs: VP proof,
  accumulator metadata/permission witnesses, chain, trust and revocation.
- Gateway Prepare/Execute: derive exact operation/resource from request,
  independently verify Core Rust VP and OPA, attest actual provider outcome.

## Application-only one-shot constraints: REWORK LATER
- poc/packages/plan-contracts/src/plan.mjs binds an Engineer approval
  to one plan digest and specific plan Task IDs/agents.
- trusted-approved-child-issuer.ts builds one fixed Task-to-grants map.
- trusted-approved-a2a-dispatcher.ts dispatches the immutable DAG once;
  a second Task ID is not in the approved table, even if same permission.
- approved-execution-plans.ts requires initial signed Task bindings.
  Do NOT remove these checks until a trusted dynamic Task registry exists.

## R99.1 prototype decision
- authorization-envelope.mjs is not active Gateway authority.
- Do not integrate a parallel signed envelope as a replacement to Rust DC.
- Consider only UI/consent DTO use, then consolidate/remove redundant
  signing and subset proofs after issuance by trusted Rust.

## Scope of THIS change
- operational-epoch-scope.mjs is a pure non-authorizing preflight for
  comparing a new plan against a pinned original plan and the already-issued
  operational root's exact ResourceURI/Operation pairs.
- It also checks repository/branch/main SHA, epoch version, Task/plan IDs,
  and identities from an independent trusted Agent registry.
- It emits execution_authorized:false; no signature, DC, VP, Gateway
  registration, A2A call or provider effect occurs.
- Unit tests cover two different subsequent DAGs and negative escalation,
  wrong repository/branch, wrong root, replay and identity swap.

## Next step (not implemented by R100)
- Trusted host must read root from actual Coordinator, original approval from
  signed store, agent registry and historical IDs from durable journal.
- Add persist-before-effect Task/epoch reservations, fresh child DC issuance
  via existing Rust Adapter, Gateway Task admission, and A2A recovery loop.
- Only after real Rust child/VP/OPA denials and Gitea/Docker E2E offline
  should the static one-shot plan path be migrated.

Engineer will approve repository, work branch, maximum exact grants and duration;
model/tool limits and maximum three test cycles are internal framework policy.
