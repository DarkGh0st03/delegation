# R301 — crash-durable multi-effect Task sequencing (read-only)

Based on R300 SUCCESS at commit `af67eac01a59fe613139420ff76beee7870c205f`.
No modification of `main`; no paid Gemini inference.

## Why

The R293 Task-fence journal intentionally permits **one** provider
flight per Task. Consequently R300's successful end-to-end
Engineer-directory / Child-file Rust/EVM/OPA/Gitea validation does not
show the system can execute multiple legitimate tool calls within one
Task. Removing `O_EXCL` or overwriting the original Task flight would
weaken replay/crash guarantees.

## Implemented

An **opt-in, independent** `DurableAuthorityOnlySequentialEffectJournal`
uses a separate, owner-provisioned 0700 directory and an immutable Task
manifest (2–32 expected read effects). The trusted Gateway owner pins
the manifest *before* attempting an effect. For each numbered effect:

- a unique `O_EXCL | O_NOFOLLOW`, 0600, fsync'd flight is reserved
  before any provider call;
- effect N+1 is rejected until effect N has a separate durable
  evidence marker whose hash exactly matches the previous-evidence link;
- only a separately authenticated result observer may produce the
  evidence hash and completion timestamp;
- later effects use distinct prepared request IDs/challenges and retain
  the same immutable Engineer authority digest, Task epoch, runtime
  Task ID, root and enrolled Child credential ID;
- after exactly the manifested number of effects, an additional
  durable final marker is needed to unlock dependent Task preflight.

The owner-only Gateway methods are
`beginTrustedSequentialReadTask`,
`stageTrustedSequentialReadEffect`,
`attestTrustedSequentialReadEffect`, and
`finalizeTrustedSequentialReadTask`. They are *not* HTTP/LLM/MCP
endpoints. They do not issue VPs, make OPA decisions, call a provider or
authorize a write. The existing R293 single-flight path is unchanged
and explicitly cannot be mixed with the new sequencing mode.

The existing R295 Gitea publisher and R294 independent result reader
remain responsible for checking actual successful provider read
effects. An observer's fabricated test response is **not** sufficient
for production usage; the tested fixture exercises only the Gateway
admission and durability choreography.

## Negative boundaries

Tests cover duplicate manifest, concurrent effect reservation,
crash/restart with an unconfirmed flight, premature effect N+1,
foreign Child/root/Task/epoch/request, wrong predecessor hash,
duplicate evidence, premature/duplicate finalization, shared journal
directory, failed dependency unlock and attempted mutation through
this explicitly read-only mode.

## Explicitly not done

This commit does not enable `create_file`, `update_file`, Docker or
`run_tests` in the authority-only execution mode; it does not
provide a signed provider-write result attestation, or automatic
reconciliation of an uncertain provider side effect.

A separate disposable R301 **real** multi-read Rust/EVM/OPA/Gitea
workflow is the acceptance gate for end-to-end multi-effect behavior,
in addition to the Fast CI test fixtures. Do not claim that R301
completed merely because the staged code or offline tests pass.
