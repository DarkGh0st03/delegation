# R137 — Owner-controlled execution of independently admitted repair DAG

30 October 2026, branch refactor/post-prof-plan-contracts-20261021.

R137 adds `executeTrustedAdmittedRepairDag`, a trusted owner-only
controller over R133–R136. It reads the signed epoch through the
original live root-bound `TrustedOperationalEpochIntake`, computes
a deterministic topological order from the signed dependency graph,
preallocates distinct Child DC identities, then executes tasks
one by one.

Every Task undergoes the Gateway's independent R135 dependency check,
private Task binding, one-use native Child DC issuance, protected
A2A sending and R136 Gateway observation confirmation. The next Task
cannot start if an A2A result is unsupported by independently
attested provider effects. A source-free Gateway confirmation is
required after each Task, never a model-supplied completed flag.

After an ambiguous issue, the controller never auto-retries. It
also blocks reentry for the same Coordinator/session/epoch locally;
the fsynced issuance journal and Gateway Task bindings separately
protect against process restarts and duplicate credentials.

The offline regressions exercise sequential Backend repair then Test,
replayed executions, unconfirmed Backend Artifacts and duplicate
Child DC allocations. Provider effects and Rust issuance in this
fixture are scripted, not actual Gitea/EVM/Docker.

The controller intentionally reports
`docker_pass_verified:false` and `pull_request_created:false`
even after signed DAG Tasks are Gateway-confirmed: post-retirement
exact-SHA Runner attestation and a review-only PR are separate
remaining milestones. The known historical Functional Signed DAG
fixture still attempts the forbidden same-Task FAIL recovery path.

No Gemini-paid calls, no main merge.
