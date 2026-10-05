# OPA workflow policy — Phase 4A

This directory contains the contextual workflow policy evaluated **after** successful Delegation Credential verification and **before** any protected provider or test-runner call.

The Delegation Credential remains responsible for exact delegated authority (`ResourceUri + Operation`). Rego does not duplicate the file-by-file permission matrix. OPA adds workflow constraints that are independent of the LLM and of the credential proof.

## Input contract

Phase 4B will construct the OPA input entirely from Gateway-owned state after `DelegationVerifier` succeeds:

```json
{
  "request_id": "req-...",
  "task_id": "task-...",
  "agent_role": "backend",
  "tool": "update_file",
  "arguments": {
    "branch": "feature/account-suspension",
    "path": "apps/backend/src/users/user.service.ts",
    "content": "..."
  },
  "required_permission": {
    "resource": "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
    "operation": "update_file"
  },
  "repository": {
    "authority": "gitea.local",
    "owner": "thesis",
    "repository": "iam-console-poc"
  },
  "verified_delegation": {
    "presenter_id": "did:thesis:backend-agent",
    "credential_id": "urn:credential:backend",
    "issuer_id": "did:thesis:orchestrator",
    "hierarchy_depth": 1
  }
}
```

The caller does not submit this policy document. The Gateway derives it from its prepared request, repository configuration and the structured `VerifiedDelegation` returned by the Rust Adapter.

## Frozen contextual rules

The policy is default-deny and currently permits only:

- `read_file`, `update_file` and `create_file` on `feature/account-suspension`;
- `create_branch` only for `main -> feature/account-suspension`;
- `create_pull_request` only for `feature/account-suspension -> main`;
- `run_tests` only on `feature/account-suspension` with the fixed `poc-default` profile.

Consequences:

- no file operation on `main`;
- no alternate feature branch;
- no reverse/alternate Pull Request direction;
- no arbitrary test profile;
- `merge_pull_request` is denied by default;
- an uncontrolled repository is denied;
- missing verified-delegation context is denied.

OPA does **not** decide whether Backend may edit a particular backend file or whether Test may update application code. Those exact permissions remain in the Delegation Credential and are enforced by the Rust verifier.

## Policy query

Phase 4B will query:

```text
data.thesis.gateway.decision
```

which returns:

```json
{
  "allow": true,
  "policy_version": "phase4a-v1"
}
```

## Test locally

Using the pinned OPA container:

```bash
bash poc/scripts/phase4a-policy-test.sh
```

This runs formatting validation and all Rego tests without requiring a host OPA installation.
