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

## R5A — Larger bounded Planning budget and model fallback (26 October 2026)

Following the failed 8-turn experiment (#40350899503), the Planner
successfully made eight Gemini calls and eight scoped file reads but did not
produce a proposal before its 8-model-turn ceiling. This is evidence of
a **premature orchestration ceiling**, not evidence that Flash is too weak.

Keep **`gemini-3.8-flash`** for the next separately authorized experiment,
with explicit **MEDIUM thinking** and these fail-safe ceilings:

| Boundary | Previous isolated run | New isolated run |
| --- | ---: | ---: |
| Model delegate turns | 8 | 96 |
| Read-port invocations | 16 | 64 |
| Aggregate source bytes | 96,000 | 524,288 |
| Per-file bytes | 24,000 | 24,000 (unchanged) |
| Planning session duration | 300,000 ms | 900,000 ms |
| Per-model-call duration | 60,000 ms | 120,000 ms |
| Max output including thought tokens | 8,192 | 16,384 |
| Thinking level | provider default | MEDIUM (explicit) |

The 96-turn ceiling is a **last-resort** guard, not a requirement to use
all 96 calls. The normal stopping condition is a **complete validated
unapproved JSON proposal**. Once the model has sufficient evidence it
should stop reading. Do not set an unbounded inference allowance: beyond
provider costs, unbounded tool loops can prevent a useful conclusion.
The trusted read allowlist, revision checks, non-main write protection,
human approval requirement and absence of actual write tools are UNCHANGED.

The protected read-permission snapshot remains limited to 128 entries.
The old failure-trace grader limit of 128 observations and usage turn filter
of 12 were raised to 512 and 96 so the evaluator cannot reject a valid
longer trace. The GitHub manual job timeout now allows the full 15-minute
Planner session plus installation and test overhead. None of these caps
guarantee a monetary ceiling; check the real provider billing limits.

**Fallback only if improved Flash still fails:** compare
`gemini-3.1-pro-preview` (Pro reasoning) against the same independently
frozen baseline and rubric. There is no released `gemini-3.8-pro` API
identifier in the current model catalog. Pro is a paid Preview and requires
a fresh explicit billing authorization, model access verification and
compatible thinking options. Do not switch the default or incur any
additional API charges automatically. If Flash returns a valid proposal,
do not switch just because a stronger model exists.

The isolated fixture experiment is not a real Rust/OPA/Gitea authorized
Planning test. A green offline preflight does not establish the behavior
of paid Gemini inference or an approved execution DAG.


## R5B — Independent human review lifetime after Planning

The paid synthetic Planner succeeded (#40357039122). Its success is ONLY a
read-only, in-memory model feasibility result; it does not authorize a real
Gitea/Rust/OPA execution. A subsequent 5/5 offline integration CI passed at
`027a5d3b` (#40358606880).

The trusted live owner bootstrap now verifies the requested preliminary
credential duration BEFORE any provisional DC is issued or a Gitea Planning
session is registered. Maximum bounded lifetime: **45 minutes**, shared
between the Rust/Adapter owner authority and the Gateway's revision registry.
A 15-minute maximum Planner session no longer automatically consumes the
whole credential lifetime. The backend-signed, pinned Planning checkpoint
has a separate **20-minute** human-review validity period, plus a required
two-minute minimum handoff margin. The bootstrap rejects short or stale
provisional roots before changing state.

* These maxima are *not* automatic extensions or revocation confirmations.
  Production issuer validity and status verification, trusted clock skew,
  persistent service availability, and confirmed retirement remain required.
* All Planning authority remains **read_repository, list_directory and
  read_file**, pinned to Gitea main's exact SHA. No writing, code execution,
  permission escalation, automatic signing, merge or auto-approval.
* The Engineer can reject and close Planning. Without an authentic, matching,
  unexpired Ed25519-approved permission subset, no operational root may issue.
* The existing Architect-approved execution path still needs private runner,
  live Engineer Host, signed OIDC admission and verified Gitea/Runner evidence.
* An alternative future design can revoke the provisional read DC
  immediately after Planning and separate the human review into a no-root
  phase; this requires redesigning the existing trusted Coordinator state
  machine, not silently skipping the current revocation-before-issuance gate.

Tests now check rejection of undersized preliminary lifetime *before*
issuance, 45-minute Gateway TTL expiry, excessive TTL refusal, and the
existing negative security cases. No Gemini API calls are made by these tests.


## R5C — Single-use Gemini Planning assembly in the real Engineer Host

The 26 October isolated Gemini feasibility result remains **read-only and
synthetic**. It must never be copied into an Engineer approval directory or
used as authenticated Gitea evidence.

The protected Engineer service now exposes an **owner-only** assembly function
`prepareConfiguredOwnerEngineerBootstrap(...).assembleGeminiPlanning(...)`.
Assembly independently uses the existing strict, protected host config and
the same hardened Coordinator/Gateway IPC, pinned backend Ed25519 signer,
recovery journals, original session ID, base revision, Engineer DID and
approved branch as the zero-provider R5 assembly. The R5 test pathway
retains its independently bound non-provider ADK model and cannot select
a billable model.

The new real-model assembly requires exact owner-supplied
`authorizationInput: "I AUTHORIZE GEMINI API CHARGES"`, privately supplied
`geminiApiKey`, and `modelName: "gemini-3.8-flash"`. Its limits are fixed:
MEDIUM thinking, 96 model turns as an emergency stop, 64 scoped read
invocations, 16,384 output tokens per call, 120-second individual call
timeout, and 15-minute entire Planning timeout. **Constructing** the
Google ADK model and original Coordinator makes no model-provider request.
Only a separate explicit, potentially billable `start(planning)` action
can invoke Planning inference. The API secret is never placed in the
Planning result, GitHub workflow inputs, signed checkpoint or A2A payload.

This is **not** the approved end-to-end experiment: the owner must still
provision the original 45-minute preliminary DC, genuine independently
pinned Gitea base revision, operational and Planning retirement journals,
authenticated Gateway IPC, protected backend signer, and live Engineer
service. Gemini cannot sign an Engineer receipt. User-triggered
`workflow_dispatch` consent alone does not authenticate the Engineer or
grant execution authority. A private runner, fresh OIDC/mTLS admission,
signed Engineer decision, confirmed preliminary revocation, new scoped
operational authority, approved A2A DAG and real Gitea/Docker evidence
remain required before claiming complete end-to-end success.

All CI for this assembly **must remain offline**; its tests deliberately
instantiate a Google ADK Gemini model with a synthetic nonworking key
without calling `generateContentAsync` or any provider. A subsequent
paid inference experiment requires a separate explicit user authorization.


## R5D — Protected standalone Gemini owner launcher (not executed)

The protected launcher is
`poc/apps/orchestrator/src/run-trusted-gemini-owner.mjs`.
It can be launched **only by the operator on the separately owned
trusted host**, never from GitHub-hosted Actions, the public OIDC
callback, A2A, an MCP tool or a model response.

The explicit owner JSON (mode 0600 in a private directory) uses
`profile: "gemini_planning"`, the Gitea-pinned inventory and base SHA,
a distinct 45-minute preliminary credential identifier and status-list
entry, a requirement, plan ID, exactly three trusted agent identities,
local Gateway address, the fixed `gemini-3.8-flash` model identifier,
and *paths only* to separately protected Backend Ed25519 and Gemini
API key files. Both secret files must be private mode 0600, not
symlinks and not shared with the input file. No API key or private key
is copied into JSON.

At invocation the operator must separately provide:
`DELEGATION_ENGINEER_SERVICE_CONFIG`,
`DELEGATION_GEMINI_EXPECTED_SOURCE_SHA`,
`DELEGATION_GEMINI_OWNER_INPUT_FILE`, and
`DELEGATION_GEMINI_CHARGE_CONFIRMATION` with the exact text
`I AUTHORIZE GEMINI API CHARGES`.
The protected source SHA must match BOTH the operator's clean local
Git HEAD and the exact GitHub Actions/OIDC source SHA pinned in the
protected Engineer Host configuration. It is **not** the same as the
separate Gitea target repository revision.

The launcher first prepares a consented Gemini Planning model, the
original Coordinator and durable Gateway/Engineer IPC without inference.
Only its subsequent explicit owner `start` call is potentially
billable: it issues the original read-only preliminary delegation,
performs bounded ADK tool reads through Gateway/Adapter/Rust/OPA/Gitea,
persists the backend-signed checkpoint and starts the authenticated
Engineer review UI. Rejected Planning and shutdown require confirmed
native root retirement. It NEVER automatically approves the plan,
requests GitHub OIDC, starts operational delegated agents, merges a PR
or claims an end-to-end run.

This implementation has **not** been launched with a real Gemini key
or a live privately configured Engineer Host. CI exercises only
offline negative cases and non-billable model construction. The next
authorized infrastructure experiment must explicitly verify the live
Gateway IPC, real Rust credential issuance/revocation, independently
signed Engineer review, authorized DAG and three-role Gitea/Docker
effects before claiming complete feasibility.


## R5E — Owner-only continuation from human approval to paid signed Execution

The protected Gemini owner launcher now offers an **explicit, separate**
`runApprovedGeminiDag(input)` method after it has produced a persisted
backend-signed Planning checkpoint and started the Engineer review host.

* The original same-process Coordinator, planning checkpoint store, review
  gate, protected Gemini API key, original Gateway base URL and Adapter
  bearer are **not owner-overridable**. They are taken from the private
  original Planning assembly.
* The owner can supply only a one-use candidate GitHub run ID, candidate
  operational credential, three distinct localhost A2A ports, three
  separately scoped local role tokens, a private Task transport and
  bounded Status List allocation data. Unknown fields, shared role tokens,
  mismatched Gateway URLs, model-selected identities and non-loopback
  destination URLs are rejected before starting the handoff.
* Before consuming GitHub admission, the launcher reloads the exact
  backend-signed checkpoint and verifies the genuine independently signed
  Engineer decision against the original plan digest and permission set.
  If the Engineer has not approved the plan, paid DAG execution is denied.
* The existing `runReviewedApprovedDagWithGateway` then enforces fresh
  one-use GitHub OIDC/HMAC and REST corroboration, exact protected model
  budgets, operational root issuance only after confirmed read-root
  retirement, signed task mapping, native delegated child credentials,
  Gateway/Rust/OPA tool enforcement, real three-role ADK/A2A transport,
  Gitea/Docker evidence and confirmed terminal root retirement.
* Neither starting the owner host nor loading this bridge signs a plan,
  consumes the OIDC receipt, issues an operational credential or invokes
  any paid Agent model. Paid inference can occur only when separately
  authorized and the actual trusted runtime executes.
* The gateway origin, source SHA, Engineer DID, plan digest and Coordinator
  cannot be accepted from remote JSON, A2A, MCP, GitHub workflow inputs,
  or model-generated arguments.

**Verification boundary:** CI for R5E uses zero-provider, pure binding
and denied-start tests. It does **not** prove a successful paid model
end-to-end run, a privately deployed Engineer Host, external EVM
revocation, or authenticated live GitHub/A2A/Gitea effects in one trial.
An independent operator must establish those in a separately approved
integration experiment. No additional Gemini charges are authorized
by the existence of this module.


## R5F — Single-flight Engineer signature and interruption-safe Gemini Execution

A genuine Planner proposal may be available before the Engineer signs it.
The private owner continuation now separates an **in-progress human-signature
preflight** from a **one-use operational dispatch**, instead of consuming the
run attempt merely because the Engineer has not signed yet.

The same-process `createProtectedGeminiOwnerDispatch` is constructed only
from the original frozen protected Planning assembly, the original
Coordinator, the authenticated Engineer Host, a private host-held Gemini key,
and the genuine signature verifier. The callable continuation is never
attached to HTTP, OIDC intake, A2A, MCP, CI inputs or LLM tools.

* An invalid owner Execution request is refused **before** checking an
  Engineer receipt or consuming one-use GitHub admission.
* A missing/unsigned human receipt denies dispatch but does not burn the
  original approval attempt. A later real Engineer signature can be checked
  again, provided the original read-only Planning authority is still active.
* Once a verified signature allows the host's GitHub-OIDC/root handoff to
  start, the dispatch is one-shot, even if an exception or cancellation
  occurs. No automatic retries or new operational roots are issued.
* Concurrent calls, cancellation during signed-review validation and
  late successful A2A results after owner shutdown all fail closed.
* Shutdown fences new authorization synchronously, invokes the Host's
  credential retirement path **before** awaiting any in-flight dispatch,
  and waits for that dispatch to settle. Failure to confirm root closure is
  propagated; a late result may never become a falsely verified completion.
* The private offline tests verify retry semantics, concurrency, late
  responses, unknown authority fields and failed retirement. They do not
  call Gemini or grant operational authority. Real signed UI, crypto root
  and GitHub A2A integration remain independently exercised in the
  existing tests; a full privately operated paid execution is still pending.
