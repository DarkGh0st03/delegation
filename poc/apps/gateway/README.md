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
