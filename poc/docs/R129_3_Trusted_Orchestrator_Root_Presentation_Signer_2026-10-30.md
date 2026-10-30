# R129.3 — Separate Orchestrator signing port

The owner-only `TrustedOrchestratorRootPresenter` calls the existing
authenticated Rust Adapter `POST /v1/presentations` and holds the
Orchestrator bearer entirely outside the Gateway, agent and model.

Constructor pins exactly the original root credential and its actual
issued grants. Runtime presentation accepts only a 256-bit Gateway
challenge, bounded audience and subsets of pinned grants; root changes
or expansions fail before any Adapter request. Signed VP is returned
only to the trusted caller. The independent Gateway-side R129 verifier
still does all Rust proof checks.

These two pieces are NOT YET connected by a cross-process nonce/VP
exchange. Future integration must use owner-private IPC and may not
place an Orchestrator bearer in Gateway bootstrap or expose this signer
to agents. No paid inference; no Gateway admission as a side effect.
