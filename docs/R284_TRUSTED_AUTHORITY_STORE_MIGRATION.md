# R284 — trusted authority-only receipt reader

**Parent:** R283 `12f0131a71cbd6cb90ebead54acdcb2cda3f1beb`  
**Roadmap:** R0 audit complete; R1 incremental, not yet cut over.

The new `SignedAuthorityOnlyFileStore` accepts a trusted session ID,
reads an owner-only receipt from a fixed protected directory using
`O_NOFOLLOW`, checks its file metadata, parses bounded JSON and verifies
the Engineer's R283 authority-only Ed25519 signature against **independently
pinned public keys**. It rejects an expired receipt, mismatched filename
session, wrong signer/key, changed grants, excessive file size and insecure
directory/file mode.

The store never accepts a file path, key, receipt, Task, DAG or permission
from Gemini/A2A/MCP. It does not act as a normal model FunctionTool.

The signed approval stores in the existing production-style PoC are
unchanged and still authenticate the *legacy signed-DAG receipt*. The
new store is deliberately a **distinct interface** and cannot be
substituted for `TrustedApprovalStore` until Gateway, Engineer and
Coordinator have an audited authority-only execution path.

## Test gate

Fast CI's plan-contract step now runs the R284 store's **offline**
security tests with Node 22 type stripping. These use temporary
disposable directories, fresh test Ed25519 keys and no Gemini model
calls, remote Gitea, Anvil or real credentials.

## Security work that remains before R1 is complete

1. Durable one-use session activation and replay/nonce fencing for
   authority receipts; expiration alone does not prevent root replay.
2. Bind Engineer operational Rust root issuance to the verified
   authority-only record after *confirmed* preliminary DC revocation.
3. Enforce every dynamically assigned Task via a trusted operational
   session and the independent Rust/Gateway/OPA checks.
4. Keep initial approval and adaptive execution separate; no actor may
   reinterpret a signed authority grant as approval of arbitrary goals.
5. R2/R3 implement and test hierarchical resource scopes before enabling
   root permission inheritance from directory grants.

No old security check has been removed. No new human approval has
been simulated and no paid Gemini pilot is authorized by R284.
