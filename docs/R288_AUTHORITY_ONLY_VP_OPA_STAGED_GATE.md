# R288 — authority-only Gateway Prepare → VP → OPA (fail-closed staging)

**Date:** 2026-11-05  
**Parent:** R287 `d79a9033eabf0228368725d3c9b74bfc27374ae8`  
**Branch:** `refactor/post-prof-plan-contracts-20261021`

## Why an explicit deny is essential

The historical Gateway provider path calls Rust VerifierPort then
independent OPA, then `TrustedApprovedExecutionPlans` and the provider
executor. Merely passing an R287 Task *preflight* receipt into this
pipeline without a rooted Child DC, epoch status verification and
completion-proof fencing would create an authority bypass.

R288 therefore integrates a separate optional `authorityOnlyAdmissions`
mode with **proof and policy processing but NO successful provider effects**.

## Implemented

- `prepareAuthorization` derives the same canonical Gateway permission,
  checks the previously admitted dynamic Task with R287 and stores an
  immutable internal authority digest, Task ID and pinned agent DID in
  its one-use challenge record. This is **not** a public input; tool
  requests still reject caller-supplied authority properties.
- `executeAuthorization` consumes the challenge once and runs the existing
  `VerifierPort.verify`, required permission check and OPA policy.
  Only after both succeed it rechecks the stored authority-only digest,
  Task/role/presenter, canonical permission and current trusted root.
  The gate **always denies** with fixed
  `authority_only_execution_not_enabled` before the provider can run.
  Missing staged configuration cannot fall back to the old provider path.
- `GatewayRuntime` accepts the authority-only gate as an explicit
  **opt-in** dependency and refuses mixing it with legacy signed-DAG
  approval or Planning gates. It disables all composite/read-composite
  variants in this staging mode so those paths cannot bypass the
  authority-only deny.
- Legacy mode is unchanged when the optional gate is absent; the
  registered Task remains an authority *candidate*, not a signed Child
  credential.

## Offline negative tests

The R288 end-to-end offline test harness uses a real local signed
Engineer approval, the R285 two-root **stub** issuer, R286 Coordinator
and R287 Gateway admission records. It stages Gateway Prepare,
passes a **stub** VP verifier and OPA test policy, and proves:

- VP and OPA both execute before a successful-policy Task is **denied**;
- the executor is never called (`callCount === 0`);
- one-use challenge replay is rejected;
- wrong agent/branch/path/tool cannot prepare a challenge;
- a missing authority gate cannot turn an already-prepared request
  into an unguarded provider call;
- native-verifier failure and independent OPA denial both stop early;
- a dependent Task without trusted Gateway completion is not executable.

These are deterministic offline tests. Do **not** interpret them
as cryptographic evidence that a real Rust Child DC already works
in the new authority-only path.

## Security prerequisites for executable R289+

An executable `authorityOnlyAdmissions` mode MUST still require:

1. **Native Rust Core** verifies the actual live Child DC/VP chain
   back to the independent R285 operational root. Check the issuer DID,
   presenter DID, revoked status, audience, nonce, expiry, exact Task
   scope and epoch against trusted Coordinator/Gateway registration.
2. Independent OPA evaluates the resulting cryptographic principal
   and exact canonical requested permission **for each provider effect**.
3. Trusted Gateway attestations prove predecessor Task completion;
   Gitea edits and Runner results must be tied to the actual branch SHA,
   with no model-invented `completed:true`.
4. An owner-private, authenticated admission route for the executable
   Task and a durable lease/flight fence. Never accept model-supplied
   authority receipts, root credentials or agent Card DIDs.
5. Direct tests of the *real* Rust Node-API verifier, EVM status and
   Gitea/Docker providers on the same SHA, including negative replay and
   permission-escalation cases before any cutover.

No human approval, no Gemini model call, no API billing, no permission
widening and no change to `main` are part of R288.
