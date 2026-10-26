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
