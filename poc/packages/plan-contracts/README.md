# Shared contracts

Dependency-free modules used by the console, the Orchestrator, the agents and
the Gateway:

- `src/agent-roles.mjs` — the single registry of specialist roles (Backend,
  Frontend, Documentation, Data, DevOps, Test), their labels and skills;
- `src/project-profile.mjs` — the Engineer's project test profile (image,
  ordered phases, test folders) and its SHA-256 digest;
- `src/authority-only-approval.mjs` — the unsigned permission proposal and
  the Engineer's signed approval of a subset of it;
- `src/authorization-envelope.mjs` — shape of the maximum delegation scope
  (repository, work branch, canonical resource/operation pairs);
- `src/gitea-permission-containment.mjs` — path containment rules (e.g. the
  Test agent writes only project test sources);
- `src/planning-limits.mjs` — Planning bounds (preliminary Root lifetime,
  adaptive source observations).

Tests: `npm --prefix poc run plan-contracts:test`.
