# R112 — Verified Docker Test FAIL as a recoverable A2A terminal state

Date: **30 October 2026**  
Branch: `refactor/post-prof-plan-contracts-20261021`

## Context and security goal

The Delegation thesis framework's principal authorization authority is the existing Rust DC/VP hierarchy, **exact** ResourceURI/Operation attenuation, accumulator/witness and revocation checks, DID/EVM trust anchors, and Gateway/OPA enforcement. The Google ADK/A2A multi-agent workflow is a consumer of that authority, not a source of permission.

- R104–R105 implemented Gateway-corroborated failed Docker Test metadata and controlled quiescence of a failed Test and its transitive dependents.
- R106–R109 introduced a trusted second-epoch repair Planner, the exactly scoped read-only discovery child and immutable Task admission under the **same already-issued operational Rust root**.
- R110 verified a newly issued, attenuated discovery child DC and signed VP using **real native Rust Core, public EVM trust and live OPA** (scripted provider).
- R111 verified `FAIL -> discovery child -> repair epoch -> PASS -> review PR` in the same native Rust/EVM test, **with Gitea and Docker effects scripted in that new scenario**. Independently, the existing CI uses actual disposable Gitea and Docker for other scenarios.

### What the fresh offline runs showed

The Shared MCP Real Docker pipeline, run **41029590438**, produced genuinely failed Docker evidence. Its Test Agent first encountered `backend_tests=fail`, then applied an authorized test file change. On the second Docker attempt, Backend/Frontend tests and build passed but `playwright_e2e=fail`. The agent ended without successful completion. That was a **functional acceptance failure** and cannot be treated as a successful Test or an authorization bypass. The earlier separate Functional Signed DAG run **41027216671** also failed after reaching real Docker; the sanitized CI diagnostic did not establish a complete cause.

In the legacy dispatcher, any rejected A2A send leads to immediate `closeExecution()`, retiring Gateway Task scope and revoking the operational root. This is correct for uncertain dispatches, security failures and infrastructure outages, but prevents R106/R109 from carrying out a genuine authorized repair after a verified Test FAIL.

## Design decision

A recovered Test is not `A2A completed` and does not make the old Task successful. The **original immutable DAG must become terminal** while the **existing operational Rust root may remain active**, allowing a new, durably registered epoch and fresh attenuated child credentials.

This exception must require, jointly:

1. A trusted host explicitly enables the opt-in recovery capability using the concrete `TrustedApprovedExecutionPlans` and `TrustedOperationalEpochIntake` objects that share the same owner and Coordinator.
2. A *Test-role* Task in `executeApprovedDag()` encounters the exact allowlisted controlled A2A terminal failure `Protected A2A task ended without completion`. Generic transport or signer errors are not eligible.
3. `confirmTestValidationFailure(dispatchId)` succeeds on the **same** bound Gateway runtime Task. The Gateway must already have observed a failed `run_tests` provider effect with an exact tested SHA, completed dependencies, no conflicting PASS, and no outstanding provider effects. Dependency-install failures are excluded.
4. `prepareTrustedRepairFeedback()` reloads authenticated original Engineer consent, the actually issued Rust parent, and durable epoch journal; it matches session, original/root plan digests, Task ID, runtime Task ID, working branch, tested revision, first failed phase and remaining repair epochs, and rechecks the active root.
5. The owner confirms that the Coordinator is still in its `execution` phase after verification.

Only then does the dispatcher return `status: verified_test_failure_suspended` with a **source-free, non-authorizing** feedback receipt. It marks itself terminal and cannot dispatch another Task. It does **not** create or sign a repair DAG, issue a child DC, dispatch a second A2A Task, accept a PR, or merge code.

For *any* failed check, including a failed Runner that was not independently corroborated, a transport error, missing same-owner registry, expired root or exhausted repair budget, the original path still closes Gateway and revokes the root. The legacy behavior remains the default unless the trusted owner opts in.

## Code changes

- `poc/packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts` — opt-in verified recovery configuration, same-object Coordinator/Intake/Gateway binding, strict Test-role/controlled-error discrimination, internal `VerifiedFailedTestSuspension` sentinel, one-way terminal state and separate `verified_test_failure_suspended` outcome. No model tool can call the recovery path.
- `poc/apps/gateway/test/operational-epoch-gateway.test.ts` — integration test using real signed Engineer approval file validation, actual Gateway Prepare/Execute, actual Task/epoch state machines and a fake Runner/VP/OPA/Gitea. The trust enforcement code runs; the cryptographic and provider effects in this test are **fixtures**.

### Confirmed offline regressions

The **Gateway + Plans + ADK/A2A + MCP + GUI + OPA** job on cumulative CI `41031261530` completed **SUCCESS**. Specifically these tests ran and passed:

- A real Gateway-confirmed Test FAIL suspends the old DAG, preserves the existing root, and successfully admits a next epoch with only the verified Test's dependent descendants blocked.
- An A2A failure with a *passing* or absent failed Runner receipt still retires the root.
- A network/transport exception retires the root even if a failed Docker record exists.
- The legacy dispatcher without the opt-in owner capability remains fail-closed.

`Trusted Prebound A2A Dispatch (Offline)` also passed at run `41031261532`.

## Precise limitations and next tasks

1. **This R112 integration test is not a real end-to-end A2A SDK transport + native Rust DC + real disposable Gitea/Docker recovery run.** R110/R111 provide separate native Rust proof, and real Gitea/Docker pipelines provide separate provider proof; R113 must combine them.
2. The R112 recovery path is **opt-in**, not yet wired by default into the full production-style signed A2A/Docker host. The trusted owner must pass its exact existing Gateway registry and root intake. Do not auto-enable it in legacy or generic MCP handlers.
3. A recovered control-plane state is not a completed repair. R113 should consume `verified_test_failure_suspended`, schedule R109 read discovery with new child DC, use the authorized feature-SHA ADK read tool, reserve R106 repair DAG, dispatch fresh signed Task children, and get a genuinely passing Docker receipt before opening a review-only PR. The unsafe failure of any step must close the root.
4. Complete the migration of original Engineer approval away from Task IDs while using the native Rust root's exact maximum grants. Do not add a redundant parallel signature/envelope authority.
5. The internal three-epoch and inference-turn limits are NOT independent Gemini monetary billing limits. No paid Gemini experiments are allowed before user consent and independent provider billing-cap verification.

No merges to `main`; no paid inference calls made in R112.
