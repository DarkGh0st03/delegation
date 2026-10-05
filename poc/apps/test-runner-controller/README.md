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
