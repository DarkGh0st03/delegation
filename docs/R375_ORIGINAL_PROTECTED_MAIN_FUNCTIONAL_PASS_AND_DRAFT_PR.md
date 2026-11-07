# R375.0 — Protected unresolved main, scripted functional source, Docker PASS, Draft PR

## Reuse and limitations

R374.2 proved the original signed Engineer Review Host could start at the
real, protected and unresolved Gitea `main`, create the original authorized
feature branch, delegate Backend, Frontend and Test with native Rust Children,
observe a genuine researcher acceptance **FAIL**, select a revision, retest
and safely block after another real FAIL. R370 separately proved a complete
Docker **PASS** → attested Draft PR from a test-prepared functional branch.

R375 joins those paths in **one** original owner session. The test-owned
reference fixture `ACCOUNT_SUSPENSION_REFERENCE_FILES` is **not**
inserted into main or the feature branch before Engineer approval.
It is fed as deterministic **scripted offline model output**, not GPT/Gemini
generation. Each model session must first see actual authorized Gitea
source bytes from a signed `read_file`, then perform a full-file
`update_file` through the original Gateway. Project and independent
researcher acceptance run in the real isolated Docker Runner, never
synthetic Test results.

### Contract-preserving Task fanout

The original one-shot sequential journal permits **exactly one read and
one CAS write per registered Task**, never multiple file writes under
one Task, even with directory permissions. Instead of weakening this
security invariant, R375 raises the **owner-only bounded adaptive
decision ceiling from 8 to 16**, still finite and deterministic, and
issues one restricted Child per Task.

The actual plan is 12 decisions: Backend D0, Frontend D0, Docker FAIL,
then seven separately approved source-file edits, another Test,
and finally `ready_for_pr` ONLY after independent Runner PASS.
Each file is separately scoped to the immutable signed Engineer
permission-only grant (17 exact pairs including original Branch, Test
and root Draft PR).

Source files under proof:
`packages/shared/src/account-status.ts`;
`apps/backend/src/users/{user.service,user.controller,user.routes}.ts`;
`apps/frontend/src/api/users-api.ts`,
`apps/frontend/src/pages/UserDetailPage.tsx` and
`apps/frontend/src/styles.css`.

Test and fixture code are not changed in the disposable source repo.
The project baseline tests must remain green and the separate
researcher acceptance spec validates real status transitions,
duplicate 409 rejection, visible UI changes and double-submission fences.

### Acceptance and security

Expected: one original feature Branch POST, nine internal Gitea CAS
staging branches and authenticated file updates, one genuine initial
Docker acceptance FAIL and MAC failure receipt, one current-HEAD
Docker project/acceptance PASS and MAC pass receipt, independent
`ready_for_pr`, then a separate original root-owned, signed and
one-shot Draft PR GET-confirmed as open, unmerged at the tested SHA.
No second root, privilege increase or PR before PASS. The first failed
Test remains forever incomplete. Gitea `main` is unchanged.

No paid inference or model API key, no human GUI signing claim, no
claim of autonomous software engineering. GitHub PR #38 remains
Draft/unmerged, and actual GitHub main is not touched.

The native R375 proof is **pending** until GitHub Actions establishes
SUCCESS. If any original owner, file, Docker or PR attestation fails,
the checkpoint must fail closed rather than claim a PASS.

## R375.1 — Workflow source path correction

R375.0 workflow [#42350171857](https://github.com/DarkGh0st03/delegation/actions/runs/42350171857) failed at preflight: the newly copied workflow referenced a nonexistent old R374-style test pathname. R375.1 points both syntax and actual native invocations to the new R375 test file and updates the checkpoint. No source authority, Rust, policy, read/CAS or acceptance behavior changes. No end-to-end PASS can be claimed before the new run completes.

## R375.2 — exact read-only Planner root scope

Native [#42350354622](https://github.com/DarkGh0st03/delegation/actions/runs/42350354622) correctly refused the Planning read before execution (`no verified read-only grounded proposal`). The enlarged read-only snapshot now lists shared account status before Backend, whereas the original fixture used `.find(operation===read_file)` for its private preliminary Gateway Prepare and Rust VP verifier. The prepared scope was therefore *not* for `apps/backend/src/users/user.service.ts`. R375.2 selects exactly the requested file permission in both operations. No Rust, Gateway, OPA or Planner guard is relaxed; no provider effect or Child had been attempted at the failed checkpoint. Native success still pending.

## R375.3 — canonical Engineer permission order

Native [#42350793761](https://github.com/DarkGh0st03/delegation/actions/runs/42350793761) completed read-only Planning, then stopped at the test harness's `assert.deepEqual(liveRoot.root_permissions,grantPermissions)`. The original Engineer root normalization canonically sorts file URI paths; the scripted fixture instead compared to its own intended source-change Task order (shared first). R375.3 sorts the **unchanged exact same 17 permission pairs** before signing/expectation, keeping operational Task ordering separate from immutable authority. All original verifier/Coordinator constraints are unchanged. No functional native Docker PASS claim until next validation.
