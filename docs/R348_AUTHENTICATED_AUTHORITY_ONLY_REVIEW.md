# R348 — authenticated permission-only Engineer review

The authenticated local Engineer server now accepts an explicit `architecture: "authority-only"` owner configuration. Its input is the R347 `AuthorityPlanningCheckpointStore`, pinned session/repository/base/branch/requirement and a live Planning callback. Backend provenance is verified on startup, review and approval; the Engineer signing key is separately pinned and protected. Legacy plan/checkpoint inputs are refused in this mode.

`GET /api/review` (or `/api/authorization`) returns the verified permission-only proposal, proposal digest and server-generated selection IDs. The authenticated UI displays operation/resource scope and hides execution-plan details. The browser submits only selected IDs and explicit digest confirmation, protected by the existing login, session, Host/Origin and CSRF checks. It cannot supply a grant, Task DAG, DID or signing key. `/api/plan` is unavailable in authority-only mode.

Approval selects an exact subset, signs the existing authority-only contract and exclusively persists a bounded owner-private receipt. The receipt is consumable by `SignedAuthorityOnlyFileStore`. A receipt does not itself issue an operational credential. Replays/duplicate decisions and retired or changed Planning inputs fail closed. Rejection uses the existing durable terminal decision and trusted retirement callback.

Legacy callers retain their existing signed-DAG protocol and `/api/plan`; the shared UI uses the explicit review protocol to select its rendering and request fields. The standalone CLI refuses authority-only selection because that mode requires trusted owner assembly. The canonical service launcher and transition from preliminary-root retirement to an independent operational root are still subsequent integration work.

## Verification

- Six local tests pass: real Ed25519 checkpoint and grant verification, actual protected receipt reload, authentication/CSRF/Origin/schema/selection denials, changed and retired checkpoint denial, mixed configuration denial, terminal rejection, and execution of the UI JavaScript against a DOM fixture.
- Local request tests invoke the actual server handler without sockets because this executor forbids socket creation. A separate real loopback HTTP test is enabled in GitHub Actions; its success must be checked there.
- Existing UI contract suite: ten tests pass.
- Both Fast CI and the offline Engineer approval workflow include the new suite alongside existing checks.

No native Docker suite or paid model call is needed for this review boundary. No autonomous feature generation or completed canonical launcher migration is claimed.
