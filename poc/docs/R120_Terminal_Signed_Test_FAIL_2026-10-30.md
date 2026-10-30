# R120 — Failed signed Test Task cannot retry Docker

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

R119.2's real Gateway correctly prevents any second `run_tests` after a
Task's Docker Runner FAIL; the native Functional Signed DAG nevertheless
schedules FAIL → Test role edit → PASS in that SAME signed Test Task.
The second action is not authorized recovery and cannot certify a PR.

R120 latches every controlled `tests_failed` response inside the signed
Test Task, for both direct FunctionTool and shared MCP transports. Subsequent
`run_tests` tool calls return the first bounded failure without invoking
Docker again. A2A aggregation cannot erase it with a later synthetic PASS.
The Test model is told that a new attenuated Task and fresh child under the
existing Rust root may repair in-scope errors; only out-of-root changes
require new Engineer approval.

Regressions exercise repeated attempted Runner calls through both
transports and reject same-Task false PASS. These are OFFLINE tests, not
proof of the full Gitea/Docker repair workflow.

The Functional Signed DAG remains intentionally RED until its obsolete
same-Task fixture is replaced by real R115/R117 owner continuation:
verified FAIL -> discovery -> new signed DAG/epoch -> fresh DC/VP ->
Gitea repair -> independent Docker PASS on the new SHA -> review-only PR.
Do not turn that E2E green by merely disabling the failure scenario.

No paid Gemini calls; main untouched.
