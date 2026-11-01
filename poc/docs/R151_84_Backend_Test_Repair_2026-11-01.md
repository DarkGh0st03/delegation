# R151.84 — Original-root repair after a real Backend test FAIL

## Scope and motivation

Paid run 41243217022 passed typecheck and failed backend_tests. Its repair
flag was enabled, but the phase was not eligible for bounded D1. R151.82
preserved internal Vitest failure files; R151.83 restored all three free CIs
with project E2E serialization. This checkpoint addresses the Backend phase.
It does not reconstruct the missing assertion from the historical paid run.
Frontend test, build, Playwright and dependency failures remain ineligible.

## Trusted evidence and authority

The existing Gateway failure ledger constructs project_test_failure only
from a completed real Runner failure on the pinned branch/SHA, ordered
installation PASS -> typecheck PASS -> backend_tests FAIL -> later SKIPPED,
project FAIL and acceptance SKIPPED. At least one bounded sanitized Vitest
failure file is required. The real Runner extracts such files only for
non-timeout test failures. The private summary has only phase and a 1..8
failed_test_file_count. No assertion, log, source or file path enters model
planning feedback. Authenticated owner IPC validates the exact schema,
phase and absence of compiler codes or mixed acceptance metadata.

The source scope collector independently checks the actual Runner receipt,
SHA, ordered phases, original signed grants and original Gateway writes.
Every failed test file must have an original signed read grant and root
read permission; it is not disclosed to another role. Candidate source
files must have one unambiguous original Backend writer, a read/update pair
in one original Task, and both original root permissions. All test/spec
files are excluded from source repair. A count alone cannot name a causal
file or grant authority. Unknown causality remains explicit.

The native owner supplies this scope through the same private target callback
used by paid and free repair proposers. The bounded ADK proposer requires
matching phase/count, exact tested SHA, original Backend candidates and root
pairs before any model inference. It permits a bounded subset of source
editors followed by exactly one run_tests-only Test Task. Existing signed
new-epoch intake, fresh Rust Child DCs, VP/OPA/Gateway checks, failed-SHA
reads, source write confirmation and new-SHA validation remain mandatory.
No new root, test editing rights, PR or merge authority comes from a FAIL.

## Free proof fixture

A separate opt-in Backend test probe replaces only the existing lifecycle
save in originally signed service source: status nextStatus becomes status
user.status. The program remains well-typed but fails its unchanged Backend
behavior tests. No candidate test or researcher assertion is modified.

The exhausted original scripted Backend model is armed only for its new
signed D1. It reads original authorized candidates on the actual failed SHA,
finds the seeded semantic statement and repairs the observed source. It
does not copy a reference implementation into D1. The fresh Test executes
all project phases and independent acceptance in Docker on the new SHA.
The harness then requires independently confirmed original-root revocation,
durable retirement and a signed draft-only PR, without merge. The preliminary
non-generative child clears the new probe flag; fixture modes reject paid
Gemini and mixed fault flags.

Functional CI runs this proof before existing acceptance, mixed TypeScript,
ordinary, negative and single TypeScript recovery regressions. A successful
scripted proof demonstrates the execution/delegation path, not Gemini's
ability to reason about an unseen defect.

## Validation at publication

45 focused tests passed locally with pinned Node 22.15.0 (43 proposer,
scope, scripted editor and preliminary-environment cases, plus actual
Gateway ledger/feedback/planner roundtrips for Backend and acceptance).
The authenticated Unix IPC regression runs in GitHub CI, where sockets are
available; the real native free proof also traverses that HMAC boundary.
Static imports: 589 files / 1783 relative imports; type contract audit:
312 files / 476 named imports; runtime contract audit: 14 entrypoints /
150 symbols. Full remote Docker evidence must still validate this commit.

No paid model run has been launched. Frontend test repair needs its own
bounded implementation and free proof before a new paid pilot is considered.
