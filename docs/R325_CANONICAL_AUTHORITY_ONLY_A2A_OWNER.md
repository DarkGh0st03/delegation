# R325 — canonical owner → protected A2A Task dispatch

## What is wired
A new programmatic startup `startTrustedAuthorityOnlyA2AOwner` builds
on R324's authenticated private Unix bootstrap after REAL
Software Engineer permission-only root activation, Coordinator Task
registration, Rust native Child issuance and independently enrolled
Gateway Child. The active owner now builds the A2A Task request
**itself** from Coordinator permission rows: role, exact approved
branch, canonical file paths, one `update_file` or `run_tests`
grant, one native-issued Child and the preallocated runtime Task ID.

R290 Child issuance now retains the native Rust-signed credential in
a private one-shot map, transferred only after R324 returns an
authenticated Task-bind acknowledgement. The model/A2A transport
cannot mint or select the Child, role, permissions or HEAD. The owner
does not fabricate a credential from the registered Child receipt.

The protected `A2A` port is invoked with the original signed Child
and exact owner-generated Task hints. The resulting Agent Card and
completed Task/artifact are schema-validated, but the method returns
only `a2a_report_not_gateway_completed` with
`provider_completion_attested:false`. It does NOT unlock the next
dependent Task, declare Docker acceptance PASS, issue permissions or
record Gateway completion. Actual Gateway-signed provider evidence
remains a separate mandatory step.

## Scope and blockers
This module is a concrete owner-side **programmatic entrypoint**.
The live protected A2A port is supplied by the separately authenticated
deployment owner; it is NOT constructed from an A2A user message or
model proposal. Plain HTTP A2A is limited to loopback; remote transports
must be HTTPS. End-to-end production process identity and mTLS/verified
caller provenance still require independent evidence.

This test stage must validate positive/negative A2A handoff, no
credentials in model context and no duplicate Child transfer.
The older Gemini signed-DAG launcher is intentionally unchanged and
cannot be counted as a migrated authority-only entrypoint. Before
the paid pilot: native disposable Gitea/EVM/OPA/Docker, real A2A
agent processes, provider completion/recovery D1 and negative revocation
tests must pass on a pinned SHA. No paid inference or merge.
