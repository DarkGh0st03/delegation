# R101 — Private operational epoch journal (29 October 2026)

The original Engineer signature remains pinned to the first plan and the actual Rust operational root. This increment adds a durable owner-only Task/plan history, *not* a new delegation authority or an active Gateway admission.

- `TrustedOperationalEpochJournal`: writes each candidate plan to an O_EXCL/O_NOFOLLOW file with fd+directory fsync before any future child-DC/A2A/provider effect; checks all prior epoch records, plan hashes, Task IDs and root pins. The only supported recovery on corrupted/uncertain data is fail-closed/manual review.
- `TrustedOperationalEpochIntake`: reloads the independently verified original Engineer receipt through `SignedEngineerApprovalFileStore`, re-reads `TrustedExecutionCoordinator.trustedOperationalAuthority()`, compares the issued root's *actual* permission set with the approved initial subset, and invokes R100 preflight for the new epoch. This owner-private preflight has **no execution authority**.
- No Editor/Engineer interaction is required for repeated contained planning epochs *conceptually*, but the current Gateway and child issuer still recognize only first-plan Task IDs. It would be unsafe to treat these journal entries as if Gateway already accepted them.
- Next increment: trusted, epoch-aware dynamic Task admission plus Rust child-DC emission and correlated VP/Gateway/OPA checks. In particular, do not bypass `TrustedApprovedExecutionPlans` while designing the new admission path.

Offline tests cover repeated plans and different roles, denial of unauthorized operations, repository/branch drift, role substitution, replay, concurrency, root changes, revocation and corrupted records. Do not claim real E2E fail → repair → PASS yet.
