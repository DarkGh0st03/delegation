# R328 — distinct A2A role binding channels, shared owner authority

## Observed limitation
The previous R324 owner accepted one Unix Task-binding socket: that
can bind Backend only in a deployment with three independently
started A2A agents. Reusing the same binding channel across processes
would collapse the intended per-role trusted boundary.

## Implemented change
`TrustedAuthorityOnlyRemoteEffectBootstrap.start` now accepts
`agentBindingChannels` with *exactly* Backend, Frontend and Test
socket/secret pairs. The stage socket/secret, three bind sockets and
three bind secrets must all be separate absolute private paths. All
four HMAC keys are loaded and compared before the owner opens its
staging listener; key reuse is a startup NO-GO.

The same `TrustedOwnerEffectStagingRegistry` and owner-held stage
listener serve all three tasks; there are **not three independent
Software Engineer approvals or three authority roots**.
`TrustedAuthorityOnlyRemoteEffectOwner` chooses the outbound bind
channel exclusively from the validated Coordinator Task's signed
`agent_id`, never an A2A request. A Task's outbound fence returns on
that same pinned channel. Historical single-channel test startup
remains supported for compatibility; multi-role startup must opt in
explicitly.

This establishes per-role binding-channel isolation, not yet per-role
isolation of the agent->owner stage HMAC key (which the shared owner
stage socket uses). The real owner effect stager still enforces the
original prepared request and native Child. R328 native full-stack
test and independent A2A caller identity remain future gates.
No Gemini/paid calls and no mutation to `main`.
