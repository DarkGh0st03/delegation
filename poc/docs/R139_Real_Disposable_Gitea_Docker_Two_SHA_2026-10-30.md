# R139 — Real disposable Gitea + Docker FAIL → new SHA → PASS → PR

**Scope:** isolated provider-level integration test, no Gemini/OpenAI billing.
Does NOT replace signed R133–R138 EVM/Engineer/Gateway recovery acceptance.

On an exclusively disposable Gitea repository (never the persistent
installation), reuse the pinned public IAM-console fixture and run the
existing trusted positive security-CI test. With the explicit opt-in
`APPROVED_RUNNER_REAL_REPAIR_TWO_SHA=1`, create a new feature branch,
inject one deterministic failing Vitest assertion into the approved
backend test file, and commit/push a REAL Git SHA. The actual
`IsolatedDockerRunnerExecutor` downloads that SHA and performs real
Docker phases; require specifically `backend_tests:fail` rather than
any transport or infrastructure failure. Before repair ensure there is
no PR for the branch.

Remove the temporary assertion, commit/push a DISTINCT new Git SHA,
verify a stale-SHA Runner request is refused, and execute a second
independent real Docker run on the exact current repaired SHA. Require
all six project phases PASS and researcher acceptance PASS. Only then,
and only in this disposable Gitea fixture, create a DRAFT/WIP review
PR and verify its head is precisely the tested SHA. Assert main
remains on its original pinned SHA. Never call any merge endpoint.

`r139-real-repair-evidence.mjs` rejects same SHA, same Task IDs,
stale/mismatching request identity, invented PASS and failed independent
acceptance. Its proof states clearly `root_vp_verified:false`,
`gateway_repair_epoch_admitted:false` and
`rust_repair_child_issued:false`: real provider tests are not signed
authorization or a true R138 live owner E2E.

A separate zero-billing CI workflow can prove real Docker/Gitea.
Remaining R140: integrate these actual two runs through R133
attested Test FAIL, original-root-bound new signed DAG and two fresh
Rust DCs / protected A2A, then produce human-review-only PR.
Historical same-Task positive fixture must not be weakened or
claimed to represent recovery. Main remains unchanged.
