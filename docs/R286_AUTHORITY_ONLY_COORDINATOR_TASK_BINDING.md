# R286 — authority-only Coordinator admission and dynamic Task binding (offline)

**Date:** 2026-11-05  
**Parent:** R285 `6a356ecf4b68c3c8275ac5a6f0726d3c98d8b974`  
**Status:** independent trusted-host **preflight**, not a Gateway/Child DC cutover.

## Reconciliation against the supplied R284 handoff

The architecture handoff was written against SHA `3f918be7`. R285
subsequently implemented the authority-only Engineer two-root lifecycle,
signed receipt verification and a durable activation journal. R286 extends
those changes on the same development branch without modifying `main`
or reverting the independent native Rust issuer.

## Implemented

- `TrustedAuthorityOnlyEngineerSession.assertLiveOperationalRoot()` returns
  a snapshot of the **already-issued** operational root only after native
  issuer response has been checked and the session is operational. It
  carries the credential ID, root expiration, exact actual rights and the
  authority digest — **not** a Task/DAG digest.
- `TrustedAuthorityOnlyExecutionCoordinator.activate()` loads the Engineer
  authority receipt from the protected signed store, verifies its trusted
  in-process signature brand/expiry/digest and checks the issued root
  ID, session, rights and lifetime against that receipt. Activation is
  journaled exactly once and requires a live Engineer root.
- `registerTask()` accepts a Task candidate only with the same session,
  requirement SHA-256, pinned Git SHA and working branch as the approved
  grant. An epoch must advance by one (maximum 256), dependency IDs must
  already be admitted and the Task ID cannot be replayed.
- Child Task permissions must be **exact (ResourceURI, Operation) pairs**
  covered by both the signed Engineer grant and actual issued root.
  Each operation must also be in the registered agent's trusted
  **capability** list. The model cannot supply the agent DID/card_ref:
  the Coordinator takes those from a host-pinned registry.
- `DurableAuthorityTaskJournal` uses a private directory and atomic
  exclusive file creation with file+directory fsync. It reserves one
  activation and each epoch/Task admission, fails closed on a duplicated
  or ambiguous write, and stores only IDs/digests (never DC, VP, keys or
  source code).

Every returned receipt explicitly reports:
`execution_authorized:false`, `child_credential_issued:false` and
`gateway_registered:false`. The result is not an executable A2A token.

## Negative evidence

Offline tests cover the absence of a real issued root, foreign
session/branch/revision/requirement, missing root permission,
duplicate Task pair/ID, unknown agent, missing dependency, lack of agent
capability, changed epoch, cross-instance replay and expiration.
Two agents can register distinct Task epochs under the **same** signed
authority without any new Engineer signature or new root.

The existing Fast CI runs the expanded
`trusted-authority-only-engineer-session.test.ts` with offline Node
type stripping. No Gemini API or paid workflow is involved.

## Not yet implemented — hard boundary

This is deliberately **not** the production Gateway authority session,
`TrustedApprovedExecutionPlans` replacement, Rust child issue/VP,
trusted A2A dispatch, or real Runner permission decision. The historical
signed-DAG path remains active and isolated during migration.

Before exposing registered Tasks to providers, implement:
1. A trusted Gateway admission/session store keyed by the same
   authority digest, live root and protected Task epoch, with independent
   Rust VP/DC and OPA checks; provider effects must remain fail-closed.
2. Root/child revocation, expiry, trust and issuer-status revalidation at
   **execute** time. The local Engineer phase alone is not a status oracle.
3. Authenticated A2A Card provenance/availability confirmation and
   task-specific signed binding; pinned registry metadata is not proof
   of a remote card's continued availability.
4. Semantic requirement policy: a matching requirement hash pins the
   requested goal **identity**, but cannot prove an arbitrary candidate
   Task actually serves that goal. No execution permission follows solely
   from this hash.
5. Multi-process restart/recovery with durable completed-Task evidence,
   and hierarchical resource containment in Core Rust (R2/R3). A
   registered dependency is **not** yet an attested completed dependency.

R286 is not counted as completed R1 end-to-end. No new permission is minted
by the Coordinator; the next migration step is trusted Gateway admission.
