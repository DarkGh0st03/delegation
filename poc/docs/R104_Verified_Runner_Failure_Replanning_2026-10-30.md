# R104 — Verified validation feedback and contained repair (30 October 2026)

## Why

Three earlier paid Gemini experiments produced TypeScript compiler failures
(TS2820, TS2367, TS2339) during Docker Runner typecheck. The Test Agent
correctly detected failure but could not repair code beyond its signed Task.
A failed test is a normal *validation result*, not a request for the Test Agent
to obtain Backend/Frontend write privileges. In particular, a failed Runner
result must never be treated as an attested PASS or PR permission.

## This increment

- The Gateway receives the completed Runner provider result **only after**
  independently authorized Prepare, verified VP and OPA. A failed report is
  captured as bounded feedback (first failing phase, whitelisted TS codes,
  exact tested SHA and branch, Task/epoch identity). Raw stderr, source,
  diagnostic paths, credentials and model prose are not released by the
  private failure accessor.
- The trusted owner may mark a Test Task terminal as `validation_failed`
  after the Gateway has already observed an actual failed Runner result.
  It cannot call the old PASS-completion method on that failure. No PR
  authority is granted; the successful-Test SHA remains invalidated.
- R103 epoch admission accepts one terminal failed **Test** alongside
  independently completed other Tasks; it still rejects missing, unbound
  or incomplete Task IDs, stale epochs, invalid Task roles, changed authority,
  altered repository/branch and mismatched original Engineer approval.
- Protected provider-flight counters prevent epoch transition while already
  authorized operations are in progress. A previously prepared request is
  denied after a successful epoch transition; old asynchronous completion
  attestation race tests remain enforced.
- A dependency_install failure is ambiguous (e.g. infrastructure issue);
  it cannot authorize autonomous code repair without independent triage.
- Internal maximum operational DAG epochs is **three total**: original
  implementation + two repair attempts. This limit is not an Engineer
  approval field and does not enlarge any delegated permission.
- A scripted invoice-service fixture validates FAIL (typecheck TS2339)
  -> confirmed private feedback -> new previously rooted epoch
  -> Backend correction -> Test PASS. A fabricated model failure
  without observed Runner execution is rejected.

## What this does NOT claim

The new E2E is a mocked verifier/OPA/provider harness embedded in Gateway
unit tests. It does not yet demonstrate a live signed child-DC VP,
native Core Rust and real Runner passing after repair. The existing
independent Rust + Docker CIs continue to test the prior scenario.
No automatic Gemini replanning loop or paid pilot was run; the next
increment must consume the trusted feedback to produce a bounded
model-generated repair plan, and verify it through the same Gateway
and real Core Rust chain.

## Follow-up

R105: authenticated private feedback channel from Gateway to Orchestrator;
preserve failed revision and branch in disposable Gitea; plan new Task IDs,
issue actual child DCs and validate the modified SHA with Docker;
refuse an unsupported permision instead of creating a new Engineer
authorization implicitly. Run a fully scripted FAIL-to-PASS first.
