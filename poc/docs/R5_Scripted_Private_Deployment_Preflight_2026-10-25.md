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

The immutable `trusted-scripted-offline-session-hold.yml` also invokes
this check as its **first job step**, before the runner requests any
GitHub OIDC token or opens an admission session. The mandatory workflow
step reads only the independently provisioned runner configuration; no
repository checkout, mutable install or model invocation is allowed.

Run from the independently installed and operator-protected tree. The
script reads the existing fail-closed private-runner configuration loader,
then checks the **local** executable installation before querying GitHub:
the runner must be a non-root service account, the checkout, Git metadata,
tracked source files and source directories must be root-owned and not
group/other writable, the source tree must be a real Git checkout with
`HEAD` matching the independent 40-character owner SHA pin, the index
must have no symlinks/gitlinks, and tracked/untracked Git status must be
clean. This guard executes local `/usr/bin/git` and does not authorize a
session. It then queries only the public GitHub REST API to check that (a) repository/default branch are the
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

## Local trust limitations and installation prerequisites

The private operator must install code **outside** the runner's write
permissions, e.g. review and pin the commit before installing in
`/opt/delegation/r5` with owner `root`, mode 0755 or stricter for
directories, and mode 0644/0755 for tracked files. Use a separate
non-root `delegation-private` runner service identity. Do not grant
that identity sudo, Docker daemon control or source-write permissions.
If deployment dependencies are needed, install/pin them independently;
ignored files such as `node_modules` and OS trust cannot be attested
by `git status`. An operator must also check system package provenance,
supply chain, `/usr/bin/git`, Node runtime, Git config, runner isolation,
and the entire dependency tree. A clean root-owned local Git checkout
is a **defence in depth**, not a cryptographic proof of runtime purity,
and it does not eliminate TOCTOU against root-level compromise.

The new local guard is called BEFORE the workflow-registration REST check
and therefore before OIDC admission. An installation with the wrong SHA,
a modified tracked file, an untracked source file, a symbolic-link/gitlink
or unsafe ownership/perms is denied. No automatic remediation or mutation
occurs. Even after this preflight passes, the real private mTLS network,
original live Planning host, approved DAG, Gitea/Docker effects and root
revocation remain unproven until an independent operational E2E run.
