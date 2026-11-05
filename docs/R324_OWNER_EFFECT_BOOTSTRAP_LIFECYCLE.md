# R324 — trusted authority-only remote effect owner lifecycle

## Concrete implementation
A new `TrustedAuthorityOnlyRemoteEffectBootstrap.start()` wires the
protected Orchestrator owner to R322's real Unix effect-staging server
and authenticated owner→agent bind client. It accepts **only
already-activated, in-process** Engineer Coordinator, native Child
issuer and Gateway admissions. The trusted caller supplies immutable
task IDs and an existing owner-bound one-shot
`TrustedAuthorityOnlyEffectStager`-compatible port, never JSON from
ADK/A2A. It rejects equal bind/stage HMAC secrets, shared socket paths
and invalid private files before it opens the owner stage socket.

`dispatchApprovedTask()` uses R323 to re-check the signed Engineer
root, Coordinator Task, native-issued Child and independent Gateway
enrollment before binding the Task remotely. Only then is the trusted
caller's A2A dispatch closure invoked. Any completion, failure,
ambiguous network outcome or cancellation retires the owner staging
capability before awaiting a remote fence acknowledgement. A shutdown
fences the entire owner registry synchronously, then closes the socket.

An additional R323 fix closes an exception path: if the Engineer root
is revoked during a successful remote bind, the owner stager is now
fenced even when the root lookup itself throws, not only when it
returns a mismatching receipt.

## Proof and limits
Free offline tests construct a fake active root/Child/Gateway authority
*only for testing* and exercise real separate Unix IPC sockets with
HMAC, remote Task registration, private request forwarding, replay
denial, missing remote agent, forged Child, shutdown during an A2A
operation and identical-key rejection. This is NOT evidence of
independent native Rust Root/Child signing, remote A2A identity,
live Gitea CAS or a successful Gemini-generated Task.

The existing canonical Orchestrator production launcher still uses
legacy paths and must be wired to real Engineer activation, Child
issuance, Gateway enrollment and the new bootstrap. Do not assume
running this module alone starts a fully operational ADK pipeline;
it intentionally has no public CLI or auto-approval.

No new paid model calls, Docker native suite or merge authorized by
this change. Follow up with one selected end-to-end integration gate
with the real native services after the canonical owner is wired.
