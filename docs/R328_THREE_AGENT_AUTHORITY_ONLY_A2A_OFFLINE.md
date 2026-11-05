# R328 — three-role A2A SDK + ADK with one authority-only owner

## Implementation
R324's owner bootstrap previously had one `agentBindingSocketPath` and
one bind secret, which could only reach a single A2A process. R328 adds
an explicit `agentBindingChannels` map with **exactly** Backend,
Frontend and Test. All three per-role Unix sockets and bind secrets,
plus the owner's single stage socket/secret, must have distinct private
absolute paths, and all four HMAC keys must be different. The HMAC
bind server on each actual A2A agent can pin `expectedRole` to reject
an owner Task intended for another Agent before registering its Child.

The trusted Coordinator's registered role selects the outbound owner
binding client, and the fence uses the **same** pinned role client.
The original `TrustedOwnerEffectStagingRegistry`, authority root and
Gateway Task ledger remain shared. There is no cloned Engineer
approval, no model-controlled binder routing, and no new permission
to write or test.

The previous single-channel owner bootstrap remains supported for
legacy offline tests. Real three-role deployments must provision
`agentBindingChannels`. The owner stage HMAC key is shared by
the roles in this revision; it does not by itself authenticate the
role of a staging caller. The native PreparedRequestRecord/Child
checks remain authoritative, and role-isolated staging HMACs and
remote HTTP caller identity are separate security review items.

## Offline integration proof
The new `trusted-authority-only-three-role-sdk-a2a.test.ts` starts
three **real A2A HTTP SDK role servers**, each with its own scripted
Google ADK `LlmAgent/Runner`, three distinct HMAC owner→agent binding
sockets, and a common owner-owned staging socket. It drives sequential
Backend `update_file`, Frontend `update_file`, and Test
`run_tests` Tasks through the protected SDK, validates that a wrong
role-binding command is rejected, checks exact native-style Child/Task
and permission scope, one-shot staging per Task, no signing tokens in
model-visible requests, and **separate independent Gateway completion
observation** after each untrusted A2A report.

The root, native-issued Child, HTTP Gateway Prepare/Execute, VP signer,
Gitea commits, Docker result and completion observer are deliberately
**simulated** in this offline test. They cannot establish a native
EVM/OPA/Gitea/Docker PASS, autonomous Gemini plan generation or real
D1 recovery. A green Fast CI on the exact R328 SHA is required.

## Next gate
Replace these fixture collaborators with native authority-only
Coordinator/Child/Gateway from the earlier disposable Gitea/Rust/EVM/
OPA/Docker test, using the new three-role SDK/ADK transport. Confirm
real provider write receipts, pinned Test HEAD, revoked Child rejection,
private stage caller attribution and D1 recovery before any paid
Gemini pilot or merge. `main` remains unchanged.
