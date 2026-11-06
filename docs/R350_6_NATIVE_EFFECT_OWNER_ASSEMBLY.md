# R350.6 — owner-native Gateway effect assembly

R350.5 required a real `TrustedAuthorityOnlyEffectStager`, but constructing it outside the R349→R350 owner could accidentally select a different Gateway or shared Prepare store, while a fresh instance per retry was difficult to audit.

The same-session owner now offers two strictly private operations on its existing execution handle:
- `bindNativeGatewayEffects({store,mutation,runner})`, one-shot, accepts only the actual `InMemoryRequestStore`, `TrustedAuthorityOnlyGiteaMutationPreflight` and `TrustedAuthorityOnlyRunnerPreflight` objects. Both preflights must report they belong to this original in-process Gateway instance. Invalid binding is terminal, not quietly replaceable.
- `createEnrolledNativeEffectStager({runtimeTaskId,expectedHeadSha})`, one-shot for each genuinely enrolled Task. Tool and Gateway are derived from the coordinator registration; the owner pins the exact Git SHA. The stager itself subsequently rechecks Gitea HEAD through its real native preflight. `dispatchEnrolledTask` accepts only the exact owner-created stager object, not a separately fabricated callback or a newly constructed retry.

Offline tests cover positive assembly and reject preflights linked to a foreign Gateway, missing native bind, re-creation/replay and direct anonymous staging. A2A's existing reported artifact remains **untrusted** until actual durable Gateway flight plus authenticated provider observation. This increment does not yet claim live native E2E. The existing R331 native harness demonstrates the real Gitea/Rust/OPA/Runner path independently; next work is to use the same harness with this R349→R350 host and verify the independent completion.

No inference payment, no main change, no merge.
