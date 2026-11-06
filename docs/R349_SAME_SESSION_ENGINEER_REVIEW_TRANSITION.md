# R349 — same-session permission-only review and root transition

The private owner entry `startOwnerControlledEngineerReviewHost` accepts explicit `architecture: "authority-only"` with a separate `authority` configuration. Unknown architecture and mixed legacy inputs are refused. Existing callers retain the legacy mode. The new path composes the existing authority-only session, read-only ADK Planner, signed backend checkpoint, authenticated Engineer server and dynamic Coordinator.

## Sequence and trust

1. Independently pinned backend signer/context and durable journal instances are checked. The owner provisions the Engineer identity/key, model, Gateway transport, native credential port, revision port and trusted agent-card registry.
2. The authority-only session reserves and issues one preliminary read root. The actual Planning Gateway port now binds directly to this session, its exact snapshot and live preliminary root. Expired/retired authority cannot make subsequent reads. No legacy operational Coordinator is created.
3. The actual ADK Planner produces a permission-only proposal. R347 signs/persists provenance; R348 serves authenticated review and independently signs a selected permission subset. Approval itself leaves the session in Planning.
4. Only the returned private owner handle exposes `activateOperational(root)`. It loads the signed receipt from the same protected directory, rechecks the checkpoint and exact subset/context, then delegates to the existing durable session transition: confirmed Gateway retirement, confirmed native preliminary revocation, independent operational root and independent status entry, within the signed receipt lifetime.
5. The dynamic Coordinator activates under that root with zero registered Tasks. No Gateway admission, Child issuance, agent dispatch or provider execution is implied by this activation.

The same checked receipt reader is used by both session and Coordinator. A correctly signed but foreign branch/proposal cannot be substituted. A missing receipt does not consume the transition. An attempted transition is one-shot; ambiguous retirement/issuance remains failed closed and durable reservations prohibit replay.

Host shutdown fences future activation, waits for an in-flight transition, revokes a new operational root if needed and closes its HTTP listener even on retirement failure. A retained Coordinator loses its live-root proof before asynchronous revocation. Revocation failure is reported, never converted into a successful shutdown.

## Verification and limits

Eleven local tests pass, covering the actual ADK Runner, actual provenance and Engineer signatures, private durable stores, actual HTTP request handler and actual Coordinator. Negatives include missing receipt, mismatched branch, mixed configuration, failed Gateway retirement/native revocation, failed Planning reads, expiry, shutdown failure and concurrent shutdown during native issuance. A twelfth test runs the explicit owner entry over a real loopback HTTP listener in GitHub Actions; local sockets are unavailable.

Credential issuance and Gateway/VP/provider responses in these tests are explicit offline fixtures. This is not a fresh native Rust/EVM/OPA/Gitea proof. Existing Planner and authority-only session suites also pass locally (77 tests). The fast and Engineer CI workflows include the new host suite.

Remaining integration: the persistent JSON-configured service CLI still uses its existing legacy startup/reconciliation; this patch adds an explicit programmatic owner launch path. Wire the returned operational Coordinator to native Gateway admissions and the existing Child/A2A owner bootstrap, then verify the complete new intake-to-execution chain. Crash reservations fail closed; automated orphan-root reconciliation for this new host is not implemented. No paid model call, full native rerun, merge or change to main is part of this checkpoint.
