# R293 — staged completion provenance, dependency gates and crash-durable Task fences

Parent: `ed7c5e6d7a2646af31d321f8a55fdb2f46d41e9d`.
Branch: `refactor/post-prof-plan-contracts-20261021`.

## Why the new gate exists

R292 proved real direct Engineer Rust root -> Orchestrator Child DC ->
Backend VP -> independent Core Rust/EVM trust/status -> real OPA, with
provider calls still zero. At R291 the Gateway unconditionally rejected
every dependency-bearing Task: registration alone was never proof that
a preceding Task completed.

R293 adds **opt-in host-private** staging of:
- a crash-durable, one-flight-per-Task effect-intent journal;
- an owner-injected `TrustedAuthorityOnlyCompletionObserver` which asks
  a separately trusted evidence reader to verify the *exact* original
  session, authority digest, operational root ID, Task, runtime ID,
  epoch, agent DID, issued Child ID and prepared request fingerprint;
- a second crash-durable completion marker, accepted only if the
  matching flight reservation is already durably present;
- a Gateway staged completion set, allowing permission preflight on
  downstream dependency Tasks **only when every dependency has an
  observed and pinned completion**.

The public Prepare route and execution policy are not extended.
The owner-only methods `stageTrustedTaskFlight(record)` and
`attestTrustedTaskCompletion(taskId,runtimeTaskId)` accept no new
agent/model permission or client-reported success flag. Both require
the exact Gateway-bound Coordinator Task and enrolled native Child.
Even after a staged completion, `assertExecutionReady()` and the
authority-only `executeAuthorization()` **still deny provider effects**.

## Replay, crash and concurrency

- Each Task's flight is written with `O_EXCL | O_NOFOLLOW`, 0600,
  file and parent-directory `fsync`, inside a preprovisioned 0700
  owner-only directory. Task ID is hashed into a stable filename.
- The durable flight is never cleared or retried after a lost result.
  This deliberately supports only **one staged flight per Task**. It
  cannot yet execute multi-tool Account Suspension Tasks.
- The completion journal independently reads that flight under
  `O_NOFOLLOW` and compares every binding. Forged/missing/foreign
  flight, concurrent calls, duplicated attempt and replay after
  reconstruction are denied.
- Source failure, mismatched evidence, or ambiguous journaling causes
  the Gateway admission instance to fail closed.
- Tests exercise positive dependency-preflight unlock *with an injected
  synthetic observer only*, wrong credential rejection, missing flight,
  duplicate flight and duplicate completion.

## Trust and evidence limits (mandatory)

The observer is **an injection seam**, NOT a ready-made verifier of
signed Runner/Gitea records, native VP or an independent OPA decision.
An untrusted or model-supplied callback must NEVER be installed.
R293's positive test fixture uses a synthetic trusted-reader response.
The real operational Gateway is not wired to this staging seam.

Do not claim that task success or Provider Gitea/Docker effects are
attested in production. R294 must integrate a concrete read-only,
authenticated provider/Runner completion evidence verifier and bind
effect-fence lifecycle to independently checked native VP+OPA results,
then support multiple legitimate tool effects per Task with durable
sequential effect accounting. Until then: zero provider effects,
no Gemini, no legacy bridge and no privilege elevation.
