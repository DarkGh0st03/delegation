# Development CI and candidate checkpoints

On refactor/post-prof-plan-contracts-20261021, Fast CI runs automatically on push.
It uses Node 22.15.0 and lockfiles, static imports/type-only contract audits,
selected authorization/Gateway/ADK/A2A tests, real loopback MCP integration and
pure pilot-gate/diagnostic tests. It makes no paid provider calls and does not
build Rust or launch Gitea/OPA/Anvil/Docker. Type-only audits are not a full tsc
compilation of every project. This is a fast regression sample, not full coverage.

Run the three existing full workflows manually at a frozen candidate SHA:

- cumulative-refactoring-offline.yml
- shared-mcp-real-positive-e2e.yml
- functional-signed-dag-e2e.yml

All jobs and assertions are preserved. Shared MCP still runs for main/spike
pushes and PRs. Its PR filters are unchanged. The standalone R139 real Docker
repair workflow is also manual on the development branch to avoid a fourth
long automatic Docker run. Specific security workflows retain their existing
triggers; they can still run for relevant code changes.

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
