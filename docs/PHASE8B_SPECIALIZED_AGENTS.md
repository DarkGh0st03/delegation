# Phase 8B — Specialized Agent profiles

Phase 8B applies the frozen least-privilege role design to the shared Phase 8A
runtime. Prompt text describes intended scope, but it is not an authorization
mechanism. Effective enforcement remains:

`Delegation Credential -> Gateway -> DelegationVerifier -> OPA -> provider`

## Backend Development Agent

Model-visible tools:

- `read_file`
- `update_file`

Writable existing files:

- `packages/shared/src/account-status.ts`
- `apps/backend/src/users/user.service.ts`
- `apps/backend/src/users/user.controller.ts`
- `apps/backend/src/users/user.routes.ts`

Read-only context:

- `apps/backend/src/users/user.model.ts`
- `apps/backend/src/users/user.repository.ts`
- `packages/shared/src/user-contracts.ts`
- `apps/backend/src/app.ts`

## Frontend Development Agent

Model-visible tools:

- `read_file`
- `update_file`

Writable existing files:

- `apps/frontend/src/api/users-api.ts`
- `apps/frontend/src/pages/UserDetailPage.tsx`
- `apps/frontend/src/styles.css`

Read-only context:

- `packages/shared/src/account-status.ts`
- `packages/shared/src/user-contracts.ts`
- `apps/frontend/src/components/UserStatusBadge.tsx`

## Software Testing Agent

Model-visible tools:

- `read_file`
- `update_file`
- `create_file`
- `run_tests`

Writable existing tests:

- `tests/backend/user.service.test.ts`
- `tests/backend/user.routes.test.ts`
- `tests/frontend/UserDetailPage.test.tsx`

Creatable test:

- `tests/e2e/account-suspension.spec.ts`

Read-only application/test context:

- `tests/e2e/user-profile.spec.ts`
- `packages/shared/src/account-status.ts`
- `packages/shared/src/user-contracts.ts`
- `apps/backend/src/users/user.model.ts`
- `apps/backend/src/users/user.repository.ts`
- `apps/backend/src/users/user.service.ts`
- `apps/backend/src/users/user.controller.ts`
- `apps/backend/src/users/user.routes.ts`
- `apps/frontend/src/api/users-api.ts`
- `apps/frontend/src/pages/UserDetailPage.tsx`
- `apps/frontend/src/styles.css`
- `apps/frontend/src/components/UserStatusBadge.tsx`

The Test Agent additionally receives `RunTests` on
`feature/account-suspension` when the corresponding Delegation Credential is
issued.

## Validation rule

Phase 8B is not complete merely because the prompts contain these paths. The
checkpoint must prove with real Adapter/Gateway/Gitea execution that:

1. each role can complete one permitted sandbox task;
2. Backend cannot mutate Frontend resources;
3. Frontend cannot mutate Backend resources;
4. Test cannot mutate application source;
5. denial is produced by delegated authorization rather than prompt logic.
