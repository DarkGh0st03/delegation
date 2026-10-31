# R151.78 — acceptance diagnostics reach trusted repair planning

## Problem and resulting behavior

R151.77 retained fixed acceptance check IDs in the Runner result and pilot
artifact. The owner-private failure receipt still discarded them, and the
remote discovery/ADK preflight admitted only TypeScript diagnostics. An
acceptance-only FAIL could therefore not carry its requirement labels into
bounded repair planning.

The Gateway now stores a validated optional acceptance summary only when the
six project phases passed, the independent acceptance phase failed and there
are no conflicting compiler codes. Authenticated private IPC accepts precisely
that optional field, validates its fixed vocabulary and reconstructs immutable
metadata. The original receipt fields and exact session/root/Task/SHA binding
remain mandatory.

Trusted feedback and the repair-planner input retain the summary. A shared
eligibility check permits classified acceptance failures with at least one
known check ID, no timeout and no unclassified failure. The existing compiler
path is preserved. Remote discovery still requires the original root's exact
read grant, fresh signed child proof and the Gateway-confirmed source receipt.
Diagnostic labels grant no scope and do not identify a causal source file.

The bounded ADK proposer accepts actionable acceptance diagnostics only with a
separate owner-private verified-target callback. It independently checks the
failed SHA, existing role/file scope and resulting DAG constraints. Missing,
stale and outside-root targets fail before inference. A timeout or unknown
failure also fails before inference. This does not make a model-generated
file name into a trusted repair target.

## Evidence and limits

146 selected local tests passed: 123 Runner/client/executor/ADK/negative-control
tests, plus 23 Gateway operational-epoch regressions. Import checking passed
for 577 files and 1750 relative imports. The new in-process regression uses
fixture provider/verifier ports: project PASS + acceptance FAIL -> trusted
feedback -> private planner reservation -> independently admitted second epoch
with new Task bindings -> fixture PASS. It does NOT prove real Docker, actual
Rust credential issuance, a changed source SHA or a production recovery.

The researcher-negative Docker control now additionally requires five or more
known check IDs, with timeout and unclassified flags false, before accepting
its negative result. Its test assertions are unchanged. CI must validate the
actual reporter and Docker environment.

Local Docker is unavailable. Unix IPC tests cannot listen in this workspace
(EPERM); the new authenticated-IPC test is committed for CI and has not been
validated locally. No permissions were relaxed to bypass this restriction.

## Next required milestone

The native paid-pilot harness still nominates repair targets from compiler
locations. This commit does not invent acceptance source attribution or claim
paid acceptance recovery is complete. Add a separate zero-billing native
fixture where project tests PASS and acceptance fails on an actual source
behavior, derive actionable source/role scope through original Gateway grants
and confirmed reads, then demonstrate fresh Rust child credentials, a new
signed DAG, real source repair, exact-new-SHA Docker PASS and retired-root draft
PR. Until that evidence exists, a further paid experiment is premature.

No paid workflow was dispatched. Main remains unchanged.
