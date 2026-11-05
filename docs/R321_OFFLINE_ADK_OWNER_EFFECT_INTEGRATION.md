# R321 — offline ADK Runner exercise with prebound owner effect

The R320 per-Task owner registry is now exercised by the actual Google
ADK `LlmAgent` / `Runner` runtime using a deterministic local scripted
BaseLlm (no Gemini/paid model). The Backend Task calls `update_file`
through `GatewayControlledToolClient`. The fixture verifies exact
ordering `Gateway prepare → owner private stage → private signed VP →
Gateway execute`; it rejects replay and mismatched A2A Task/Child/branch
before invoking any model or protected tool.

All remote Gateway/VP responses are synthetic and explicitly local to
the test. The owner registry and client cannot authorize a mutation:
only a future native integration with real provider records, Rust
credentials, OPA and independent completion receipts can prove that.
This test does NOT use an actual A2A HTTP listener, and does not prove
authentication of remote A2A callers or native privileged owner IPC.
Those are next deployment gates; no merge and no paid inference.
