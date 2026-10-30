# R123 — Live Engineer Host opt-in owner recovery arm

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

## Actual host wiring
Previously R113's reviewed A2A controller could accept a trusted recovery
callback, but the REAL admitted GitHub/Engineer Host never provided one.
An authenticated R117/R122 IPC Test FAIL therefore could not enter that
owner-only callback before the normal teardown.

The trusted Engineer local bootstrap now supports OPTIONAL
`ownerOperationalRecovery` with private epoch directory, SAME signed
approval store, and owner continuation callback. This is not a property
of GitHub/OIDC, A2A, a model response, or a dispatch Task request.
A strict instance identity check ties the private IPC client to the
real `TrustedExecutionCoordinator`, and the signed store to the
original `TrustedPlanningReviewGate`.

The admitted GitHub handoff, **after real root issuance** and a live
Actions check, constructs a one-use durable `TrustedOperationalEpochJournal`
under the exact original root ID, SHA and signed plan digest; it re-reads
Ed25519 Engineer approval and independently checks actual issued grants.
Only then does it arm `verifiedTestFailureRecovery` in the reviewed
A2A dispatcher. A failure during this arming causes owner-controlled
Gateway/native root closure; successful arming performs ZERO model calls.

On a genuine verified Test suspension, the owner callback re-reads
the finalized HMAC Gateway receipt R122, checks the exact dispatcher
feedback, keeps the same Rust root active, and can invoke the R121
Planner using `failedTestAlreadyFinalized:true` and the original
trusted intake. The callback is one-use; no second Docker test or
new authority is granted by this step.

## Limits
Two new offline owner-arming regressions use authentic signed Engineer
fixtures and live private Gateway IPC, testing successful handoff,
forged evidence, replay and retired root. They are not real Gitea/Docker
recovery. The owner callback still needs a concrete source reader,
Planner and Gateway epoch admission with fresh child DCs.

The original Functional Signed DAG same-Task retry must not be
turned green by pretending Test PASS. No Gemini billing; main unchanged.
