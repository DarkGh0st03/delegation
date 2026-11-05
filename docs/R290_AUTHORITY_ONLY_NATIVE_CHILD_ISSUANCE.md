# R290 — owner-private Child DC issuance tied to authority-only Task/epoch

**Parent:** `5c53d3334644b475fc7405f34b227a08c02ea45b` · **Branch:** `refactor/post-prof-plan-contracts-20261021`.

The Rust native child issuer already exists: `createNativeRustChildCryptographyPort`
uses protected native IPC owned by the Engineer Rust process. R290 adds a
distinct opt-in trusted issuance service and non-retryable durable journal for
permission-only approvals, without modifying the historical signed-DAG path.

`TrustedAuthorityOnlyChildIssuer.issueForRegisteredTask(taskId, parameters)`
obtains the previously admitted immutable Task from the same real Coordinator
instance and checks it against the live signed Engineer grant and operational
root. The caller can choose only new credential identity, status and bounded
validity. Parent root, delegated role and exact permissions come from trusted
state. The Child intent is fsynced to an owner-only journal before any native
IPC call; replay, duplicate credentials or ambiguous native replies fail closed.
The response checks ID, delegatee DID, exact permission set, date and status.

The native port must be explicitly provided with `kind: "rust-native"` in
the trusted owner process. No automatic HTTP Adapter fallback, new signing
keys, public issuance endpoint, MCP tool or generated Gemini call was added.

**Gate status:** This verifies response consistency from native IPC but is
not yet an independent Core Rust VP/status/accumulator attestation on the
new Task. The child receipt is deliberately `gateway_execution_authorized:false`.
Gateway R288/R289 still denies ALL authority-only provider effects.
No issuance is wired into the canonical paid pilot. Offline test uses a
stub of the existing native port, with real signed authority/Coordinator and
real protected journal.

**Next:** R291 — owner-private gateway enrollment of the exact issued Child
credential, verify signed VP through Rust for the exact Task/epoch and
independently evaluate OPA, with terminal deny until completion/replay
fences and real EVM/Gitea/Docker proof are established.
