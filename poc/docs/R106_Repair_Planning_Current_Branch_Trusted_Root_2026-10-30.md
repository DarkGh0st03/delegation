# R106 — Trusted operational repair planning on the existing branch
Date: 2026-10-30
Branch: `refactor/post-prof-plan-contracts-20261021`

## Original research invariants

Delegation is a cryptographically verified hierarchical authority framework applied to a multi-agent development scenario, NOT an Account Suspension script. The root is an existing Rust Delegation Credential (DC). Real subdelegation must remain attenuated and verified by native Rust (chain, permissions, accumulators/witnesses, revocation, DID trust), VP, Gateway Prepare/Execute and OPA. No independent application envelope may replace this authority. An Engineer ultimately chooses only repository, branch, exact maximum ResourceURI/Operation pairs and validity; retries and Agent assignments are Orchestrator/runtime decisions.

The R99.1 `authorization-envelope.mjs` prototype is not integrated into the Gateway and is **not** a second source of authority. The preexisting Engineer signature on the entire initial Task DAG still exists in the legacy activation path; removing that accidental planning coupling while retaining genuine Engineer authority is NOT yet completed. Do not claim this user requirement is fully implemented merely because an R106 repair plan can be registered.

## Why R106 is needed

Three previous paid Gemini runs reached Docker and returned TypeScript errors TS2820, TS2367, TS2339. Test Agent failure reporting was correct. R104/R105 now provide a Gateway-verified failed Docker receipt, not a false PASS. The old initial Planner searches pinned `main` and requires `create_branch`, so blindly rerunning it would discard modified feature-branch state and demand another initial-plan signature. Repairs must use the verified **current feature SHA** while retaining original main base SHA as the immutable root-session identity.

## Implemented

1. `TrustedOperationalEpochIntake.preflightRepairEpoch` reads the authenticated original Engineer receipt, the ACTIVE Coordinator's *actually issued* operational Rust root, and durable epoch history. A proposal undergoes the existing exact-subset preflight without journal writes, credential issuance, A2A dispatch or Gateway admission.
2. `TrustedOperationalRepairPlanner.proposeAndReserve` is owner-private and single-use. It obtains the `TrustedRunnerFailure` through Gateway corroboration, checks the maximum three total epochs budget, verifies the HEAD of the existing Gitea feature branch matches the Runner-tested SHA, and invokes a **single** injected proposal callback. It does not create a new branch or request fresh Engineer approval.
3. The callback can propose only Tasks with bounded roles, descriptions, dependencies and ResourceURI/Operation pairs. Session ID, repository, initial base Git SHA, branch identity, version, Agent DID/Card identities and plan ID come exclusively from trusted inputs. A candidate must contain an implementation/test write and exactly one Test that depends on every distinct write Task. Optional Orchestrator PR creation must depend on the passing new Test; the model cannot introduce a new branch creation.
4. Before reservation, the candidate must pass the Rust operation-catalog plan contract and the EXACT pair subset of the real issued Rust root, plus the trusted Agent Card registry and durable Task-ID replay ledger. After the model callback, the Controller repeats verified failure/historical checks and HEAD verification, then reserves only one fresh immutable epoch.
5. The returned result states `execution_authorized:false` and `child_credential_issued:false`. No Task can bypass the existing separate Gateway admission, Rust child-DC issuance, VP/Core Rust check or OPA. The source-free feedback does not leak code, raw compiler output, token credentials or unfiltered diagnostic paths.
6. Scripted no-billing Gateway regression tests cover FAIL -> private repair proposal -> durable epoch -> Gateway admission -> Backend correction -> Test PASS. Negative cases cover unauthorized file, out-of-scope role/operation, changed feature HEAD before and after proposal, wrong Test dependency, premature PR and forced new branch. A separate invoice-service fixture keeps the logic independent of Account Suspension.

## Essential gaps before paid Gemini

- **No Gemini repair integration yet**: `proposeRepairPlan` is a trusted-host callback with a scripted fixture in tests. It is NOT plugged into Google ADK, a model-specific interface, or a feature-SHA read-only MCP discovery port. The current `TrustedAdkReadOnlyPlanner` is intentionally unchanged.
- **The feature-revision reader is injected and mocked in this increment**. Production must use a Gateway-protected Gitea `read_branch`/trusted exact-SHA route with independently verified provider identity; never use a model-provided SHA. Any TOCTOU before later provider calls must remain subject to Gateway's own final authorization/revision controls.
- **No integrated new-epoch A2A real run**: R102's real child issuer Adapter route and R103's Gateway admission exist as separate pieces, but there is no completed signed child DC -> VP -> native Rust/OPA -> real Docker FAIL -> repair -> PASS test for the *same* operational root.
- **Original Engineer approval migration pending**: initial Plan digest binding must be decoupled from the maximum authority consent, backed by the **existing Rust DC issuance**, without parallel signature machinery.
- **No cost guarantee or paid test authorization**: the three-cycle limit protects Task attempts, not actual Gemini currency spend. A verified provider billing cap and explicit user permission remain required for live pilots.

## Next incremental route

R107a: connect a trusted read-only Gitea feature HEAD/source read port via Gateway and a bounded ADK repair Planner mode. Ensure file reads are separately granted, don't assume account-suspension paths, refuse unknown branches and stale SHAs.
R107b: construct live A2A execution and child DC/VP through the existing Rust Adapter under the same root, with durable per-epoch status indices and credentials, while retaining anti-replay and revocation.
R107c: Docker fail -> selective role correction -> exact SHA PASS -> PR with *real* Gitea and Core/OPA in a no-billing CI scenario. Only then consider approved Gemini experiments.

No main merge. No paid Gemini call in R106.
