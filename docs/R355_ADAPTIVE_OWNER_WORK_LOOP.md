# R355 — Original-owner adaptive work loop

The Engineer owner's `runAdaptiveWorkLoop` now owns repeated ADK decisions,
Task registration, Child issuance/enrollment, protected A2A dispatch and independent
Gateway attestation. No task list or specialist order is supplied to the controller.
The same permission-only Coordinator, private effect stagers, journals and observer
remain the authorization/completion boundaries.

An explicit adaptive mode of the existing ADK proposer returns one validated
`delegate` Task, `ready_for_pr` request or `blocked` reason. Its context contains
current Gitea HEAD and independently completed work with the requested instruction.
The context is rechecked after the model turn. Neither model nor A2A can assert
completion or provide a root, epoch, credential, signer or tested HEAD as authority.
Task choices still pass the original permission/dependency/capability validator.

For each delegated Task the original owner provisions fresh runtime identity and
uses an owner-private `nextChildParameters` callback for native issuance metadata.
The callback gets only epoch/agent ID; permissions/root/DID are derived from trusted
state. The expected HEAD is read privately from the original Gitea client. Dispatch
and completion use the original owner methods. A new decision requires an actual
independently attested Task, not an A2A success response.

`ready_for_pr` reopens the authenticated latest Test receipt and verifies project
and researcher acceptance PASS at current HEAD. The result is readiness, **not** a
PR authorization or a created PR. Existing PR admission/execution remains separate.
A blocked decision, stale context, failed Task/completion, abort or exhausted budget
retires the original root through the existing durable retirement/reconciliation
path. The original eight-decision budget is not increased. Repeated loop invocation
on the same owner is denied.

## Validation and limits

Local: 14 actual ADK controller tests and three original Engineer-owner negative/
blocked tests PASS; existing 53 authority/session/Gateway tests PASS. Two original
SDK/A2A/Runner-receipt readiness tests are added to Engineer CI (Unix sockets cannot
run locally). Controller unit hooks explicitly simulate provider/completion behavior;
they are not cryptographic or native E2E evidence.

This is the first active work-control loop, not the completed generative Executor:
- No native E2E has yet demonstrated this new loop driving all specialists.
- Model code-inspection tools and richer observations still need integration.
- Automatic root VP/PR execution after readiness remains to be connected.
- Recovery diagnostic selection remains R8: this loop stops and retires on failure;
  it does not claim autonomous repair or reuse a preselected D1 candidate.
- Branch and recovery/PR native proofs remain separate earlier evidence.

Follow ACTIVE_AUTHORITY_ONLY_ROADMAP.md. Next: exercise actual A2A work under this
controller, integrate the separately proven branch/PR operations, then diagnostic
recovery and the remaining architecture migration. No paid inference or merge.

## R355.1 actual SDK work connector

Adds one original-owner integration scenario: after independently verified Backend
work, the adaptive model chooses a Frontend Task, the loop allocates its runtime ID
and provisions Child metadata, dispatches through actual ADK/A2A SDK and authenticated
Unix binding/staging, and awaits separate Gateway/Gitea receipt completion before its
second model decision. The next scripted decision stops blocked and retires the root.
No manually staged/dispatched Frontend Task is used in this scenario. Crypto/provider
responses remain explicit fixtures; this is not a native full-loop proof. Local Unix
socket restrictions reserve the scenario for Engineer CI.

R355 production source 6e4c59c5: Engineer CI 42262006820 SUCCESS, main suite
162 PASS including original-owner current/stale Test readiness, no FAIL/skips.
Native branch and recovery/PR proofs remain earlier separate evidence.
