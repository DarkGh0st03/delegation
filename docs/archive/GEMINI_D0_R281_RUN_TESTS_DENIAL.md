# R281 — Paid Gemini D0 Test Runner execute-denial diagnosis (no paid rerun)

**Date:** 2026-11-05  
**Failed billed pilot:** https://github.com/DarkGh0st03/delegation/actions/runs/41981164048  
**Verified release SHA:** `c193b2312675206341bef7fd536031b83e0fb99c` (R280, 4/4 free native CI SUCCESS)

## Observation — do not substitute a guessed root cause

The signed Account Suspension D0 planner generated an admissible execution DAG;
the real Backend and Frontend agents performed authorized Gitea operations.
The final dedicated Test `run_tests` Task failed with the host-observed
`authorization_denied`, followed by `controlled_tool_failures` and
`a2a_task_not_completed`. No authenticated passing Docker Runner receipt,
final acceptance or PR success was established by the failed test.

The sanitized public failure receipt is **incomplete for the Gateway's
exact denial**: the client previously merged every non-5xx Gateway *execute*
response into `authorization_denied` and retained only the HTTP status,
dropping the fixed `error` code. Thus the evidence alone cannot distinguish
Rust VP rejection, deterministic OPA deny or approved signed Task deny.
Do not increase signed rights, weaken OPA or claim the Test Agent made a bad
permission request without an authenticated reason.

## Minimal R281 change

1. Preserve only allowlisted, fixed Gateway *execute* error codes as a
   **diagnostic** `reason` on an existing denied ControlledToolError.
   Valid categories include `verification_rejected`,
   `policy_denied`, `approved_plan_denied`, `expired_request`,
   `replay_detected`, `unknown_request`. Unknown or source-bearing
   response text becomes `gateway_execute_unclassified`;
   5xx stays `upstream_unavailable`. The operation still fails closed.
2. Forward the fixed reason in `adk_tool_timing` (no code paths, model
   arguments, untrusted response body or credentials) and extend the two
   existing sanitizers/ledgers to retain the same known codes. Preserve the
   separate `authorization_denied` kind and `causal_attribution:
   not_established` invariant.
3. Add free regression tests for *each* of the three security gates,
   unknown malicious messages, 5xx and expired request, and for the double
   sanitization of a signed Test Task event into the reported failure ledger.

## Scope and release policy

This is an **observability-only** correction. No new permission, reissue,
retry policy, Gemini turn, LLM model call, Docker runner bypass, alteration
to Rust signer, OPA or approval, or `main` mutation is authorized.

Fast CI runs on this R281 commit with no model key. Before a possible new
**paid** Gemini pilot, the exact-SHA native four-CI gate would need to be
green again, followed by *fresh separate user approval* and a verified
external provider spending cap. No Gemini rerun is part of R281.

A fresh denial reason on any future run would locate which enforcement
gate stopped the operation, but still would not by itself establish the
underlying application fault without correlated privileged diagnostics.
