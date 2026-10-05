# Controlled Test Runner Controller

Phase 6A and Phase 6B are complete.

The Runner accepts only a structured request containing:

- `request_id`;
- the controlled repository URI;
- `feature/account-suspension`;
- an exact 40-character commit SHA;
- the fixed `poc-default` profile.

Unexpected fields are rejected. There is no caller-controlled `command`, `shell`, `script`, or equivalent execution field.

`POST /v1/runs` requires the internal Gateway bearer credential. The Runner verifies that the controlled branch still points to the requested SHA, downloads that exact revision from Gitea, copies it into an ephemeral Docker container and executes a fixed pipeline:

`dependency install -> typecheck -> backend tests -> frontend tests -> build -> Playwright E2E`

The backend and frontend services are started deterministically for the Playwright phase and checked for readiness before the browser tests run. The execution container is destroyed after each run.

The independent researcher-owned acceptance phase is still intentionally reported as `skipped`; it is Phase 6C and lives outside Agent write authority.

Run Runner tests with:

```bash
npm --prefix poc run runner:test
```

The validated Phase 6B CI checkpoint is run `37313384537`, where both the isolated exact-SHA smoke and the full Gateway -> DelegationVerifier -> OPA -> Runner smoke passed.
