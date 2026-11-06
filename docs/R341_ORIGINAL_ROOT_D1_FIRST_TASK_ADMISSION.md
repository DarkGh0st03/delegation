# R341 — First new D1 repair Task under the original Engineer root

## Before this change

R338 real native ADK/A2A Rust/EVM/OPA/Gitea/Docker typecheck FAIL
and authenticated HMAC evidence completed successfully. R339/R340
added a root-, Child-, original-Runner-, and Gateway-flight-bound
read-only recovery preflight. The latter returned
`task_registered: false` and did not advance any Task epoch.

## First owner-only admission

`admitFirstNativeD1RepairTask` re-runs the R340 preflight
against the **live trusted objects**, never accepting model/A2A
serialization as proof. Under one unchanged signed Engineer root,
it builds a new Coordinator Task with:

- a fresh owner-generated Task ID;
- the immediately following epoch;
- a trusted-registry agent role and the exact preflight-validated
  subset of the original Engineer permission ceiling;
- original session, signed objective, branch and baseline revision;
- **only the completed dependencies of the failed Test**, never a
  dependency on the incomplete failed Test Task.

Before Coordinator registration, a mode-0700 owner journal writes
one mode-0600, O_EXCL, fsynced reservation keyed to the original
failed Test Task and Runner request. A crash or simultaneous
admission cannot consume the same verified FAIL twice.

The existing Coordinator independently enforces card capabilities,
authority ceiling, fresh epoch, task identity and append-only
registration. The returned result explicitly has
`gateway_registered=false`,
`child_credential_issued=false`, and
`recovery_execution_authorized=false`.

## Validation and boundaries

Unit regressions exercise one valid first Task, missing/fake failure,
out-of-root permission, one-use reservation, crash ambiguity and a
shared directory denial. These tests use mock collaborators and
do not establish a complete native D1 recovery execution.

**Outstanding:** enroll the fresh Task/Child via native Rust/Gateway,
run the actual repair with ADK/A2A, and require a new independent
Docker PASS before PR review-only. The old failed Test remains
incomplete; the new repair is a distinct Task in the same signed
authority. No paid inference or mutation of GitHub `main`.
