# R332 — Fail-closed role attribution for owner staging IPC

This is a prerequisite for independent role-keyed agent→owner stage sockets.
The previous R322 single owner stage socket accepted a valid HMAC without
knowing which of Backend, Frontend or Test originated the call. Although it
still required the original prepared Gateway request/Task binding and its
own one-shot provider journal, staging lacked cross-role caller attribution.

R332 extends `TrustedOwnerEffectStagingRegistry.bindTask` with an
optional **trusted owner-only** role, and role-isolated staging servers with
`expectedRole`. Each stage operation checks the original owner role
before consuming its one-shot reservation. A valid Frontend stage HMAC
on a Frontend-only socket cannot reserve a Backend Task. An untagged
legacy Task also fails on a strict role socket, and replay is denied.
`TrustedAuthorityOnlyRemoteEffectOwner` now obtains role from the
original Coordinator/Child/Gateway receipt, never A2A/model input.

The existing shared staging server has no role selector and retains the
R322/R331 compatibility behavior; **R332 is not yet full role isolation
in native deployment**. Next is to provision three independent stage
socket/secret pairs in the bootstrap and agent startup so the strict
socket variants are actually used by all roles, with distinct HMAC
keys for each stage and each bind channel. Old signed Task/Child
credentials, per-Task Gateway authorization and OPA are unchanged.

Offline tests use actual Unix HTTP servers and HMAC clients. No native
Rust/EVM/Gitea/Docker or paid Gemini is started by the new tests.
