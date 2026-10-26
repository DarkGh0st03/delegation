# Planner Gemini feasibility experiment — R5A (2026-10-26)

## Purpose and boundaries

Test whether the existing `TrustedAdkReadOnlyPlanner` can use a **real Gemini
model** to discover relevant source and propose a reviewable task DAG and
requested permissions. This is a model-feasibility experiment, **not** an
approved Execution, a delegation/security E2E, a merge, or a replacement
for R5's private deployment.

The existing `TrustedAdkReadOnlyPlanner` and `createGeminiAdkModel`
must be reused. Do not create another Orchestrator. The model has ONLY
`read_repository`, `list_directory` and `read_file`; never expose a
write/merge tool or authorization secret to its session.

## Frozen prerequisite (verified 2026-10-26)

The non-billable cumulative workflow #40334337607 passed all five jobs
at SHA `7f83718ed7237d01bc4462a640adddf11e5336b3`.
Later branch edits must pass CI again before this checkpoint is promoted.
The latest code should NOT be represented as green solely because the
earlier SHA was green.

## Independent scenario definition

Use at least two distinct requirements for IAM Console:

1. Account Suspension or a *new* independently specified lifecycle
   enhancement, on a baseline that does **not already satisfy** it.
2. Department Directory search by department, on a baseline that does not
   already implement this behavior.

**Important:** `poc/apps/test-runner-controller/fixtures/
account-suspension-reference.mjs` already contains ACTIVE/SUSPENDED
transition logic and endpoints. Therefore merely replaying that fixture
for the requirement "implement suspension" is an invalid novelty test.
Check the actual, pinned Gitea source BEFORE choosing that requirement.
The pre-scripted `department-directory` fixture includes its own
solution; never show that solved fixture or the offline golden edit lists
to Gemini.

For each run the trusted Engineer host independently pins:
- Repository identity `thesis/iam-console-poc`, its actual Gitea main SHA,
  a bounded allowlist of directories/files, the requirement, and approved
  Agent registry (DIDs and Agent Cards).
- A new unique Planning session and non-main work branch.
- Read-only planning authorization at the pinned Gitea revision.

The model receives only the requirement, source scope, legitimate read
tools and role descriptions as already implemented. It does NOT receive
the reference paths, offline scripted task list or grading rubric.

## Evidence collection

`TrustedAdkReadOnlyPlanner` now accepts an **optional trusted-host-owned**
`onObservation` callback, emitting:
- `model_turn`: attempted/completed bounded model delegate calls.
- `read`: verified/denied reads (approved path on successes only).
- `proposal`: one unapproved result digest, task/permission counts
  and verified read count.

Never record model responses, prompts, source contents, API tokens,
private keys, DC/VP material or runtime authorization secrets in this
observer. A turn is NOT the same thing as a billable provider request.
Provider token/charge usage and confirmation of the Gemini model must
be collected separately from the authorized service. An observer event
is local metadata; it does not independently authenticate a GitHub job
or the Gitea provider.

The existing owner-only `startOwnerControlledPlanningReview` accepts
the observer via `config.planner.onObservation` and returns a
`PlanningReviewPacket` with status `awaiting_engineer_signature`.
It already ties the Planner to the native authorized Gateway port,
active preliminary authority and signed backend Planning checkpoint.
Store the review packet and the observation list in a protected,
owner-only artifact directory (0700 directory, 0600 files) only after
the original host validates the Planning state. On failures, keep a
limited failure trace but NEVER invent a valid proposal.

## Offline evaluation (zero model/API calls)

With a genuine review packet (`packet.json`) and collected metadata
(`observations.json`), independently verify the expected Gitea SHA,
then run:

```sh
node poc/scripts/planner-feasibility-eval.mjs \
  department-directory <PINNED_40_HEX_GITEA_SHA> \
  packet.json observations.json > report.json
```

Use `account-suspension` for the first scenario ONLY if its genuine
pinned baseline is appropriate. The evaluator also accepts a raw
`UnapprovedPlanProposal` directly from `propose()` for separate
non-authoritative experiments.

The evaluator intentionally never calls a model or provider. Its
`technical_preflight_pass` checks evidence shape, trace consistency,
source scope, repository identity and safe workflow intent; reference
file anchors are *informational*, because another valid design can
change a different set of files. It does not certify security, correct
code, signed approval, Gemini billing or successful Execution.

A human must inspect model decisions, task dependencies, Agent Cards,
file relevance, unnecessary permissions, hallucinations and source
understanding against the *independent* requirements and repository.
Record actual provider model ID, call/token counts, latency and billed
cost outside the model output; redact secrets.

## Execution policy

- **No Gemini API call until the operator separately approves paid
  inference** and the private host, API credential, budgets and source
  revision have been verified.
- Do not use an automatic billable `push` workflow.
- Do not alter `main` or merge a PR for this experiment.
- Never treat simulated Gitea-shaped fixtures as real Gateway/Rust/OPA
  authorization evidence.
- No operational DC, delegated agent Execution or code write during R5A.
- If R5A is satisfactory, validate the same approved pipeline offline
  end to end, then request separate approval for the full Gemini E2E.


## R5A.0 — Isolated model-capability probe (no R5 host needed)

This is a **preliminary** capability experiment, intentionally separate from
the trusted R5A private-host/Gitea test above. The new
`poc/scripts/run-gemini-planner-fixture.mjs` runs the EXISTING
`TrustedAdkReadOnlyPlanner` against a frozen in-memory IAM Console
baseline. The read port returns **Gitea-shaped mock responses**, not
authenticated Gitea, Gateway VP, Core Rust, OPA or an authorized session.

Two initially absent enhancements are defined independently:

- `department-directory`: admin-only department filtering in API/UI and tests.
- `suspension-feedback`: add accessible live-region semantics to
  ALREADY visible suspend/reactivate success and error messages. The missing
  behavior is assistive-technology announcement, not a new message.

Source inspection confirmed the initial baseline already displays success
and error messages but does not provide status/alert notification semantics.
The earlier "display feedback" experiment was therefore not novel and was
corrected BEFORE any Gemini API request.

The model sees the requirement and ordinary permitted source tools, NOT
the offline golden edits, reference file anchors or expected task DAG.
The fixture's 40-hex revision is a synthetic source fingerprint and MUST
NOT be reported as an actual Git commit/Gitea SHA.

**Safe default:** one no-network/no-model dry run per case:

```sh
node poc/scripts/run-gemini-planner-fixture.mjs --dry-run department-directory
node poc/scripts/run-gemini-planner-fixture.mjs --dry-run suspension-feedback
node --test poc/scripts/test/run-gemini-planner-fixture.test.mjs
```

The CLI rejects all other command forms. GitHub CI runs only tests and
never supplies the execute switch, consent phrase or Gemini API key.

**Billable experiment is NOT authorized by this document or a green CI.**
If and ONLY if the operator later chooses to pay, the exact separate
manual command on a private machine is:

```sh
export DELEGATION_PLANNER_BILLING_CONSENT='I AUTHORIZE GEMINI API CHARGES'
export DELEGATION_PLANNER_OUTPUT_DIR='/absolute/private/path/new-unique-dir'
export GEMINI_API_KEY='<provided privately, never committed>'
node --experimental-strip-types poc/scripts/run-gemini-planner-fixture.mjs \
  --execute department-directory
```

Choose a **new, nonexistent** absolute evidence directory each time; the
program creates it 0700 with exclusive 0600 evidence files. It creates
`proposal.json`, `observations.json`, `evaluation.json` on success
and a local `fixture-run.json` with the synthetic-boundary warning.
One invocation may incur charges even when the model rejects the
requirement or a model deadline is exceeded; limits are 8 model turns,
8192 output tokens per call, 60s per model call, 300s total local
Planning budget. These are bounds, NOT a provider-enforced spending cap
or proof that a remote model stops billing after cancellation.

The result is **only** a candidate plan for manual scientific assessment.
No Engineer signature, Delegation Credential, tool write, GitHub PR or
authorized E2E can be produced by this probe. Do not use its synthetic
proposal as a signed human-review checkpoint in the real R5 pipeline.
A successful isolated capability probe is followed by authenticated,
native Gateway/Rust/OPA-backed Planning against a real pinned Gitea SHA.


## GitHub Actions manual run — preferred operator workflow

The workflow `.github/workflows/gemini-planner-manual-feasibility.yml`
is published in **both** the protected research branch and default `main`.
Only the **workflow registration file**, not the R5 refactoring/code, was
added to `main` so GitHub can show **Run workflow**. The paid job refuses
to run unless the selected ref is
`refactor/post-prof-plan-contracts-20261021`. This is a manual workflow:
it has NO push/schedule/PR triggers and no automatic Gemini inference.

1. Go to GitHub **Actions → Gemini Planner — Manual Feasibility Experiment**.
2. Click **Run workflow** and select
   `refactor/post-prof-plan-contracts-20261021` from the **branch** dropdown.
3. Choose `department-directory` and `dry-run` for a no-cost check,
   or explicitly select `gemini-paid` for one read-only model planning attempt.
4. For `gemini-paid`, type the exact consent phrase
   `I AUTHORIZE GEMINI API CHARGES`. The workflow uses the existing
   repository **Actions Secret** `Delegation_Thesis_Gemini`, as does the
   historical paid three-agent workflow. Never input the API key into a
   dispatch field, code, artifact or log.
5. Examine the job summary and download the `planner-isolated-evidence-*`
   artifact. On successful planning it contains `proposal.json`,
   `observations.json`, `evaluation.json` and `fixture-run.json`.
   On a refused proposal it contains `failed-observations.json` and
   `fixture-run.json` (where available). Do not re-run a paid job:
   request a new separately authorized attempt if needed.

The workflow performs offline validations and a no-model dry run BEFORE
injecting the Gemini key into the single billable step. The baseline is
**synthetic**; the outcome is not Gitea/Rust/OPA authorization, functional
correctness or executed development. An apparently green job means only
that the experiment completed, not that the proposal is technically good;
consult `evaluation.json`. A red job may already have consumed tokens.
The provider is responsible for the actual invoice; the telemetry is not
an invoice or a spend ceiling. The workflow never edits the source repository.
