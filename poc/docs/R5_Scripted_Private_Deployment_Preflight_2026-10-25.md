# R5 — Private scripted_offline dispatch registration preflight

**Status: R5 NO-GO until same-SHA CI and one real distributed execution.**
This is an operator read-only preparation step, not authorization, Engineer
approval, an actual runner deployment, a test of mTLS, or a signed-DAG receipt.

## Why this check exists

GitHub registers a manually dispatched workflow only when the workflow file
exists on the repository default branch. On 25 October 2026, the reviewed
`.github/workflows/trusted-scripted-offline-session-hold.yml` exists on
`refactor/post-prof-plan-contracts-20261021` but not on `main`.
Do **not** merge or modify `main` merely to clear this readiness check.
An independently reviewed operator decision is required to register the
workflow on the default branch or to use a separately configured test
repository with new verified repository/owner identity pins.

## Non-billable operator preflight

After independently provisioning the isolated `delegation-private` Linux
self-hosted runner, immutable reviewed source under `/opt/delegation/r5`,
its 0600 configuration, private TLS keys, pinned Engineer Host certificate,
and protected `r5-private-scripted-admission` environment, run locally:

```bash
export DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG=/path/to/owner-protected/scripted-runner.json
node --experimental-strip-types poc/scripts/r5-scripted-dispatch-registration.mjs
```

Run from the installed, reviewed tree. The script first reads the existing
fail-closed private-runner configuration loader. It then queries only the
public GitHub REST API to check that (a) repository/default branch are the
reviewed ones; (b) the pinned source SHA equals the current feature HEAD;
(c) the scripted workflow file is present on **both** main and that branch
with the **same Git blob SHA**; and (d) GitHub reports it as an active
registered workflow. It never dispatches anything, requests an OIDC token,
signs approval, loads a model, sends an API key, or changes a repository.

Exit 1 / `NO-GO` is expected while the default-branch registration is
absent, source SHA differs or GitHub is unreachable. Exit 0 means only
`registration_verified_only_not_r5_go`: do not equate it with a working
mTLS network, a live Coordinator, a human Ed25519 approval or a successful
real Gitea/Docker/Gateway/Rust/OPA DAG. Neither this probe nor its mocked
unit tests can establish that evidence.

## Required later evidence

Record the exact branch SHA and 5/5 cumulative offline CI on that same SHA.
Separately document the real private self-hosted runner, persistent Engineer
service running the **original** Planning Coordinator, real Engineer-signed
plan, GitHub OIDC/mTLS first-attempt admission, approved scripted A2A DAG,
actual Gitea/Docker/Runner acceptance, confirmed Gateway + Rust revocation,
and matching terminal `completed_verified` for the selected job.

Do not use the cold-recovery-only service CLI as evidence of active Planning.
Do not fabricate Engineer consent, downgrade to `push` or mutate `main`.
A paid Gemini workflow remains forbidden without separate explicit consent.
