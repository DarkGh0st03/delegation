# R350.4 — same-session A2A execution and evidence separation (offline gate)

The latest R349→R350 owner host is now exercised as one continuous flow: real ADK Runner scripted Planning → authenticated Engineer permission-only approval → preliminary retirement → operational root → dynamic Coordinator Task → Gateway Task binding → Rust-native Child-issuer API (fixture) → Gateway Child enrollment → protected SDK A2A Task dispatch to a *real running* Backend ADK agent, bound through private Unix sockets.

The Backend invokes update_file via Gateway prepare, owner-private stage, signed-presentation and execute, with all provider and crypto responses deliberately isolated offline fixtures. The real A2A SDK completes and validates the resulting artifact. The owner returns `a2a_report_not_gateway_completed`, not provider success, and refuses duplicate dispatch.

Most importantly, independent Gateway completion is **denied**: the offline fixture has no genuine native Gateway Task flight, effect journal or independently verified Gitea evidence. The A2A report therefore cannot unlock dependencies. The test also asserts sensitive credential/proof material stays out of model requests, exact Task scope and branch are enforced, and shutdown retires the original Engineer root.

This is an **integration test of the real A2A/ADK transport**, not a live Rust/EVM/OPA/Gitea verification. It intentionally does not fake a Gateway completion receipt or claim a real provider write. The next gate must use the existing native Gateway effect stager, Rust VP, OPA, disposable Gitea and an independently observed completion in this same R349 review session, followed by persistent launcher reconciliation.

No paid Gemini call, main change or merge.
