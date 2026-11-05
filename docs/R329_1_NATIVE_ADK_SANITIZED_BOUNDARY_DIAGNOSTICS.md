# R329.1 — native ADK boundary observability (no secrets)

[Native R329 #42096296744](https://github.com/DarkGh0st03/delegation/actions/runs/42096296744)
failed after the real Backend ADK invoked update_file. The original
tool log only exposed the static category `tool_unavailable` and the
A2A final `task ended without completion`. It did not show whether
Gateway Prepare, the authenticated owner staging port, local Rust
MCP VP or Gateway Execute had rejected the request.

**Correction to the initial investigation:** underscore was already
present in `[A-Za-z0-9._:-]` and not a valid diagnosis. No request
ID parser was changed. R329.1 adds regression coverage proving the
real `req_<UUIDv4>` format is already accepted by the Agent Task,
owner staging Unix and cryptographic MCP challenge validators.

The isolated native scenario now emits one **sanitized** diagnostic
record *only on Backend A2A failure*, with fixed booleans and HTTP
status integers: Gateway Prepare attempted/status, owner stager
attempt/reservation, Gateway Execute attempted/status, native VP
submitted-to-Gateway flag, Gateway's existing bounded static audit
decision/reason and the number of ADK model turns. Only the
exception class name of the owner stager is emitted, never an
exception message, request ID, source path, file text, signed DC,
VP, secrets, tokens or provider response body.

The underlying Tool Client remains fail-closed and cannot retry a
possibly staged or executed effect. This diagnostic changes neither
native authorization rules nor the existing R305 validation workflow.
A fresh native run is required to identify the actual failure stage;
no PASS is claimed. No paid Gemini API call, merge or main mutation.
