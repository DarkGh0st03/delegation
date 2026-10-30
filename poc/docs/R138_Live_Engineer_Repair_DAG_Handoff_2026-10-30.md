# R138 — Live Engineer Host dispatch of R137 repair DAG

Date: 30 October 2026. Branch: refactor/post-prof-plan-contracts-20261021.

R137 already drove a signed Backend → Test repair DAG in a scripted
Gateway fixture. R138 connects it to the existing R123/R124
`armTrustedOwnerOperationalRecovery` continuation, which is called
ONLY within the original Engineer Host's admitted, still-live Rust root.

The owner-only `planRepairEpoch.executeAdmittedRepairDag` configuration
is opt-in and may only accompany `admitReservedEpoch:true`, an
independent root VP signer and the SAME authenticated paid GitHub
run watcher. The original signed session, Engineer DID, Coordinator,
Gateway, epoch number and plan digest come from trusted runtime state,
never the LLM, A2A, or GitHub workflow payload. The owner supplies a
pre-pinned A2A transport, private Adapter bearer, durable Child DC
journal and one-use native status allocations.

R138 calls the R137 controller ONLY after the Gateway has returned
`gateway_epoch_admitted` for the signed current repair DAG. It rechecks
the original GitHub run and lease at every task boundary, immediately
before irreversible child issuance, after the A2A roundtrip and
after independently Gateway-confirmed effects. If the run is canceled
between Backend completion and Test issuance, Test is never sent.
Ambiguous issuance remains fenced by the Gateway binding and Child DC
journal, and no automatic retry is offered.

The controller still reports `docker_pass_verified:false` and
`pull_request_created:false`. Even a completed, Gateway-confirmed
repair Test task requires separate exact-SHA Runner acceptance and
root retirement before a review-only PR is considered.

Tests are offline with scripted Adapter/provider effects. No Gemini
API calls, no operator payment, no main merge. Real Gitea/Docker
FAIL → repair → PASS → review-only PR is NOT yet validated.

Remaining R139: build a zero-billing real Gitea/Docker fixture with a
fresh failed Test Task and a new repair epoch, replacing the historical
legacy same-Task recovery fixture rather than weakening fail-closed.
