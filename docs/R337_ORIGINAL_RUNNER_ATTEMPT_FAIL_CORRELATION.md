# R337 — Correlate a native FAIL with an immutable Runner POST attempt

R336 authenticated and durably sealed an actual negative Docker result.
R337 closes the missing link to the exact pre-existing one-shot
Runner launch, which must be reserved before the HTTP request.

The owner-only Runner intent journal adds read-only
`assertAttempted` verification. It requires both the original
committed intent and the complete immutable attempt record, exact
root/Task/Child/request/fingerprint/expected-SHA matching, and the
absence of any already completed PASS for that Task.

Both the FAIL publisher and its independently constructed reader
require that original journal and recheck it after asynchronous Gitea
reads. The native Runner executor refuses a mismatched journal object
on startup. An unattempted Test, foreign attempt or conflicting PASS
cannot produce recovery failure evidence.

Offline tests cover missing attempts, successful immutable reads,
changed request fingerprints and a prior PASS. No changes to
the actual Runner PASS criteria, immutable Engineer authority, or
the ADK/A2A role channels. No paid AI or main mutation.

Next gates are a disposable real Docker FAIL with a native Rust/EVM/OPA
Test Child and an independently verified D1 owner preflight. This
does not yet authorize D1 or prove autonomous repaired code.
