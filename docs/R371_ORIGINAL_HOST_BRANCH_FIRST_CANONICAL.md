# R371.1 — Protected `main` and first native branch-first worker

The R371.0 native CI [42343999180](https://github.com/DarkGh0st03/delegation/actions/runs/42343999180)
FAILED at pre-approval fixture setup with Gitea HTTP 403: the
original **`main` branch is protected against direct updates**.
This is the correct security boundary. Neither branch protection
nor Rust/OPA policy is weakened or circumvented.

R371.1 narrows the native integration gate responsibly: the **original,
unresolved, protected main** starts at its authentic pinned baseline,
and the feature branch is absent. No app reference or preapproved
feature branch is staged by the test owner.

Under one original Engineer-signed authority-only approval, read-only
Planning reads a real source file from `main`. The original Review
Host's canonical launcher then makes its FIRST root-owned Task
`create_branch`, durably stages the one-shot native Rust VP + OPA +
Gitea POST, and independently re-opens the created branch.
Only after this independent Gateway completion can SDK A2A start.
The model selects a Backend Task with exact `read_file` and
`update_file` permissions for the existing source
`apps/backend/src/users/user.service.ts`. A real native Child Rust
credential, two-effect read→CAS journal, Gateway, OPA, Gitea and
independent mutation evidence must all succeed.

An explicit free scripted ADK `blocked` decision terminates the
session after this Backend Task: **no Frontend, Test, Docker Runner
or Draft PR in this R371.1 proof**. R370 continues separately to
prove full three-specialist Docker acceptance and Draft PR but starts
from a test-owned prepared feature branch. The final combined
original protected-main → autonomous feature generation → Test →
Draft PR remains open.

Expected minimum: 2 independent Gateway completions
(root create_branch + Backend read/CAS), one native Child,
one Gitea CAS, one native branch POST, zero paid model calls,
main byte-for-byte unchanged, root retired after bounded stop.

No human GUI click, no generative code synthesis beyond a scripted
source append; code is a test fixture. GitHub PR #38 remains Draft.

## R371.2 source-branch guard correction

The R371.1 attempt [run 42344529541](https://github.com/DarkGh0st03/delegation/actions/runs/42344529541) failed **before** root issuance. The Review Host legitimately rejects an explicit `snapshot.planning_branch="main"` override when the approved work branch is `feature/account-suspension`. The correct pre-existing branch-first contract is to **omit** that optional override: the original Planner's read-only default is `main` (as in R354), while `workBranch` remains the signed feature branch. The snapshot also lists only files genuinely present in protected, unresolved main. No validation or branch-protection rules are weakened. Still unverified until the new native workflow passes.

## R371.3 — distinguish approved Branch from internal CAS stage

The next native attempt [42344836233](https://github.com/DarkGh0st03/delegation/actions/runs/42344836233) progressed through original root Branch, SDK A2A Backend read and Gitea CAS update, but failed a **test-only counter** asserting one POST to `/branches`. The original Gitea conditional write legitimately creates a separately hashed `feature/r302-internal-*` staging ref by an additional POST; it then CAS-swaps the approved feature HEAD. The R371.3 test now authenticates **one approved branch POST plus one private internal CAS staging POST** and rejects all unexpected branch names. No double issue, duplicate task or relaxed provider behavior is introduced. The full native run remains pending until this assertion and all cleanup pass.
