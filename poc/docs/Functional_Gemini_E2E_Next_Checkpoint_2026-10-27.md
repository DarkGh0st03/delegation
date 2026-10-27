# Next functional milestone: Gemini on the new signed DAG — 27 October 2026

## What is already demonstrated

The **non-billable** Department Directory end-to-end workflow, `.github/workflows/functional-signed-dag-e2e.yml`, succeeded at commit `d3045d29e48808cbab7c28f84342686786642989`, run [#40478025280](https://github.com/DarkGh0st03/delegation/actions/runs/40478025280).
It exercised a disposable **real Gitea**, the **Google ADK/A2A scripted model** (no paid inference), an Engineer **fixture** signed with Ed25519, native Rust DC/VP, live Gateway/OPA, the Docker test runner, and creation of an **unmerged** Pull Request. The workflow published a sanitized artifact named `functional-signed-dag-department-directory`.

This is evidence of the **new functional signed-DAG integration**, not of natural-language model autonomy, a real human Engineer, live Gemini model inference, physical private-runner attestation or R5 GO.

## Functional bug identified and corrected

The live Gemini owner continuation, `bindProtectedGeminiApprovedExecution`, previously omitted `issuanceJournalDirectory` while the canonical Engineer Host required it. Commit `181fc2f` brings the Gemini Execution argument contract into alignment with the actual protected Host and adds positive/negative tests. The dedicated F0 workflow now additionally runs those Gemini owner/dispatch bridge regressions **without** invoking an API.

The F0 reproducibility benchmark remains unchanged: no Gemini API key is injected into this workflow.

## F1: real Gemini Planner reading disposable real Gitea (NEXT)

Build a separate explicit opt-in *read-only Planning* scenario over the same freshly seeded disposable IAM Console. The source and requirement must not contain the golden implementation or the pre-scripted answer. Reuse `TrustedAdkReadOnlyPlanner`, `createGeminiAdkModel`, the original Planning Coordinator and the Rust/Core/Gateway/OPA authenticated read port.

Accept **one unapproved proposal** only when its source SHA, repository, read observations, tasks, dependencies and proposed permissions can be evaluated independently. Preserve sanitized metadata and provider-measured usage/cost separately; do not conflate a model turn with a paid API request. An unsatisfactory proposal remains a failed experiment, not a reason to auto-sign a plan or substitute the known golden plan.

**Billing gate:** no Gemini inference without the user's separate, explicit paid API authorization and a bounded real model budget. Preparing F1 or running its offline regressions is always free. No automatic push-triggered billable workflow.

## F2: full generative execution after human review

On a fresh disposable source revision, stage the authentic Gemini proposal. Have the real Engineer **inspect and explicitly approve** only the intended Task/permission subset. Then execute that very same immutable approved DAG with actual Gemini-backed Backend, Frontend and Test A2A roles through Gateway/OPA/native Rust and real Gitea/Docker.

A successful result must show: real model identity and bounded inference, authentic proposal and signed review, exactly pinned Gitea base/branch and generated commit SHA, expected code changes, project + researcher acceptance, one PR opened without merge, and confirmed authority closure. Never substitute a scripted model result or CI-only signing fixture while describing the test as real human-reviewed Gemini E2E.

Any F2 exercise that intentionally uses a test Engineer signature or synthetic approval must remain labeled as a disposable **functional fixture**, not production trust.

## Explicitly postponed until after functional validation

No new OIDC/mTLS/private-runner deployment, advanced recovery, or independent blockchain attestation is a prerequisite for the initial disposable *functional* G1/G2 experiments. Keep core DC/VP, plan-scope, Gateway and OPA enforcement **enabled** throughout. Continue threat modeling in parallel as requested by the professor; implement additional mitigations only when a concrete risk or a failing experiment justifies them.

## Gates

- **F0** signed deterministic end-to-end: passed on the pinned historical run.
- **F0.1** Gemini owner/Host journal contract: patched; require latest CI to pass before promoting this checkpoint.
- **F1** real Gemini read-only Planning on disposable actual Gitea: not yet executed.
- **F2** real Gemini Planner + agents + separately authenticated human review + completed PR: not yet executed.
- **R5** external private distributed trust and independent attestation: NO-GO, separately tracked.

Do not equate any F0/F1 fixture or an earlier legacy Gemini workflow with F2.

## F1 functional-quality gap explicitly recorded (27 October 2026)

The scripted Google ADK/Gitea Planning rehearsal is a **technical integration**
test, not evidence that the model produced a complete feature implementation
plan. Its fixed unsigned proposal requests \`run_tests\` but has **no Test Agent
task permission to write or create regression tests**. Therefore its
independently assessed functional completeness is **false**, despite a
successful schema/role/source technical preflight and a working deterministic
Gitea/Docker reference implementation.

The functional workflow publishes this distinction as sanitized evidence:
\`f1_scripted_proposal_functionally_complete:false\`,
\`f1_scripted_plan_missing_concrete_test_implementation:true\`, and
\`f1_real_gemini_plan_quality_not_yet_measured:true\`. Changing the scripted
test to silently claim completeness is a fail-closed regression.

The separate \`poc/scripts/f1-department-directory-functional-review.mjs\`
checks backend service/API, frontend API/UI, explicit regression-test
implementation, real test execution, DAG dependencies and PR ordering.
It is **diagnostic**, not Engineer consent or proof that generated code works.
The billable real-Gemini research probe writes a separate
\`functional-review.json\` for an Engineer to consider. No automatic
signature, operational delegation or merge follows a good score.

