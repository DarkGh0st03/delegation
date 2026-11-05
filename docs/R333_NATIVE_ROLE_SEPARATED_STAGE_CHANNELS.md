# R333 — three separate HMAC stage sockets for Backend/Frontend/Test

The successful native R331 path remains unchanged. R333 adds an
explicit alternative to the previous shared agent→owner HMAC staging
socket: `stageChannels` supplies exactly three role-pinned
`{socketPath,secretFile}` channels, one per Backend/Frontend/Test.
Each of the three trusted staging HTTP-over-Unix servers binds an
`expectedRole` to its shared owner registry. The per-Task role comes
only from Coordinator + native issued Child + Gateway admission
through R332 `TrustedAuthorityOnlyRemoteEffectOwner`.

All six stage/bind socket paths and all six HMAC keys must be unique.
A correctly authenticated Frontend caller cannot reserve a Backend
Task or consume its one-shot stage, nor can a Frontend stage key
authenticate the Backend staging server. There remains ONE authority
root, ONE trusted owner and ONE staging registry; the extension
is NOT three independent Software Engineer approvals.

For backward compatibility, the single shared stage socket still
works with the R322–R331 trusted owner factories, and mixed three-role
binding/single-stage configurations are supported only for those
historical tests. A `stageChannels` configuration requires
`agentBindingChannels`: per-role stage-only with a shared binder
would undermine role separation. Role-staging-only tests exercise
actual HMAC Unix transports and negative cross-role attempts.

The optional isolated R333 native workflow uses real local Rust/EVM
status, OPA, Gitea CAS, all three scripted Google ADK/A2A agents,
and independent Docker Runner evidence. It must be marked PASS
only when its own pinned GitHub Actions run completes. The models
are offline scripted, so `delegated_functional_edits=0`
and automatic functional code generation remains UNPROVEN.

R333 does not yet cryptographically authenticate remote A2A TCP
callers; Agent Cards are discovery metadata only. D1 recovery under
the original permission ceiling remains a separate gate. No paid AI,
PR merge or `main` mutation.
