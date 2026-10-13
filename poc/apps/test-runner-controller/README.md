# Controlled Test Runner Controller

Phase 6A, Phase 6B and Phase 6C are complete.

The Runner accepts only a structured request containing:

- `request_id`;
- the controlled repository URI;
- `feature/account-suspension`;
- an exact 40-character commit SHA;
- the fixed `poc-default` profile.

Unexpected fields are rejected. There is no caller-controlled `command`, `shell`, `script`, or equivalent execution field.

`POST /v1/runs` requires the internal Gateway bearer credential. The Runner verifies that the controlled branch still points to the requested SHA, downloads that exact revision from Gitea, copies it into an ephemeral Docker container and executes the fixed project pipeline:

`dependency install -> typecheck -> backend tests -> frontend tests -> build -> Playwright E2E`

The backend and frontend services are started deterministically for browser testing and checked for readiness before Playwright runs. The execution container is destroyed after each run.

## Researcher-owned acceptance

Normal Runner execution also evaluates the independent suite under `poc/runner/acceptance/`.

That directory belongs to the thesis/researcher side, not to the protected `iam-console-poc` repository. It is mounted into the ephemeral execution container as a read-only bind mount, so application code and specialized Agents cannot modify the acceptance source.

The minimum Account Suspension criteria cover:

- `ACTIVE -> SUSPENDED`;
- `SUSPENDED -> ACTIVE`;
- HTTP 409 for repeated suspend/reactivate transitions;
- frontend status and Suspend/Reactivate action behavior.

Runner responses expose the project-owned result and independent verdict separately through `project_tests` and `researcher_acceptance`. The overall Runner status includes both.

The frozen baseline intentionally fails researcher acceptance because Account Suspension is not implemented yet. This is expected and proves that the independent suite detects the missing feature while the baseline project tests remain green.

Run Runner tests with:

```bash
npm --prefix poc run test -w @thesis/test-runner-controller
```

Validated Phase 6C code checkpoint: `2956a9c5c36eff0203d8efa3c178dc25e69a3cd7`.

GitHub Actions run `37317272950` passed the new Phase 6C acceptance smoke together with all Runner, Gateway, Gitea, OPA and infrastructure regressions.

## Trusted security CI commit status publisher — distinct from Agent execution

`src/trusted-security-ci.ts` is a fail-closed **exact-SHA** status publisher.
The operator-owned `scripts/trusted-security-ci.mjs` constructs
`IsolatedDockerRunnerExecutor` directly and FORCES
`acceptance_enabled:true`, binding the researcher-owned acceptance suite
from `poc/runner/acceptance/` read-only. It executes the fixed six project
phases and then independent acceptance; missing/skipped/inconsistent phases
can NEVER produce `success`.

The service posts `pending` before the real Docker run. After strict
result and unchanged-head verification it posts `success` or `failure` to
the immutable exact SHA under the fixed Gitea context
`thesis/security-pipeline`. If any run/verification step throws after
`pending`, it attempts `error`; absent status updates remain pending.
Both outcomes block the separate human merge-readiness gate.
No reviews, pull requests, or merges are created by this CI tool.

**Credentials and deployment:** Two Gitea credentials are required:
one read-only for the Runner and one protected status-publishing identity.
The publisher also checks the latter's immutable numeric Gitea user ID and
login. These secrets must NOT be shared with Google ADK, MCP private workers
or other Agent processes. The status-publisher identity's repository write
permission must be controlled separately from the Software Engineer's
review authority. Gitea branch protection MUST independently block
unreviewed merges and administrator bypass.

The CLI is NOT a local default smoke. **Do not run against persistent Gitea**
until the dedicated CI service account, approval policy and secret handling
have been configured and reviewed. It requires these operator-provided
variables, not agent/tool-call arguments:

- `SECURITY_CI_GITEA_URL` (HTTPS or local-loopback HTTP)
- `SECURITY_CI_GITEA_READ_TOKEN` (read-only repository)
- `SECURITY_CI_GITEA_STATUS_TOKEN` (separate trusted CI identity)
- `SECURITY_CI_ACTOR_ID` and `SECURITY_CI_ACTOR_LOGIN` (pinned Gitea ID/login)
- `SECURITY_CI_EXPECTED_SHA` (exact 40-char commit from trusted orchestrator)
- Optional `SECURITY_CI_DOCKER_IMAGE` (must already exist; never auto-pulls)

The project baseline is expected to FAIL researcher acceptance, so do not
expect a green status until Account Suspension is fully implemented.
First run the offline tests:
`npm --prefix poc run test -w @thesis/test-runner-controller`.

The real positive acceptance case, external event trigger, and a protected
exact-SHA merge endpoint remain separate milestones.

## Isolated real Docker security CI negative smoke (safe default)

Before configuring the privileged CI CLI against a persistent Gitea, run
`security-ci:isolated-negative-smoke`. It creates a **temporary, volume-free
Gitea Docker container**, private org and repo, a separate read-only Runner
identity and an isolated trusted CI status publisher identity. It does not
touch the persistent Gitea container, active branches, GitHub, MCP or Rust.

It constructs the real `IsolatedDockerRunnerExecutor` with the immutable
researcher acceptance suite **enabled**, requests the exact feature SHA,
and intentionally fails `npm ci` because the fixture lacks a lockfile.
The actual Gitea commit must receive precisely `pending` and `failure`
statuses from the isolated trusted CI account under
`thesis/security-pipeline`. It asserts there are zero success statuses,
zero PRs, zero merges, and untouched main/feature SHAs. Both temporary
containers and their logs are removed afterwards.

With Docker Desktop running and cached Gitea + Node images:

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc run security-ci:isolated-negative-smoke -w @thesis/test-runner-controller
```

Success must include
`"event":"trusted_security_ci_real_docker_negative_smoke"`,
`"status":"PASS"` and `"gitea_statuses":["pending","failure"]`.
This is intentionally NOT a green acceptance test, and cannot approve or
merge any PR.

## Real POSITIVE exact-SHA acceptance on disposable Gitea

`security-ci:isolated-positive-smoke` is intentionally separate from
the negative smoke and the three-agent A2A flow. It first clones the
**immutable public** `DarkGh0st03/iam-console-poc` branch
`baseline-before-account-suspension`, rejecting any SHA different from
`405748b1e77992b6bd8630a3ab6f990658d32f6b`.
It then pushes that precise main to a newly created no-volume Gitea and
commits the **eleven exact existing Phase 10B reference Account Suspension
source/test files** on `feature/account-suspension`.

Only the copied feature branch is changed. The original GitHub repo,
persistent Gitea, and immutable researcher acceptance source are untouched.
The reference fixture is deterministic, not generated by Gemini/ADK: this
is a direct test of the actual Docker Runner/CI/PASS evidence chain, **not**
yet an A2A multi-agent positive workflow.

The actual `IsolatedDockerRunnerExecutor` runs all six fixed application
phases then executes the independent researcher Playwright acceptance
mounted read-only from `poc/runner/acceptance`. The independent
`TrustedGiteaSecurityCi` service account publishes the exact SHA's
`thesis/security-pipeline` context: `pending` before the run, and
`success` ONLY if all application phases and researcher acceptance pass.
There are no fake PASS results, reviews, PRs, or merges.

Docker Desktop, cached Gitea + `node:22.15.0-bookworm` images, git
and outbound network access to the public GitHub baseline, plus
`poc/infra/.env`, are required. Playwright and dependency downloads
can take several minutes and require free disk space. Never run
`docker compose down -v` or reset the persistent Gitea.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc run security-ci:isolated-positive-smoke -w @thesis/test-runner-controller
```

Expected event `trusted_security_ci_real_docker_positive_acceptance`
with `status:"PASS"`, `project_tests:"pass"`,
`researcher_acceptance:"pass"`, and
`gitea_statuses:["pending","success"]`.
If any real phase fails, the smoke must not claim success: it emits a
sanitized list of the Runner phase statuses. If the positive check fails,
the independent acceptance is NOT considered verified.

A later dedicated smoke will replay these eleven modifications through
actual three-role A2A + shared MCP + Rust/OPA rather than the trusted
fixture builder; neither test permits automatic merge.
