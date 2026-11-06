# R345 — fresh native Test after D1 repair

Opt-in R345_NATIVE_D1_RETEST extends the R344 native scripted repair.
Only after independent Gateway completion of epoch-4 Backend correction,
the same Coordinator registers epoch-5 Test with dependency on the repair.
A distinct native Rust Child and exact repaired Gitea HEAD bind the new
ADK/A2A Test through role-specific HMAC stage/bind, private crypto MCP,
Gateway Rust/EVM/OPA and a second real Docker Runner execution.

Assertions require project tests and researcher acceptance PASS at the
repaired commit, followed by independent Gateway completion. The original
Test remains incomplete and retains its FAIL receipt; one new PASS receipt
belongs only to the fresh Test. Expected counts: 5 registered Tasks, 4
completed Tasks, 3 CAS writes and 2 Docker calls. Duplicate retest dispatch
must add no Docker call. The original Engineer root is unchanged.

This is a scripted correction of an injected TypeScript error in a preseeded
functional application. It does not attest autonomous functional generation.
The workflow is manual-only and has not been run; source/parser and offline
checks are not native retest evidence. R344 native validation runs first.
