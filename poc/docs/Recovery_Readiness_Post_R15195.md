# Consolidated recovery validation after R151.95

Consolidated application/workflow parent:
298987905b2a6e4fd2b1236bf47a5b76becbbd4b.
The accompanying full-ci checkpoint validates that tree plus this marker and
documentation update. No model inference is authorized by it.

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
No secret was created by this checkpoint. Without it, the paid workflow now stops before provider access; this prevents
repeating a billed failure without recoverable source/logs.
Provider billing limits and paid execution consent remain separate prerequisites.
No source/test defect from historical Gemini failures has been conclusively
reconstructed from the sanitized artifacts available in this thread.


## Verified runs before the consolidated assertion/editor checkpoint

| Run | SHA | Verified result | Scope |
| --- | --- | --- | --- |
| [Functional 41410040542](https://github.com/DarkGh0st03/delegation/actions/runs/41410040542) | `9fc35aec9003` | SUCCESS | Native Gitea/Docker source and generated-Test recovery; private assertion retention |
| [Cumulative 41408241405](https://github.com/DarkGh0st03/delegation/actions/runs/41408241405) | `d35fb499c9ff` | SUCCESS, five jobs | Offline contracts, Rust/EVM, Gateway and real Runner regressions |
| [Shared MCP 41408241397](https://github.com/DarkGh0st03/delegation/actions/runs/41408241397) | `d35fb499c9ff` | SUCCESS, attempt 2 | Real shared MCP/Gitea/Docker after cancellation and targeted retry |
| [Assertion proposer 41411762301](https://github.com/DarkGh0st03/delegation/actions/runs/41411762301) | `6d2ed160a481` | SUCCESS; bounded artifact inspected | Filtered private assertion reaches actual scripted proposer, signed Test edit and fresh Docker PASS; one bundle recovered |
| [Fast 41414022872](https://github.com/DarkGh0st03/delegation/actions/runs/41414022872) | `298987905b2a` | SUCCESS | Includes protected editor IPC disclosure and required evidence-key workflow preflight |
| [Assertion editor 41413499340](https://github.com/DarkGh0st03/delegation/actions/runs/41413499340) | `7785f84a3e4e` | In progress at this checkpoint | Adds actual protected editor A2A read-scope assertion; do not claim PASS before completion |

These results cannot be combined into an exact-SHA paid-pilot GO. The new marker
requests all three required Full CI on one SHA, including the current assertion
proposer/editor path. Keep the application tree stable while these validations
run; make further application changes only for a concrete uncovered defect.

The paid workflow now checks evidence-key configuration before provider access.
No repository secret presence, provider billing cap or consent for a future paid
execution has been verified or created by this checkpoint. A green free gate
alone is not permission to run Gemini.
