# R334 — Reject A2A Test FAIL before Gateway success attestation

## Baseline

R333.2 passed native three-agent Rust/EVM/OPA/Gitea/Docker CI on
`226750e638c68949651ad6370396382a95727694`. Its three Google
ADK/A2A agents used deterministic offline models, not paid Gemini.

## Change

The A2A owner already treats all agent reports as **untrusted provider
completion**. R334 additionally prevents a structurally valid Test
artifact with `test_outcome=fail` (or `not_run`) from entering the
independent Gateway *success* attestation path.

An A2A Test FAIL remains a potential D1 signal, **not** independently
authenticated failed-Runner evidence. The new unit regression checks a
Test role, native Child/Task fixture, approved branch-scoped
`run_tests`, and a valid A2A Test FAIL artifact. Repeated attempts
never call the trusted Gateway completion observer. Existing
non-Test reports and successful Test dispatch are unchanged.

## Next milestone — D1 gate (not implemented by R334)

Require independently authenticated failed-Runner evidence, exact
runtime Task/Child/epoch and tested Gitea SHA, then provision a fresh
Task/Child under the *original* signed Engineer permission ceiling.
Neither the A2A report nor a user-controlled model field may authorize
D1. Confirm the repaired effect and new Test PASS independently through
Gateway, Rust/OPA, real Gitea CAS and Docker before claiming full E2E.

This change is a narrow fail-closed prerequisite, **not** a D1 proof
or a generative model experiment. No paid AI, auto-merge, or `main`
mutation.
