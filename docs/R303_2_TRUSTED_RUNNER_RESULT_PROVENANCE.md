# R303.2 — authenticated Runner result provenance and strict PASS classification

Parent: `8da31d6fcd080f7f1928cd9754ab2f034b59fc87`.
R303.1 already pins the Test Agent's native Child DC, immutable signed
`run_tests` permission, original Gateway Prepare, private Runner journal
and exact Gitea commit (no Docker execution yet).

## Added

`RunnerClient.run` now creates a private WeakMap provenance witness
for its ORIGINAL in-process result object, bound to the precise
authenticated Controller client instance, request, repository,
feature branch and tested SHA. Copies, object modifications, swapped
commit IDs, changed request IDs or another Client instance fail
`assertTrustedRunnerClientResult`. A response claiming PASS while
containing failure diagnostics is rejected, rather than silently
discarding contradictory failure fields.

`validateTrustedRunnerPass` additionally requires a real authenticated
RunnerClient result with ALL seven fixed phases, in exact canonical
order and PASS: dependency install, TypeScript, Backend, Frontend,
build, Playwright and researcher acceptance. It checks the independent
`project_tests.status=pass` and its six fixed phases, requires
`researcher_acceptance.status=pass` and the Runner-owned
`runner-log://UUID` reference. Missing/skipped/duplicate/reordered
tests or acceptance, FAIL, excessive failure artifacts and forged
copies are refused.

The result remains `runner_execution_authorized:false`. This module
**does not itself launch Docker, verify a native VP/OPA decision, verify
Runner logs, attest a Task as complete or create an HMAC receipt**.
It provides a strict second precondition for the next trusted
`run_tests` Executor and independent result attestor.

## Next acceptance

Wire R303.1 pinned intent and the Task's durable provider flight to
a REAL native Rust signed Child VP and independent OPA; reserve an
irreversible Runner attempt before POST; invoke the controlled Runner
exactly once with the previously pinned SHA; reject moved HEAD both
before and after; validate genuine Runner PASS and researcher acceptance
using this routine; and independently publish/read MAC-authenticated
completion tied to Runner request/commit. Preserve a bounded FAILED
result for next-Task recovery without falsely claiming PASS. Then
prove with an isolated disposable real Docker workflow and the
R303 Test Agent; no paid Gemini.

No production GitHub writes, no automatic main merge, and no
`run_tests` execution bypass for legacy mode.
