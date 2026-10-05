# Phase 9A — Deterministic Orchestrator authority templates

Phase 9A separates task decomposition from authority decomposition.

The LLM may select a specialized role/skill later in the workflow, but it never
constructs a Delegation Credential permission array. The runtime resolves the
selection to one frozen template.

## Root authority

The Software Engineer bootstrap CLI issues the root Delegation Credential only
to the Orchestrator.

The root contains exactly the union of:

- `DC_Backend`;
- `DC_Frontend`;
- `DC_Test`;
- Orchestrator `CreateBranch` on the controlled repository;
- Orchestrator `CreatePullRequest` on the controlled repository.

Duplicate permissions are removed deterministically. The validated root contains
30 unique permissions.

No `MergePullRequest`, `CreateCommit`, wildcard repository authority or
generic directory write is included.

## Child templates

Validated child permission counts:

- `DC_Backend`: 12;
- `DC_Frontend`: 9;
- `DC_Test`: 20.

The exact path/operation matrix is encoded in
`poc/packages/orchestrator-runtime/src/permission-templates.ts`.

Canonical ResourceUri generation is tested against the Gateway canonicalization
functions.

## Selection boundary

Accepted selection forms are exactly one of:

- `{ role: "backend" | "frontend" | "test" }`;
- `{ skill: "backend-account-lifecycle" | "frontend-account-lifecycle" | "test-account-lifecycle" }`.

Unexpected fields are rejected. In particular a model-originated
`permissions` field is rejected before any Delegation Adapter request.

The Orchestrator Adapter credential remains internal to the runtime and child
issuance is performed through the identity-bound Orchestrator capability.

## Software Engineer entrypoint

The PoC entrypoint is:

```bash
npm --prefix poc run orchestrator:bootstrap
```

It does not accept a permission list. It always uses
`ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY`.

## Validation

Code checkpoint:

`851ee4fc643112200e2a20f87342ca42c7d843f3`

GitHub Actions run:

`37335879534` — success.

The real Adapter smoke bootstraps the Engineer -> Orchestrator root credential
and issues all three child credentials through the Orchestrator. Their returned
`credentialSubject.per` values exactly match the frozen templates.
