# R130 — Authenticated root VP signing bridge (no automatic admission)

30 October 2026 — branch refactor/post-prof-plan-contracts-20261021.

R129 built a fresh-challenge Rust VP verifier on the Gateway side and
a separately authenticated native Rust signing port owned by the
Orchestrator. R130 connects these through a private, 0600 Unix socket,
with a separate owner-only 32-byte HMAC secret. Neither the signing
bearer nor full credentials cross the IPC channel.

Every request authenticates a timestamp, transport nonce and exact body
digest with domain-separated HMAC-SHA256. The server pins the original
root credential ID, Gateway audience and original grant set. It rejects
untrusted or extra fields, grant expansion, duplicate grants, wrong
identities and replayed challenges. The 256-bit Gateway challenge is
consumed BEFORE invoking the Rust Adapter. The client transports only
the signed VP back to the R129 Gateway Rust proof verifier. No agent,
model, public HTTP, MCP or A2A tool can call this private channel.

Four regression tests cover the full owner-only socket exchange into
the independent Gateway verification port, distinct unpredictable
challenges, replay and grant escalations, missing/incorrect HMAC and
listener collision. The test verifier/Adapter effects are scripted, so
this is NOT the live Rust/EVM multi-process E2E.

The socket is not yet bootstrapped by the real persistent Engineer Host.
A verified root VP does NOT grant permission to admit the R125 repair
epoch, create attenuated child DCs or execute tools. The live Gateway
must still independently hold a source-of-truth original-root-bound
operational intake and current session quiescence. No paid Gemini and
no changes to main.
