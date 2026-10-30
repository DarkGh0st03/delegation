# R140 — Private post-retirement Gateway Runner PASS attestation

Date: 30 October 2026. Only branch refactor/post-prof-plan-contracts-20261021.

R139 has now passed CI #41085369293 with real disposable Gitea and two
distinct Docker runs:
- FAIL SHA: 1c7133d1e096cae28cccc7cef8ea21594bc8db76
- PASS SHA: e73012052e40dd3299b946b99ebbc1837d38d511
- A draft PR was created only in disposable Gitea, with no merge.
These provider observations alone do NOT prove signed R133–R138 recovery.

R140 exposes an authenticated, owner-only and source-free new
`read_retired_runner_acceptance` action over the existing private Unix
HMAC Gateway channel. The caller can supply only session, exact signed
Test Task ID, branch and commit SHA—not an A2A PASS, Runner result,
credential, source file or provider response.

The real Gateway `TrustedApprovedExecutionPlans.readVerifiedRunnerEffect`
already requires a DURABLY retired session, completed Test Task in the
LATEST admitted epoch, correct signed `run_tests` grant, exact branch,
exact SHA, final passing Runner effect, all seven project+researcher
phases PASS and no subsequent write invalidating the tested SHA.
The R140 transport does not weaken any of these checks.

The Gateway revalidates and returns only a bounded, normalized PASS
receipt, with `gateway_session_retired:true` and explicitly
`rust_root_revocation_verified:false` and
`pull_request_authorized:false`. This is a positive evidence read,
NOT permission to issue a PR. Separate Rust EVM root revocation and
real Gitea branch head verification must still be completed.

Gateway IPC regressions verify: no receipt while live; read-only
exact-SHA success after durable retirement of a signed repair epoch;
forged branch, Task and SHA denied; a session with no completed
Test Runner effect denied. Provider/Adapter effects in this unit test
are simulated. No Gemini paid calls. Main unchanged.

Next R141: original-root Rust revocation observation + read-only
actual Gitea exact-SHA check and explicit review-only PR gate, then
single R142 integration CI combining actual R139 Docker effects with
signed Gateway/Child DC/A2A authority rather than treating one as
the other.
