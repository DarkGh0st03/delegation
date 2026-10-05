# Cloud Access Gateway

The Gateway is the only component that will translate Agent tool requests into protected repository/test operations.

## Phase 3A scope

This checkpoint implements the authorization **prepare** side only:

- strict request validation;
- canonical Gitea ResourceUri construction;
- deterministic tool -> Operation mapping;
- rejection of path traversal and malformed branch names;
- rejection of caller-supplied ResourceUri / Operation / Permission values;
- one-time request id and challenge generation;
- request fingerprinting and in-memory prepared-request storage;
- first audit event and `prepare_ms` measurement.

Frozen canonical namespace:

```text
gitea://gitea.local/thesis/iam-console-poc
gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension
gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/<path>
```

The Agent supplies only a tool name and tool arguments. It never supplies a ResourceUri or Operation.

Phase 3A deliberately performs no Delegation Adapter verification, no OPA decision and no Gitea mutation. Those boundaries are layered afterwards.

Run:

```bash
npm --prefix poc run gateway:test
```


## Phase 3B — verify then mock-execute

The Gateway now exposes:

- `POST /v1/authorization/prepare`;
- `POST /v1/authorization/execute`;
- `GET /health`.

`execute` accepts only `request_id` and a signed VP. The Gateway retrieves role, challenge, audience, tool arguments and required permission from the prepared server-side record; the caller cannot replace them during execution.

The prepared request is marked consumed before the asynchronous verifier call. Verification rejection, verifier outage and expiration all fail closed, and a failed request cannot be replayed with the same challenge.

At this phase successful authorization reaches only `MockExecutor`, which reports `performed: false`. No Gitea mutation or test execution exists yet. OPA is intentionally inserted in Phase 4 before any real provider connection in Phase 5.

Structured audit output includes request/task identifiers, canonical resource + operation, decision, VP size, chain depth, disclosed permission count and timing fields. Full VP and source-file contents are never written to the audit event.


## Phase 4 — contextual policy before provider execution

OPA is evaluated only after successful delegated-authority verification. The Gateway builds the policy input from server-side request state plus the structured `VerifiedDelegation`; Agents do not supply policy authority fields.

The runtime ordering is:

```text
prepare -> signed VP -> DelegationVerifier -> OPA -> executor
```

OPA remains contextual: it constrains branch, repository, PR direction, test profile and automated merge. Exact file-level authority remains in the Delegation Credential.

## Phase 5A — read-only Gitea provider

The Gateway can now reach the protected Gitea repository for real `read_file` operations.

In `gitea-readonly` mode the path is:

```text
prepare
  -> signed VP
  -> DelegationVerifier
  -> OPA
  -> GiteaReadOnlyExecutor
  -> protected Gitea repository
```

The provider resolves the requested branch to an immutable commit SHA first, then reads the requested file using that SHA as the Gitea `ref`. The result contains:

- branch revision;
- Git blob SHA;
- last commit SHA affecting the file;
- size and UTF-8 encoding;
- file content.

This avoids reading against a moving branch between authorization and provider access and supplies the metadata required for safe conditional writes in Phase 5B.

The Gitea token exists only in Gateway runtime configuration. It is never included in Agent inputs, Delegation Credentials, Verifiable Presentations, OPA inputs, or audit events.

Phase 5A is deliberately read-only. Even if a valid Delegation Credential and OPA both allow a mutation request, the read-only provider returns `provider_operation_unavailable` before any mutation reaches Gitea.

Relevant runtime configuration:

```text
GATEWAY_PROVIDER_MODE=gitea-readonly
GITEA_BASE_URL=...
GITEA_GATEWAY_TOKEN=...
GITEA_TIMEOUT_MS=3000
```

The real CI smoke test proves both a successful protected Gitea read and a blocked mutation, then reads the file again to confirm the repository revision and contents are unchanged.
