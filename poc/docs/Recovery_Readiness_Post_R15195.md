# Consolidated recovery validation after R151.95

Application parent: c4379c27f5c27748b27a4648370cc2c1bca9094c.
The full-ci checkpoint that adds this document validates that parent tree plus
this request/documentation change. No model inference is authorized by it.

The demo now provides the shared lifecycle contract to the real Planner instead
of a one-line objective. Initial and repair instructions preserve the full
approved requirement. Operational epoch admission rejects a substituted objective
while allowing new repair Task briefs within the original signed root.
An uncertain investigation response stops before repair proposal/reservation.

| Case | Verification | Evidence boundary |
| --- | --- | --- |
| T0: correct initial implementation | Functional Signed DAG positive scenario; Shared MCP E2E | Scripted models, real Gitea/Docker and acceptance; PR on tested revision |
| T1: Backend defect | Functional `R151.84 real Backend tests FAIL` | Signed D1 edit, changed revision, fresh real Docker PASS |
| T2: Frontend defect | Functional `R151.85 real Frontend tests FAIL` | Signed D1 edit, changed revision, fresh real Docker PASS |
| T3: generated test defect | Functional `Signed generated Backend Test FAIL` | Explicit original Test read/update grants, Test editor and separate validator |
| T4: insufficient evidence | Fast `T4 insufficient evidence` Gateway test | Real owner/IPC and signed journal; provider/model ports scripted; no new epoch or repair effects; caller closes execution |
| T5: authority violation | Gateway operational epoch denial tests; native signed-scope denials | Rejected old bindings, role/resource substitution and ungranted operations; zero forbidden provider effects |
| T6: effect integrity | `d1-editor-revision.test.mjs`; native owner revision checks | Task/runtime/credential/branch/path binding, provider commit equals HEAD and advances failed revision |

T4's integration test is not a Docker replay or a new native Rust revocation
proof. T6's isolated regression is not a claim of universal model diagnosis.
The Functional workflow additionally seals and recovers failed source archives
and logs locally, verifies their hashes, and publishes only counts. Its key is
ephemeral and raw evidence is discarded at job end.

## Gate and remaining configuration

The existing paid-pilot gate requires Functional, Cumulative Offline and Shared
MCP success on the exact candidate SHA. Fast CI and success on earlier SHAs do
not satisfy it. Inspect the original run and all job conclusions before claiming
readiness. A cancelled or skipped job is not a successful validation.

For a future explicitly authorized paid pilot, configure and retain a separate
secure copy of `RUNNER_EVIDENCE_KEY_HEX` before enabling encrypted failure evidence.
No secret was created by this checkpoint. Without it, the paid workflow leaves
retention disabled and the next failure may again lack recoverable source/logs.
Provider billing limits and paid execution consent remain separate prerequisites.
No source/test defect from historical Gemini failures has been conclusively
reconstructed from the sanitized artifacts available in this thread.
