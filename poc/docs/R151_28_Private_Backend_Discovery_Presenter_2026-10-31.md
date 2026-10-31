# R151.28 — Private Backend-holder Rust signer for read-only discovery

31 October 2026 — branch `refactor/post-prof-plan-contracts-20261021`.

This incremental port lives in `agent-runtime`, **not** the Orchestrator
or Gateway. The Backend runtime retains its own Rust Adapter caller bearer
(`Backend` has `CreatePresentation`, but not `IssueChild` capability).
The signer pins exactly one acknowledged Child credential ID, Gateway
audience and `(canonical Gitea file URI, read_file)`. Requests with other
credentials, audiences, grants or malformed challenges are rejected before
network I/O. The random Gateway challenge is consumed before native
signing, preventing same-challenge replay after uncertain Adapter results.
A required trusted task-liveness callback and explicit fence deny a result
if the task is cancelled during async signing.

The trusted holder calls the existing Rust Adapter `POST /v1/presentations`
using only its private Backend bearer, and returns only the bounded
`signed_vp`. It never issues or enlarges a Child DC.

**Evidence boundary:** the R151.28 tests use a mocked native Adapter. This
code has NOT yet been wired to a Backend-only private signing IPC server,
Gateway R151.27 verification or Task admission. No source read, planning
continuation, Docker repair PASS, or live Gemini success is claimed.

Next: private authenticated signer IPC with owner-only socket, session and
journal pinning; then independent native Gateway verification, precise
Task admission, and authorized Gitea read. Do not expose the bearer or
this signing operation to Gemini, A2A, public HTTP or MCP. Keep the
R151.27 `not_admitted` semantics until those separate controls exist.
No paid Gemini and no change to `main`.
