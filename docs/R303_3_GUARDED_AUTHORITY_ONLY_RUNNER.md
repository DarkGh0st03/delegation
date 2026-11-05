# R303.3 — opt-in native Rust/OPA Test Task and authenticated Runner PASS evidence

Base: R303.2 at `bdaef2b02503571afc879dcf78f5c07146b90143`.
Development branch: `refactor/post-prof-plan-contracts-20261021`.

## Security path

1. **Engineer signs root** with Test Agent `run_tests` branch permission.
   Coordinator creates the exact Test Task and Rust issues its Child DC.
2. The trusted owner enrolls that Child and prepares an original Gateway
   `run_tests` request, then calls R303.1 `stageRunner`, pinning
   current Gitea HEAD to an immutable Task/Child/epoch/request
   fingerprint (never an agent-supplied SHA). R293 Task flight is
   separately persisted.
3. Execute now has a dedicated opt-in
   `authorityOnlyRunnerEnabled:true` + same-instance
   `TrustedAuthorityOnlyRunnerExecutor`. Native
   `DirectCoreRustVerifier` must validate the signed VP and EVM
   status/revocation. A real independent `OpaPolicyClient` must
   return `allow`. Legacy signed-DAG, synthetic VP/OPA, wrong
   Child, non-Test role or unreserved Task remain denied.
4. The executor revalidates exact live Task + Child + persisted
   request/commit and verifies that Gitea HEAD still matches.
   Before any Runner POST, it fsyncs the unique `attempt` marker in
   an owner-private 0700 directory / 0600 `O_EXCL` file.
5. It invokes the already-authenticated, controlled
   `RunnerClient.run` **one time**, with the previously pinned SHA
   and `poc-default` profile. Network failure, timeout, unknown
   Docker outcome or Runner FAIL has **no automatic retry** and
   cannot unlock the Task.
6. Only an original in-process authenticated Runner PASS result,
   all six project phases PASS, researcher acceptance PASS,
   sanitized Runner-owned log ref and independently unchanged
   Gitea HEAD can reach the protected owner-only HMAC publisher.
   The publisher records no raw logs or token. A separate observer
   reopens the 0600 receipt, checks full binding, SHA, HMAC
   (constant-time), freshness and current Gitea HEAD.
7. The result hash is fsynced to the journal as a separate,
   non-overwritable `completed` marker. Only now can the
   Gateway's existing independent Task completion observer attest
   PASS and unblock dependent Tasks. Duplicate or corrupted
   evidence is rejected after process restart.

## Important limits

**This feature is opt-in and the current deployed Gateway runtime is
not automatically switched to the authority-only Runner.** This
checkpoint adds the guarded in-process execution boundary and
deterministic tests, NOT yet a real Docker CI demonstration of the
combined native Rust VP + OPA + Test Runner path. The existing Runner
service itself uses a trusted bearer-authenticated controller and
fixed Docker image; its HTTP response is not a separately signed
Docker attestation. The owner's MAC attests the validated response
inside the trusted Gateway, and independent Gitea checks attest the
tested commit, not the internal truth of a compromised Runner service.

R303.4 must exercise actual disposable Gitea + Rust/EVM + OPA +
Docker Runner with a successful Test Task, followed by negative probes
for wrong Child, revocation, stale HEAD, FAIL, lost response and
double launch. Preserve failure diagnostics only through a separately
bounded recovery authorization. No fake PASS, no legacy bypass.

No Gemini paid calls, no automatic GitHub main merges and no
production provider writes.
