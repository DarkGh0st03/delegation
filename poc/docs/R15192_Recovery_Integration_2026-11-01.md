# R151.92 — first recovery integration changes

Baseline: `c895dd46eb598a7f5321e35d2a0c5b3409f67e30` (R151.91).
Paid run inspected: 41317762037, artifact 13088128083. It reports two
Backend test files failing and D1 planning stopping, but contains neither
failed assertions nor generated source. The actual code/test fault and the
historical first D1 exception remain unproven. No paid calls were made.

## Changes

- Failed test paths are bounded Runner evidence, not resources to read.
  Source candidate selection no longer requires a read grant on every failed
  test. It still requires the original role's read/update pair in both signed
  approval and root, an observed unambiguous source write, and exact Runner SHA.
  Test paths/content are not exposed or granted by this change.
- Original and admitted repair A2A Tasks receive the approved requirement and
  their signed description as separate JSON fields inside the instruction.
  Both come from authenticated plan state; permissions are unchanged.
  Planner guidance requests scenario-independent functional briefs and
  consistent interfaces/error cases/verification criteria.
- Owner telemetry distinguishes feedback, history, discovery, planner preflight,
  proposal, validation/reservation, admission and execution. Native paid scope
  selection has its own phase. Both public sanitizers retain these fixed values.
  Observer failures cannot change authorization or cleanup behavior.
- Fast CI includes the relevant scope, context and real IPC owner handoff tests.

## Local validation

101 targeted tests passed (scope, original dispatch, ADK planning, repair proposer,
public diagnostic filters). Scaffold/import/type-only/runtime-symbol audits passed.
Node here is 24.22.1; GitHub CI uses the pinned 22.15.0.
IPC integration tests cannot run here: Unix socket listen returns EPERM.
Docker is absent. GitHub Fast CI must verify the selected IPC integration tests.
No Docker PASS, full CI success or complete recovery is claimed by this note.

## Remaining integration work

1. Preserve access-controlled generated source/test revisions and failed assertions;
   the old sanitized artifact cannot retrospectively establish fault attribution.
2. Support diagnosis and authorized correction of faulty generated tests, or a
   classified request for Engineer approval when read/update grants are missing.
   This patch intentionally does not let a test failure authorize test rewriting.
3. Exercise the exact pilot entry point using scripted models and actual Gitea/Docker
   for implementation failure and generated-test failure. Verify fresh SHA,
   independent acceptance, PR review-only, Security CI and root closure.
4. Run the full offline gate on the final integration SHA, then consider a separately
   authorized paid pilot.

The native owner already invokes TrustedRetiredRepairAcceptanceWitness after D1
execution. The controller's gateway-confirmed status is deliberately not a final
Runner verdict; its label alone does not prove the final verification is unwired.
Do not duplicate that mechanism without testing the existing witness path.
