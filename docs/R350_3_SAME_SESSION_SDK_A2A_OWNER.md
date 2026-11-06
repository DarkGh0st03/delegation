# R350.3 — same authority-only root starts canonical SDK A2A Owner

The R349→R350 owner-private execution handle now starts `startTrustedAuthorityOnlySdkA2AOwner` after at least one genuinely registered and enrolled Child Task. The original Coordinator, native Child issuer and Gateway admissions are passed directly from the same private R349/350 session. The caller may supply only three pinned agent A2A endpoints and separate three-role private Unix bind/stage channels (plus bounded polling); it cannot override credentials, root, issuer, Gateway, Task security state, or use legacy one-socket routing.

Startup independently probes the actual A2A Agent Cards, opens protected owner staging channels and connects role-pinned agent bind sockets. Only the trusted owner receives the returned protected A2A dispatch capability. Root retirement fences A2A Owner and closes its staging channels; startup failure retires the operational root rather than downgrading to signed-DAG.

The same-session offline regression starts three actual loopback A2A services and authenticates three real Unix bind sockets with independent HMAC secrets. A scripted ADK Planner, fixture root and fixture native Child response remain, so the test does **not** claim live Rust/Gitea/Docker provider execution or that an A2A Task successfully edited an application. No independent Gateway completion is fabricated.

Next: execute the owner-issued Task using protected A2A and a real Gateway Prepare/VP/OPA/Gitea flight; confirm independent evidence before marking completion. Then integrate the persistent service CLI and orphan-root reconciliation. No Gemini payment or main merge.
