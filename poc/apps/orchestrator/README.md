# Trusted Engineer host (Review Host and operational deployment)

Runs inside the `app` container for each console session.

- `src/trusted-authority-only-review-host.mjs` — **Planning**: issues the
  read-only preliminary Root, runs the Planner through the Gateway and stores a
  signed checkpoint of the proposal; **review**: verifies the Engineer's
  Ed25519 signature over the selected permissions; then issues the
  **operational Root** with exactly those permissions.
- `src/canonical-owner-deployment.mjs` — assembles the operational deployment
  of a session: Gateway pieces (Rust verifier, OPA, Gitea, Runner), one local
  A2A worker per provisioned specialist, Child lifetime within the Root,
  workflow budgets.
- `src/trusted-authority-only-owner-bootstrap.mjs` — operational provisioning
  (Root reservation, native effects, workers) on top of the console session.
- `src/trusted-authority-only-operational-launcher.mjs`,
  `src/trusted-authority-only-reviewed-canonical-handoff.mjs` — the run:
  work branch, adaptive Task loop (one Child DC per Task), Test run, Draft PR.
- `src/disposable-gemini-live-budgeted-model.mjs` — per-phase and per-session
  call/token ceilings of the paid Gemini models.

Merging is never automated: the Draft PR waits for a human.

Tests: `npm --prefix poc run orchestrator:test`.
