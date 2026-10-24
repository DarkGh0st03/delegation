# R4 security checkpoint and R5 readiness (23 October 2026)

**Scope:** branch `refactor/post-prof-plan-contracts-20261021`, NOT `main`.
**Decision:** **R5 is NO-GO at this checkpoint.** Do not invoke paid Gemini
Developer API or merge a branch on the strength of an offline CI result.
This is a controlled evidence ledger, not a claim of human approval.

## What the current offline system really tests

| Boundary / threat | Canonical evidence | Meaning and limit |
|---|---|---|
| Model proposes extra permission | `poc/apps/gateway/test/approved-execution-plans.test.ts`; `poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts` | Unapproved operation and Engineer-signed permission subset fail closed; a signed digest alone is not Engineer authentication |
| Changed plan, task, agent, resource or DID | `approved-execution-plans.test.ts`; `trusted-reviewed-adk-dag.test.ts` | Bound Task and authenticated plan digest are checked independently of DC/VP/OPA |
| Source scope, unsafe path, unordered conflicting edits | `trusted-adk-planner.test.ts`; `offline-planning-dag.test.ts` | Compile unapproved proposals from a pinned repository inventory; production model source reads remain bounded |
| Main/branch tampering | Gateway provider, MCP and OPA tests; `poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs` | Approved work goes to its own feature branch; `main` is checked immutable in the disposable real Gitea scenario |
| Replayed, revoked or stale authority | Gateway execution tests and native Rust/EVM Planning-to-Execution test | One-shot Gateway request, VP verification, Planning root revocation and active lease are separately enforced |
| Task result spoofing | `poc/apps/gateway/src/approved-execution-plans.ts` and attestor regressions | A2A/model claims cannot independently mark a Task complete; trusted provider evidence and attestation are required |
| Unverified PR | `poc/apps/gateway/test/approved-execution-plans.test.ts`, `gitea-client.test.ts` | An Engineer-approved PR operation alone is insufficient: trusted completed Runner acceptance must pin the exact feature SHA; subsequent source edits invalidate it |
| Native end-to-end | `.github/workflows/cumulative-refactoring-offline.yml` | Both Account Suspension and Department Directory are scripted on one IAM-console baseline but use actual Rust/EVM, OPA, ADK/A2A, MCP, disposable Gitea, Docker acceptance and an open PR |

**Specific R4 changes:** `96ac687` exact-SHA PR gate; `c8a7d94`
preserves legacy Task-completion fixtures without giving them verified PR
authority; `9472dfe` missing Engineer permission/incomplete Runner/racing
Gitea response negatives; `140414f` rejects PR authorization after
subsequent approved source modification.

**Evidence checkpoint:** cumulative CI `39971531148` (commit `c8a7d94`)
completed successfully. For the later commit `140414f`, separate
`approved-plan-gate` run `39972755961` and `gateway-offline` run
`39972755952` succeeded. Cumulative run `39972755955` had four successful
jobs and the EVM job still running at this writing. **Do not promote that
checkpoint to fully green without independently checking its conclusion.**
CI: https://github.com/DarkGh0st03/delegation/actions/runs/39972755955

## Remaining security / experimental limitations

1. **The models in the unified real-provider E2E are offline scripted.**
   The two reference implementations target separate requirements on the
   **same** pinned IAM Console source tree with the historical file set.
   No claim of arbitrary project support or real Gemini-generated code.
2. **The PR race is detectable, not atomically preventable.**
   `GiteaClient.createPullRequest` compares the attested SHA with the
   preflight branch HEAD and requires the matching response SHA. If the branch
   changes during POST, Gitea may create a PR before the mismatch is detected.
   Such a response is rejected as attestation; no automatic merge follows.
3. **No deployed persistent trusted Engineer host.**
   `poc/apps/orchestrator/src/trusted-engineer-host.mjs` is loopback-only;
   it does not provide an authenticated remotely reachable runner-to-host
   channel or a deployed live Planning root/session.
4. **The old billable GitHub workflow is NOT the new canonical workflow.**
   `.github/workflows/gemini-paid-shared-mcp-final.yml` invokes
   `a2a-production-coordinator-mcp-gemini-live.mjs`, which uses
   `AccountSuspensionSequentialCoordinator` and the original fixed 11-file
   scenario. It does **not** run the new OIDC-admitted, independently signed
   Planning/Engineer approval pipeline. It must not be used as R5 proof.
5. **The no-cost manual workflow validates only event inputs.**
   `.github/workflows/trusted-gemini-dispatch-preflight.yml` does not
   create a root, authenticate the Engineer, execute agents or charge API
   credits. GitHub OIDC authenticates a workflow job, not human consent.
6. **Legacy cleanup is mandatory but must be evidence-driven.** Before R6
   deletes any files, inventory static/dynamic imports, npm scripts, Rust
   crates, workflow entrypoints, Docker/env configuration and external
   runners. Remove in small batches only after equivalence tests and
   independent real-provider acceptance. Do not delete paid historical
   evidence merely because it is not on the canonical path.

## R5 technical go/no-go checklist

**NO-GO until all are demonstrated on the same immutable commit:**

- [ ] Full cumulative R4 offline CI passes (five out of five), including both
      independently accepted real-provider software requirements and an open,
      unmerged PR; include exact run URL and head SHA.
- [ ] An authenticated *persistently running* Engineer host handles a real
      Planning session, provenance checkpoint and **independent human-signed**
      permission subset (not a scripted reviewer). Its root issuance/revocation
      and crash-recovery journal survive restart/failure.
- [ ] GitHub OIDC admission reaches that host over an authenticated channel.
      The token's repository/workflow/run/attempt/subject and source SHA are
      pinned independently; replay ledger and run freshness are enforced.
- [ ] The actually billable Gemini ADK Planner and three Agent roles use the
      **same approved** Task dispatcher, private MCP signing path, normal
      Gateway/native Rust/OPA and real provider stack. Do not redirect to the
      legacy `AccountSuspensionSequentialCoordinator`.
- [ ] Exactly scoped input/model/turn/token/time budgets, no retry on billable
      failure, limited API-secret exposure, capped account spend and abort
      procedure are confirmed **before** any request.
- [ ] Explicit fresh user approval to incur API charges is obtained; it is
      distinct from technical CI green, GitHub job authentication and the
      Engineer's Ed25519 plan authorization.

**After R5:** preserve experimental receipts and perform R6 dependency-graph
cleanup; then rerun every retained offline security and real-provider check,
before any R7 baseline freeze or decision on merging `main`.

Do not auto-dispatch a paid workflow, fabricate a human review, call
`merge_pull_request`, or change `main` from this checkpoint.

## R5 non-billable Planner budget hardening — 24 October 2026

The R6-29 cleanup baseline `adb1baa4b915a811630fbb299751c8df409e5ccf` passed
[cumulative offline CI #40100508975](https://github.com/DarkGh0st03/delegation/actions/runs/40100508975)
on all five jobs, same SHA.

Before any real paid Planner request, the canonical
`TrustedAdkReadOnlyPlanner` now configures an actual ADK
`generateContentConfig.maxOutputTokens` (default 8192, range
1..32000) and accepts a bounded per-call `maxModelCallMs` (default
60000, range 1000..360000). Existing turn count and trusted read budgets
remain active. Calls receive a combined cancellation signal and late
responses after the deadline fail closed. Offline regressions reject
bad budgets, inspect the ADK model request and exercise an uncooperative
scripted response after timeout.

**Limits:** AbortSignal delivery is cooperative; a provider that ignores
cancellation may still perform/bill a remote operation. These checks do
not create an overall Planner runtime budget, ensure live API spend caps,
prove the current Gemini model API supports an exact token cap, authenticate
a remote Engineer, or complete R5. A real host-level hard deadline,
credential-scoped provider abort/cleanup and account-level spend controls
remain necessary before explicit paid authorization.

Only mark this hardening verified after 5/5 cumulative offline CI on the
changed commit. R5 remains NO-GO; neither the archived paid workflow nor
`main` is changed, and no external model request was made.

### R5 Planner timeout regression correction (24 October 2026)

The first cumulative validation of Planner budgets, CI
[#40119952815](https://github.com/DarkGh0st03/delegation/actions/runs/40119952815)
on `61b2ad2938be9b5a99c072f4455e199a059e8b83`, found a **test
expectation error** in the scripted non-cooperative timeout case. The ADK
Runner reports a model-generation failure as an event; the trusted Planner
intentionally returns the generic fail-closed
`no verified read-only grounded proposal` denial rather than
propagating internal provider exceptions. The regression incorrectly
expected the internal `model call timed out or cancelled` text.

The focused correction requires the correct public fail-closed denial and
still separately asserts that the model received an **aborted** deadline
signal. This retains the timeout and token bounds and does not weaken any
policy or permission. Do not certify this follow-up until a new exact-SHA
five-job cumulative CI succeeds. R5 remains NO-GO.
