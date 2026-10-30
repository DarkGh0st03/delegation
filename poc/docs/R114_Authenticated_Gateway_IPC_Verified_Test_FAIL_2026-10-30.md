# R114 — Authenticated Gateway IPC evidence of verified Test FAIL

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

## Purpose and scope
R112 confirms a genuine failed Docker Test inside the original Gateway process,
but the production-style Engineer Host has a separate-process HMAC Unix-socket
`TrustedPlanIpcClient`. It cannot safely reconstruct the Gateway's in-process
Task registry. R114 adds a narrow private confirmation command, not a model API.

## Changes and guarantees
- `confirm_test_failure` requires the exact original `session_id`,
  `root_plan_digest` and runtime `test_task_id`.
- The real `TrustedApprovedExecutionPlans` checks these pins **before**
  irreversible failure finalization, then enforces existing trusted Runner
  provenance, Test role, predecessor completion, no outstanding provider
  effects, no conflicting PASS, active lease, and no replay.
- The authenticated owner receives only fixed structured fields, including
  failed phase, tested SHA, epoch and bounded TypeScript error codes.
  No source code, stderr, logs, signed VP, credential or authorization is
  returned. The client revalidates an explicit exact-field schema.
- The command is only available on the existing owner-only Unix socket with
  signed timestamp, nonce and MAC. Public Gateway HTTP/A2A/MCP is unchanged.
- Invalid root/session/task, forged output, replay or missing Runner FAIL
  are terminal denials. These receipts never imply a PASS or PR authorization.

## Test and proof boundaries
The Gateway registry regression uses actual `TrustedApprovedExecutionPlans`
Task state and fixture provider effects to test mismatched owner pins and
one-use finalization. The IPC integration tests exercise HMAC transport,
metadata filtering and replay using an explicit offline registry mock.
Neither test is a paid Gemini run or a complete native Rust/Docker repair E2E.

## Remaining integration
The owner host must attest its live Rust-issued parent root, independently
signed Engineer consent and durable epoch journal **in addition** to this
private Gateway receipt before discovery. R112's in-process
`TrustedOperationalEpochIntake` identity must not be spoofed or replaced
by the receipt. A new IPC-aware owner admission path must be designed and
verified; this patch deliberately does **not** enable recovery in the
production-style Engineer Host or change the main branch.

The separate Functional Signed DAG #41033291796 failed at its Test Task
with a sanitized `unclassified` error. Its logs do not prove why. Keep
that failure visible and diagnose separately; do not certify it as a PASS.
