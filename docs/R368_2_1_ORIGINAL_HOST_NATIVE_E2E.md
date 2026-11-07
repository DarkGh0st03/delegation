# R368.2.1 — Original Engineer Review Host: first integrated native attempt

This checkpoint connects the **real** original
`createTrustedAuthorityOnlyReviewHost` to the independent native
Rust/EVM/OPA/Gitea/Docker three-role infrastructure already validated
in R367.2.1. It runs in disposable CI and uses no paid inference.

The Host, not the harness, must issue a temporary read-only Rust
preliminary root, ground a permission-only Planning proposal in the
authenticated source, validate the independently signed Engineer
approval receipt, revoke the preliminary root and issue a distinct
operational Rust root. It then constructs and owns the Coordinator,
Gateway, native Child issuer, SDK A2A Owner and the **entire**
`runAdaptiveWorkLoop` state.

No worker Task or Child is preregistered. The free scripted ADK
decision model chooses Backend (read + CAS), Frontend (read + CAS),
Test (real Docker + acceptance), then requests `ready_for_pr`. Only
the original host's independently reopened Runner PASS on the current
Gitea HEAD permits readiness; it does not create a PR.

The disposable approval receipt is independently test-signed and
verified, *not* a live human UI click; its offline UI authentication
and CSRF tests already pass separately. The Planner reads a real
disposable Gitea source through an owner-local preparer that checks
the preliminary VP with the real Rust verifier. Real OPA and native
Gateway are required for subsequent delegated provider effects.

Until this new workflow is green, treat this as a **new integrated
native experiment**, not a proven R368.2 milestone. The application
source fixture and ADK decisions are scripted, not Gemini-authored.

No Gemini paid inference, production Gitea, merge, or change to main.
