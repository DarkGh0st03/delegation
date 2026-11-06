# R342 — Issue native Rust D1 Child and independently enroll it in Gateway

R341 admitted exactly one first recovery Task from a real, independently
verified Test FAIL under the unchanged Engineer-signed permission ceiling.
Its Fast CI passed on the checkpoint SHA.

R342 makes the NEXT owner-only admission step reachable. It reopens the
original private R341 O_EXCL journal record, verifies the exact original
Runner Test/Child/authority binding, new Task ID/epoch and approved
permission digest. It independently re-runs the R340 native failed
Gateway flight + Runner HMAC/Gitea observation for that *same* new
Task subset.

The existing Gateway binds the fresh Coordinator Task, then the
existing trusted Rust-native Child issuer mints a **new** revocable
Child for that Task (not a new root) with owner-generated credential
ID and distinct status allocation. Gateway independently enrolls
the exact Child with its own durable Task and Child journals. The
returned acknowledgement never contains the signed credential itself.

This is not an A2A edit, a provider effect, a successful Test Task,
a recovered commit or a new Engineer approval. All issuer/credential
requests go to the existing native Rust port; MCP remains solely for
Orchestrator/Agent crypto usage, not Software Engineer/Gateway direct
Core functions. The old failed Test remains incomplete and no
recovery runner launch is implied.

New focused tests exercise the original one-shot journal,
coordinator-bound Gateway Task, Child issuance/enrollment sequencing
and denial of forged source receipts/status reuse. These tests use
isolated fake collaborator methods; **native Rust/EVM/OPA/Gitea/Docker
D1 replay remains to be proven separately**. No paid AI and no main
mutation.
