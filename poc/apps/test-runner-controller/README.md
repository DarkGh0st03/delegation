# Controlled Test Runner Controller

Phase 6A defines the internal contract for the Controlled Test Runner. It does **not** execute project commands yet.

The only accepted run request contains:

- `request_id`;
- the controlled repository URI;
- `feature/account-suspension`;
- an exact 40-character commit SHA;
- the fixed `poc-default` profile.

Unexpected fields are rejected. In particular there is no `command`, `shell`, `script`, or equivalent caller-controlled execution field.

`POST /v1/runs` requires the internal Gateway bearer credential. The Phase 6A default executor returns `501 runner_execution_unavailable` after successful contract validation; Phase 6B will replace it with isolated execution pinned to the authorized commit SHA.

The intended pipeline remains fixed by the thesis design:

`dependency install -> typecheck -> backend/frontend tests -> build -> Playwright E2E -> researcher acceptance`.

Run contract tests with:

```bash
npm --prefix poc run runner:test
```
