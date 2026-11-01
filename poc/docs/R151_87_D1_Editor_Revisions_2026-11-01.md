# R151.87 — D1 editor effect and revision verification

## Observed failure

Paid run 41298432162 on cb1e936d051b8c276cd70cccd465083c1eab519f reached
Docker: dependency installation passed, typecheck failed with TS2367/TS2820.
Backend and Frontend had no observed tool failures. Paid D1 consent was enabled.
The reported assertion location is the owner's post-Gateway editor check requiring
a changed branch HEAD. The report does not identify which editor, its D1 writes,
or prove final root revocation. No repaired Docker PASS is attested.

Historical causal attribution remains unknown. This change must not be described
as proof that Gemini did no work or as a proven fix of that particular execution.

## Narrow correction

A changed HEAD alone cannot prove that the current repair editor produced it.
A targeted regression demonstrates that an unrelated branch advance satisfies the
old inequality while the current Task has no observed update. The new owner gate
requires an update_file receipt attributed to the current Task/runtime Task/DC,
role, branch and originally admitted source path. Its latest provider commit must
equal the current Gitea HEAD and differ from the prior verified revision.

Enrich the existing observedImplementationWriteKeys collection from a Set to a Map
of source-free receipt metadata. There is no second effects registry or new service.
Original counts and membership semantics are preserved. D1 prepare requests must
match the owner's already admitted runtime binding; Gateway still independently
checks the credential and operation. The owner receives a verification closure,
not arbitrary model-supplied receipts. Only the verified result updates the SHA
used to arm the next editor or Test. Failure aborts the controller callback before
its next child issuance or dispatch. Generic read-only A2A tasks remain unchanged.

Public failure evidence contains only role and a fixed category: missing editor
write, baseline mismatch, effect binding mismatch, provider/HEAD mismatch, or
unchanged revision. Both existing pilot sanitizers whitelist these fields.
No raw paths, credentials, source, automatic retry or permission expansion.

## Validation scope

Five revision tests cover no current write/foreign task, valid write, consecutive
Backend and Frontend revisions, mismatched role/branch/runtime/DC/path, unchanged
revision and final commit ordering. Existing sanitizer tests plus the new bounded
D1 event test pass (19 tests total locally). Static imports and type audits pass.

The real controller integration test exercises missing observed receipt, mismatched
HEAD, and valid receipt with independent Gateway completion. Rejections must stop
before the Test child is issued; success sends Test only after the final revision
is verified. Local execution is blocked by Unix-socket EPERM, so CI must run it.

The existing Functional Signed DAG E2E runs real Rust/OPA/Gateway/Gitea/Docker and
scripted models, including Backend+Frontend typecheck repair through final Runner,
root retirement and draft-only PR. This now crosses the strengthened owner gate.
No additional long E2E scenario is added. All three mandatory CIs must pass this
same SHA before considering another separately authorized paid pilot.

No paid Gemini run was dispatched. Generative repair correctness remains unproven.
