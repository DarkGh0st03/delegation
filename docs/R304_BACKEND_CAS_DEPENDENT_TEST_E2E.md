# R304 — permission-only Backend CAS → dependent native Test Runner

Status at introduction: **script and dispatch-only workflow staged; real
Docker execution NOT YET VALIDATED**. Based on R302 signed Backend CAS
SUCCESS and R303 Test Agent Runner implementation. This is not the final
three-agent Account Suspension workflow.

- One permission-only Engineer approval contains Backend
  `update_file` directory scope and Test `run_tests` feature-branch
  scope; no signed DAG, new Engineer approval or expanded root.
- Coordinator registers Backend Task epoch 1 and Test Task epoch 2,
  depending on Backend. Each has its own native Rust Child DC and VP.
- Backend changes a throwaway Gitea feature-branch file via strict
  old-HEAD/old-blob CAS and authenticated independent commit evidence.
  Task completion must be attested before Test can stage.
- Test owner pins the **new** Gitea commit, not the old approval
  base revision. Its own original Prepare, private Runner intent,
  R293 Task flight, Rust VP and real OPA must be valid.
- A single protected HTTP Runner launch executes all real project
  tests plus researcher acceptance on that exact commit. PASS
  is independently authenticated and journaled. FAIL/ambiguity
  never unlock dependent Tasks.
- Replays, foreign Child, wrong operation, revoked root and any
  signed-DAG/legacy Executor route fail closed. `main` remains
  protected and there are no paid model calls.

The GitHub workflow is initially **manual dispatch only**. Do not run it
until the preceding R303 single-Test native Docker acceptance succeeds
and its diagnostic incident is resolved. Then validate R304
against disposable real Gitea, EVM, OPA and Docker, checking
`r304_native_backend_cas_then_dependent_test_docker`,
`runner_posts:1`, `provider_calls:1` and
`test_completion_attested:true` on the same SHA as Fast CI.

The next architectural increment is a real Frontend Task between
Backend and Test, with independent CAS, then recovery and review-only PR.


## Test-fixture provenance and scope limitation

The first R304 positive integration may seed a *completed* functional
reference through a CI-owner-only fixture **before** Engineer approval,
then perform the genuine delegated Backend CAS on a separate
non-functional proof file and run the dependent native Test Task.
This is an authorization and Task-dependency E2E, NOT a claim that the
Backend mutation implemented Account Suspension. No functional edit
may be silently credited to an agent. The full autonomous
Backend→Frontend→Test path still needs to solve the original unsolved
source, pass independent acceptance and create a review-only PR.
