# R287 — independent Gateway admission of Engineer authority and dynamic Tasks

**Date:** 2026-11-05  
**Parent:** R286 `ab0c4e3e968f2ccde0596c010cbde30a6551ac97`  
**Implementation:** separate in-process trusted Gateway staging registry, no billed AI.

## Compatibility with the architecture handoff

The R284 handoff requires an execution path with:
Engineer-signed **only permissions**, operational Rust root, Coordinator
Task epochs, native Rust VP/OPA and Gateway provider effects. The final
runtime must not require a human-signed DAG. The R285/R286 work
already built the new signature/root/Coordinator contracts.

R287 adds the next *isolated* Gateway boundary without replacing the
working `TrustedApprovedExecutionPlans` instance or modifying the
existing `prepareAuthorization`/`executeAuthorization` functions.
This avoids accidentally treating a preflight receipt as a live provider
authorization before the Rust child/VP and independent OPA gates migrate.

## Concrete changes

- `TrustedAuthorityOnlyExecutionCoordinator` maintains a private copy of
  journal-registered Task records. The Gateway obtains it **by Task ID
  directly from the Coordinator instance**, never from agent JSON or
  a forged `RegisteredAuthorityOnlyTask` object. The Coordinator also
  exposes an immutable trusted-only projection of its verified signed
  Engineer authority and actually issued root.
- `TrustedAuthorityOnlyGatewayAdmissions` requires concrete trusted
  Coordinator and signed authority-file-store instances, a **separate**
  `TrustedOperationalSessionStore` and a **separate** durable Task journal.
  On opt-in activation, it independently loads and verifies the
  Engineer's signed authority receipt and checks session ID, signer,
  repository, pinned SHA, requirement digest, branch, exact permissions,
  authority digest, root credential ID and lifetime.
- The Gateway durably reserves one activation **before** reading the
  receipt; it independently registers each Coordinator-admitted Task
  epoch and opaque runtime Task binding with no duplicate replay.
- `preflightCanonicalRequest` runs the existing Gateway validation and
  canonical URI derivation. It verifies the pinned agent role, Task
  grant, signed root ceiling and feature branch; there is no model
  `claimed_permission` input. Unregistered, cross-role, sibling-path,
  cross-branch, ungranted-operation and malformed requests are denied.
- A downstream Task with dependencies is still **denied at preflight**
  until there is a trusted Gateway completion attestor. Merely
  registering a predecessor is not equivalent to completing it.
- All returned statuses contain `preflight_only` and explicitly
  `gateway_execution_authorized:false`. The new class has an explicit
  `assertExecutionReady()` fail-closed guard, so no caller can
  reinterpret the staged registry as authorization for provider I/O.

## Tests

The Fast CI's existing `trusted-authority-only-engineer-session.test.ts`
suite now exercises the real signed receipt verifier, trusted
two-root Engineer transition, Coordinator activation, staged Gateway
admission and canonical request preflight under an isolated one-use
durable Gateway session/Task journal. Negative tests cover:
wrong signature-reader instance, foreign repository, expired root,
replayed activation, unadmitted Task, agent mismatch, missing Task grant,
sibling resource, main branch, traversal and unattested dependency.
The test issuer is still **offline**; it does not prove live Anvil,
Rust VP, OPA or Docker behavior for this new path.

The old signed-DAG E2E remains the authoritative compatibility baseline.
Nothing in this patch adds an HTTP route, MCP root issuer, model tool,
fallback to Adapter HTTP, or a new executable permission for an agent.

## Remaining R1/R3 integration gate — NOT yet completed

**Do not launch a paid Gemini pilot with this staged class.**

The actual provider Gateway must separately:
1. Use an authenticated owner-only IPC path and durable task history to
   transition from the staged registry to an executable Task binding.
2. Verify Rust Child DC / VP per request against the *same live
   authority-only operational root*, current revocation status, presenter
   DID, challenge, and Task/epoch authorization.
3. Call independent OPA at execution, preserve the existing
   prepare/execute request fingerprint, one-use challenge, and provider
   effect fencing. Any failure returns DENY before Gitea/Docker.
4. Populate dependencies/completions only from trusted A2A/Gateway
   attestations; enforce Runner exact-SHA evidence and review-only PR.
5. Prove staged R287 plus Rust EVM/OPA/real Gitea/Docker E2E on a single
   SHA with negative bypass tests before an operational cutover.

The code currently asserts a permission is *within the Engineer ceiling*,
NOT that the operation is ready to execute. This distinction is intentional.
