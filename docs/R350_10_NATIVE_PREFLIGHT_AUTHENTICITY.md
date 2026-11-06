# R350.10 — Native preflight authenticity and same-session Gitea mutation intent

The R349→R350 owner now verifies the **actual JavaScript class-private Gateway ownership** of both native Gitea and Runner preflights. A forged `Object.create(Preflight.prototype)` object with an overridden `isForAdmissions()` can no longer pass the owner boundary.

The R350.9 real ADK/A2A + Gateway Task flight test now calls **real** `TrustedAuthorityOnlyGiteaMutationPreflight` and `TrustedAuthorityOnlyRunnerPreflight` instances backed by `DurableAuthorityOnlyGiteaMutationIntentJournal` and `DurableAuthorityOnlyRunnerIntentJournal`. The native Gitea mutation preflight verifies the feature HEAD twice, reads the pinned old blob, computes the new content hash and reserves a crash-durable mutation intent before the original Gateway reserves its separate Task flight. Regression tests check pinned session/Child/request evidence and rejection of fake preflight prototypes.

The **external Gitea reads remain no-network fixture responses**, as do Rust Child signing, VP transport, OPA and Gateway provider execution in this targeted offline suite. The existing R331 full native test independently exercises these real providers but not under the authenticated R349 review session. That consolidation, and the persistent recovery CLI, are still R350's next evidence gates. No paid AI or changes to main.
