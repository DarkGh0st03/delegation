# R368.1 — Original Review Host: zero-Task adaptive three-role completion

R368.0 already verifies that the original authenticated Engineer Review
Host can start its protected SDK A2A channels with **zero** registered
Tasks and zero issued Child credentials, then dynamically choose and
independently attest Backend and Frontend (offline provider fixture).

R368.1 extends that same original-Host integration test with a third
model-selected **Test** Child and a fourth `ready_for_pr` decision.
The test creates the Test Task only after independent Frontend completion,
routes it through the existing authenticated Runner fixture, and requires
the owner to reopen the MAC-authenticated PASS receipt against the
current independently observed Gitea HEAD. No PR is created.

Assertions cover three independently completed Tasks, Child enrollment
ordered by dependency, unchanged original root permission ceiling, exact
tested SHA, no credentials/signatures/request IDs in model context and
zero paid model calls. The original no-Test blocked path remains as a
separate regression test.

**Scope warning:** this is a real Review Host / ADK SDK A2A / independent
receipt path with *offline provider fixtures* for Rust, Gitea and Runner.
The separate R367.2.1 native proof validates genuine Rust/EVM/OPA/Gitea/
Docker with dynamically registered Tasks, but does not instantiate
the Review Host. The next step is to combine both sides without widening
the signed Engineer authority. Do not claim Gemini generated code.

No merge to main, no paid pilot, PR #38 remains Draft.
