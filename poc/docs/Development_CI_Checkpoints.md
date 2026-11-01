# Development CI and candidate checkpoints

On refactor/post-prof-plan-contracts-20261021, Fast CI runs automatically on push.
It uses Node 22.15.0 and lockfiles, static imports/type-only contract audits,
selected authorization/Gateway/ADK/A2A tests, real loopback MCP integration and
pure pilot-gate/diagnostic tests. It makes no paid provider calls and does not
build Rust or launch Gitea/OPA/Anvil/Docker. Type-only audits are not a full tsc
compilation of every project. This is a fast regression sample, not full coverage.

The linked GitHub app can issue a normal git commit but cannot dispatch
workflow_dispatch directly. To request a full checkpoint without human UI clicks,
the assistant updates ONLY `.github/ci-checkpoints/full-ci-request.json` in a checkpoint
commit with the fixed `[full-ci]` label. The resulting push automatically
runs these existing workflows on that exact branch/SHA:

- cumulative-refactoring-offline.yml
- shared-mcp-real-positive-e2e.yml
- functional-signed-dag-e2e.yml

Only this exact file path triggers Cumulative and Functional on development.
Shared MCP retains its original main/spike and PR event filters; development
source pushes may create a skipped Shared MCP run, but never start its expensive
Docker job without a matching checkpoint file change and commit label.
Other heavy R139 Docker repair CI remains manual. No test or assertion in the
three full workflows is removed. Each checkpoint commit produces a NEW SHA,
so the exact-SHA pilot gate must verify that SHA, not its parent.
No Gemini inference is initiated by a checkpoint push.


The Gemini gate remains unchanged: Fast CI cannot replace the three full
SUCCESS runs on the same SHA. workflow_dispatch provenance is already accepted.
Do not advance the candidate branch between full validation and the paid pilot.
Paid dispatch and its optional D1 epoch require separate explicit authorization.

This configuration change needs its automatic Fast CI validation. It does not
itself dispatch the three full workflows or authorize paid inference. The earlier
R151.89 full-CI evidence applies only to d7f98c82022219319cd2055719d16a8dd2e52b9f,
not to a later configuration commit.

Repository rulesets read returned an empty list. Classic branch-protection
required-check settings were inaccessible to the GitHub integration (HTTP 403);
no assertion that those settings are absent is made. No main/PR trigger or
branch-protection setting is modified by this change. If a required full check
is needed for a PR, dispatch that workflow on the PR candidate revision.
