# R354.1 — Native branch proof from unsolved main

Adds a separate free native checkpoint for the R354 Orchestrator branch path.
Unlike R353.9's full recovery/PR fixture, it starts from the exact existing
unsolved Account Suspension main baseline and checks the feature branch is
absent through authenticated Engineer approval. No source files are seeded,
no main edits occur and no application implementation is claimed.

The actual original Engineer review host performs its Planning/root transition,
permission-only signature, native Rust root issuance, dynamic ADK branch Task,
Gateway admission and durable one-flight staging. The actual GatewayRuntime HTTP
listener uses the independent native Core Rust verifier and real OPA. Gitea creates
one branch at the immutable approved main SHA; a separate read-only client attests
completion. No Child is issued. The test also requires consumed challenge replay
denial and original-root revocation to invalidate its VP.

Limits remain explicit: the preliminary Gateway protocol is a fixture backed by
real pinned Gitea reads and a native preliminary VP, and both ADK models are
scripted. This is a branch-only native integration proof, not a complete autonomous
Planner/Backend/Frontend/Test/recovery/PR run. R353.9 remains the earlier recovery/PR
native evidence. Follow ACTIVE_AUTHORITY_ONLY_ROADMAP.md; build the autonomous
Executor after closing these operations, then diagnostic recovery and migration.

The workflow triggers only on a dedicated checkpoint or manual dispatch, never on
every source edit. Source syntax and original-owner branch regressions pass locally;
Fast CI and Engineer regression must be checked before launching the native gate.
No paid models, new scenario, merge or main mutation.
