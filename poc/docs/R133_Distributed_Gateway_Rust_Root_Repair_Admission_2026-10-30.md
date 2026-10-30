# R133 — Distributed Gateway admission with a fresh native Rust root VP

30 October 2026. Branch refactor/post-prof-plan-contracts-20261021.

The deployed Gateway may now be configured with remoteEpochInspector
INSTEAD of the same-process Engineer Coordinator. This option requires
a durable authenticated Gateway operational session, 10–120s owner lease
and an independently configured R132 root verifier. The Gateway verifies
the original Ed25519 Engineer approval, fsynced canonical epoch records,
native Rust issued grant set, current EVM-anchored nonrevocation, and a
NEW nonce-bound Orchestrator-signed root VP. It rechecks both the exact
signed epoch history and FRESH native root proof after asynchronous
inspection and trusted prior Task quiescence and immediately before
synchronously installing next-epoch Task grants.

Owner-only HMAC admit_epoch carries only exact pins, not model plans or
proof objects. A verified root VP alone still cannot grant admission:
the Gateway independently requires all predecessor/independent Task
completions, finalized failed Test, no in-flight effects, active lease,
no replay and a next-version signed DAG. Old Task bindings become stale.

Tests R133 use the actual Gateway IPC and signed journal with scripted
native Adapter/VP responses; the preceding R129/R130 proofs exercise
real Rust crypto and a separate OS process. R133 doesn't issue fresh
Child DCs or prove real Gitea/Docker recovery; these are the next steps.

No paid Gemini, no main change.
