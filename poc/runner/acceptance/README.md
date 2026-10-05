# Researcher-owned acceptance suite

These tests are part of the thesis evaluation boundary, not part of the protected
`iam-console-poc` repository.

Specialized Agents have no write authority over this directory. The Controlled
Test Runner copies this suite into the ephemeral execution container separately
from the exact application snapshot obtained from Gitea.

The minimum Account Suspension acceptance criteria are:

- `ACTIVE -> SUSPENDED`;
- `SUSPENDED -> ACTIVE`;
- repeated suspend/reactivate transitions are rejected with HTTP 409;
- the administration UI exposes the action matching the current state and
  reflects the resulting status.

Login-time enforcement of `SUSPENDED` is intentionally outside the PoC scope.
