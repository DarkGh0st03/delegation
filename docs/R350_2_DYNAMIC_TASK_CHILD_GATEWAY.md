# R350.2 — same-session dynamic Task, Rust Child and Gateway enrollment

Continuation of R350.1. The private owner returned by `admitOperationalExecution` now offers `stageTask`. It derives immutable session, repository revision, branch, requirement hash, Engineer root and trusted Agent Card identity from the live R349 Coordinator — never from ADK or client-supplied authority fields. The caller may provide a task choice, exact subset of requested permissions, a unique runtime Task ID and independently prepared Child identity/status metadata; all are validated by the existing trusted components.

The sequence is one continuous session: Coordinator `registerTask` → independent Gateway `bindTrustedTask` → Rust-native `issueForRegisteredTask` → Gateway `enrollTrustedIssuedChild`. Each phase persists its existing one-shot record and verifies the original root. An invalid or ambiguous outcome fences further staging and retires the operational Engineer root; shutdown waits for in-flight staging.

The result is `owner_child_enrolled_no_provider_execution`, and `gateway_execution_authorized: false`. It grants no runtime provider effect and does not signal a completed ADK/A2A Task or Docker PASS. The signed Child is held exclusively by the existing trusted issuer for a subsequent protected A2A owner handoff, not returned to a model, GUI or public endpoint.

Targeted tests use the real Coordinator/Gateway/issuer classes and durable ledgers but a scripted ADK Planner, offline root and native Child signing fixtures. They verify same-root issuance, subset enforcement, anti-replay, malformed native Child response and revocation. They do not demonstrate live Rust/EVM or paid Gemini.

Next increment: bind this exact owner handle to `startTrustedAuthorityOnlySdkA2AOwner` with owner-provisioned private IPC, real A2A endpoints and independent Gateway completion; then integrate the persistent service crash reconciliation and native full-chain validation. No main merge or paid inference.
