# R350.13 — Native R331 with the authenticated R349 Engineer-review intake

## New manually selectable native mode

The existing R331 native end-to-end harness now accepts the explicit
`workflow_dispatch` input `authority_mode=reviewed_native`. Its original
`original_fixture` path is unchanged and remains available for regression.

In the reviewed-native path a disposable Gitea fixture is seeded on local
**main** before branching; the newly created feature branch and `main`
share an identical immutable baseline revision. This avoids the previous
incompatibility where R349's read-only Planner required `main` at the
revision pinned for R331's already-seeded feature branch.

A real Google ADK Runner (with a scripted, non-billable Planning model)
reads the pinned source and proposes ONLY maximum permission pairs. The
backend provenance checkpoint is signed with a separate Ed25519 key and
stored durably. The actual R349 loopback Engineer authentication and CSRF
review signs the selected permission pairs via its protected private key,
without writing an artificial preapproved receipt.

The original R349 native Rust credential-port and Engineering session
issue the **real** independent operational root; R331 now uses the
Coordinator returned by `reviewHost.activateOperational`. All the native
R331 Backend, Frontend and Test Tasks continue through existing Rust/EVM,
core verifier, OPA, disposable Gitea CAS and Docker Runner components.
The original session is terminally retired and its root is revoked through
the owner host, with a durable recovery intent. No paid model is contacted.

## Explicit trust and validation boundaries

The **Planning Gateway HTTP + VP read transport** in this first bridge is
still an offline fixture; however, the Planner's actual requested source
text is read from real disposable Gitea at the exact baseline revision,
and the Engineer root itself is issued/revoked by native Rust/EVM. The
reviewed mode is therefore an incremental integration—not a full proof
that preliminary Planning VP traversed core Rust/OPA/Gateway.

Also, R331 currently constructs its operational Gateway/Child/A2A owner
directly from the same returned R349 Coordinator and signed Engineer
receipt. The stricter R350 private execution handle has not yet replaced
every downstream R331 assembly, so that is the next convergence step.

The R350.13 selection is **manual only**. This commit adds only a fast
`node --check` gate in Engineer CI; it does not trigger the expensive
75-minute native workflow. No Gemini key, OpenAI key, paid inference,
production repository modification or merge is involved.
