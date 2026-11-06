# R350.14 — ADK verified-source branch correction

The R350.13 reviewed-native run #42207993020 failed at preliminary Planning, before Engineer approval or any native Backend/Frontend/Test execution. Categorical diagnostics proved one Gateway prepare and execute, two scripted ADK turns, no legacy HTTP VP, but zero verified source reads. The read output was rejected inside `TrustedAdkReadOnlyPlanner`, which still hardcoded `result.branch==="main"` despite the original trusted source pin allowing the reviewed disposable feature branch.

The Planner now compares the returned source branch to `trustedPlanningSourceBranch(snapshot)` throughout: model function schema, input checks, trusted read-port response, and final ADK grounding. A new **offline** test runs the actual ADK Runner with a scripted two-turn authority-only model and verifies the source read and permission-only proposal, then confirms that an untrusted provider result claiming `main` is denied.

The change neither broadens the approved authority nor bypasses the signed snapshot; the feature source must be explicitly trusted, otherwise `main` remains the only acceptable source. Native Rust VP, OPA, Gitea writes, Docker and signed root issuance are not simulated as passed by this test.

Next: after free focused CI, rerun the reviewed-native disposable R331 E2E, then inspect any new evidence. No paid model calls, main changes or merge.
