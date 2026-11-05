# R311 — authority-only canonical Gateway HTTP positive native Docker test

## Goal
The R310 owner assembly was introduced and its startup denials passed
Fast CI. This R311 change routes the final `run_tests` Task of the
R305 Backend → Frontend → Test chain through the real HTTP POST
`/v1/authorization/execute` listener constructed by the R310 trusted
owner entrypoint, not through a direct `GatewayRuntime.execute()`
method call. The positive chain remains one Engineer permission-only
approval, two Task-bound atomic Gitea CAS updates and a separately
signed Test Child VP on the attested Frontend SHA.

## Actual acceptance expectations
- Active authority-only Gateway admission shared with the existing
  Coordinator, durable request store, mutation executor and Test Runner.
- Fixed in-process Core Rust addon loaded anew by the owner HTTP host,
  with independent EVM/status verification and real OPA/Gitea.
- The HTTP Test request contains only `request_id` and `signed_vp`.
  It cannot change Task grants or select an arbitrary Runner SHA.
- One Docker Runner POST, exactly the Frontend HEAD tested, all project
  phases and independent researcher acceptance PASS.
- No fallback to legacy signed DAG, Adapter verification, mock providers,
  merge or paid inference.
- CI-only disposable Gitea, Anvil/EVM, local OPA and loopback HTTP.

## Boundaries
Backend and Frontend CAS in this run still use in-process
`GatewayRuntime.execute` (the two mutations are already independently
verified in R308). The full three-agent ADK/A2A production dispatch and
autonomous planning/recovery remain future milestones. A pinned reference
implementation is owner-staged, not synthesized by Gemini. Loopback
HTTP is a disposable local test, not an authenticated distributed
deployment. Do not mark this R311 test successful until the isolated
native-Rust/EVM/Gitea/Docker workflow finishes green on this commit.

## Cost and triggering
No Gemini/OpenAI calls. Only one explicitly checkpoint-triggered
isolated GitHub Actions native Docker job plus normal Fast CI.
