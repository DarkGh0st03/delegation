# Current integration checkpoint — 15 October 2026

## Scope and architecture

Reference scripted architecture commit (historical): `c7af6ca0a6b0254e3b9966e7631325ab1e540be5`. **Latest fully tested live Gemini framework commit:** `02c3395b9111a63ccc9f441ea2c91c81865d6673` on `main` — [manual paid run #5, 15 October 2026](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415), SUCCESS. The 13 October reference `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` remains historical.

The contribution is the integration of delegated authorization with interoperable agent execution. The cryptographic delegation foundation is reused; the experiment is a bounded software-engineering workflow, not a general autonomous developer.

The canonical coordinator is deterministic TypeScript: Backend → Frontend → Test. Each specialized role uses native Google ADK and receives a protected A2A task. Their four MCP tool types share one Streamable HTTP service; role/task-specific runtime state retains the Gateway client and authority. Rust verifies delegated authority, then OPA evaluates execution policy before provider access. Permission attenuation is exact resource/operation subset matching, not directory inheritance.

The Test role runs the exact-SHA Docker pipeline and researcher-owned acceptance. The coordinator then opens a PR. A separate trusted CI actor reruns the Docker pipeline and publishes status for that exact SHA. The final readiness check denies merge without a genuine human review. The canonical live test never creates a review or merges; its Gitea instance is disposable.

## Earlier free regression evidence (13 October reference)

| Workflow | Run | Result and scope |
| --- | --- | --- |
| PoC Baseline Validation | [38365626238](https://github.com/DarkGh0st03/delegation/actions/runs/38365626238) | 22/22 jobs passed; original PoC regression |
| Phase 11 Security Experiments | [38365626239](https://github.com/DarkGh0st03/delegation/actions/runs/38365626239) | Passed; functional security regression |
| Shared MCP Production Coordinator | [38365626323](https://github.com/DarkGh0st03/delegation/actions/runs/38365626323) | Passed; scripted model, stubbed Runner |
| Shared MCP Real Docker Acceptance | [38365626204](https://github.com/DarkGh0st03/delegation/actions/runs/38365626204) | Passed; scripted model, actual Docker and independent acceptance |
| Phase 12 Reproducibility | [38365626286](https://github.com/DarkGh0st03/delegation/actions/runs/38365626286) | Failed because the old measured manifest was applied to changed dependencies; addressed by a separate current contract |

The real-Docker scripted run completed the 11-file scope (Backend 4, Frontend 3, Test 3 updates + 1 creation), six project phases and researcher acceptance. Trusted CI published pending then success under a separate identity; no approval was created and the merge was denied with `human_approval_missing`. Gitea main remained unchanged.

## Earlier live Gemini result — PASS (13 October 2026)

[Manual paid run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) on `main` at `9012c8c4e7a9244cb931bcdef411cc5f443f0c08` completed successfully. Backend, Frontend and Test were real Gemini roles under Google ADK/A2A, using one shared MCP service and Gateway/Rust/OPA. All 11 files, interface preflight, six Docker acceptance phases, researcher acceptance and independent trusted Security CI passed. The separate CI identity posted exact feature SHA `pending → success`.

The coordinator opened PR #1 only in temporary Gitea at feature SHA `3306f08aa57ebfe9635842e61b3a3c2a768e1ee7`. No reviewer was impersonated, and no merge took place. Readiness correctly denied `human_approval_missing`. This result establishes the bounded live-generative E2E path, not production security certification or a measured performance campaign.

[Detailed, artifact-hashed evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md) includes the original ZIP checksum and expiry (27 October 2026). The earlier [failed live run 38363401514](https://github.com/DarkGh0st03/delegation/actions/runs/38363401514) remains part of experiment history, and cannot override the later successful run.

## Latest live Gemini result — PASS (15 October 2026)

[Manual paid run #5, ID 38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) completed **SUCCESS** on its first attempt against exact framework SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673` (`main`). This is the authoritative **latest tested framework revision**, following PR #12's removal of redundant Docker Compose Gitea startup. The paid workflow uses only the separately managed disposable Gitea; OPA and Anvil still start via Compose. The fact that newer documentation commits may exist does **not** retest their SHAs.

Real `gemini-3.8-flash` with thinking `LOW`, three ADK roles and 29 completed inferences generated the bounded 11-file Account Suspension change (Backend 4, Frontend 3, Test 4). The interface preflight, six actual Docker project phases, researcher-owned acceptance and second independently run trusted Security CI all passed. The exact-SHA trusted status moved `pending → success`. A feature PR was created only in ephemeral Gitea; no approval was forged, no merge occurred and readiness denied `human_approval_missing`; temporary `main` was unchanged.

The original run artifact `gemini-shared-mcp-evidence-38761963415` has ID `11985464719` and GitHub-reported ZIP digest `sha256:5d188f51a7590f9b55883ba6641abfbefd91dc72a0e664a9571c7eca0b1516a7`; expiry is **29 October 2026 at 15:44:27 UTC**. These are verified GitHub API and job-log fields; the ZIP contents were not independently downloaded or security-reviewed in this checkpoint update. See [15 October run evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-15.md). Keep the [13 October experiment](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md) and its [code review](GENERATED_CODE_SECURITY_REVIEW_2026-10-13.md) as history rather than applying that review to the new generated code.

## Reproducibility separation

- Historical measurements: `cbadb5440db408d4047d4eb870a9fb231362414a`, original `poc/experiments/reproducibility-manifest.json`, unchanged.
- Current dependency/runtime checks: `poc/experiments/adk-mcp-reproducibility-manifest.json`, separate schema and no historical measurement claims.
- New runtime reports identify the actual checked-out framework SHA. Successful contract validation does not prove generative correctness or measure authorization latency.

See [REPRODUCIBILITY.md](REPRODUCIBILITY.md).

## GitHub administration still required

GitHub API inspection at this checkpoint reported `main.protected=false` and an empty repository ruleset list. The available GitHub connector cannot modify administrative branch-protection settings. This is separate from the protected Gitea main exercised by the experiment.

Proposed development-repository rule for `main`:

- Require pull requests, passing checks and an up-to-date branch.
- Require the unconditional check contexts `validate` (PoC Baseline Validation) and `phase12b-reproducibility-contract` (Phase 12 Reproducibility Contract), selecting their GitHub Actions identities after they have completed. Do not make a path-filtered workflow an unconditional required check.
- Block force pushes and branch deletion, including administrator bypass where supported.
- Decide the independent reviewer requirement according to available collaborators; requiring one other person's approval blocks a sole maintainer from merging their own PR. GitHub development review is distinct from the mandatory human Gitea review in the thesis workflow.

This is a configuration proposal, **not a claim that protection has been enabled**. The persistent human-approved Gitea merge workflow also needs its documented environment/reviewer/identity setup; merely committing YAML does not configure those controls.

## Remaining sequence

1. Preserve the latest 15 October artifact before its advertised 29 October 2026 expiry and, separately, the historical 13 October artifact before 27 October; retain each ZIP checksum and its framework/feature SHA mapping.
2. Perform a structured quality/security review of the **15 October** generated 11 files before any optional *separately reviewed* persistent import; the 13 October code review does not cover this new output.
3. Update thesis results with explicit evidence separation: historical measured baseline, scripted shared-MCP validations, and genuine live-Gemini result.
4. Review GitHub branch protection and any persistent Gitea reviewer/environment/CI setup as separate administrative deployment work. A passing disposable run does not configure these.
5. Any further paid model experiment requires a new explicit decision by the thesis owner. Routine free CI remains automatic.


## Later approved-plan refactor checkpoint — 22 October 2026

This section records a **separate, newer experimental branch**, not a
retroactive claim about the paid 15 October baseline above.

- Branch: `refactor/post-prof-plan-contracts-20261021`. Validated code
  checkpoint: `733ddbb7e30b5e2eb4169c1cae9461f00afbf425`.
  The repository `main` was not merged or changed by this work.
- [Cumulative Offline Refactoring Validation #39738559704,
  attempt 2](https://github.com/DarkGh0st03/delegation/actions/runs/39738559704):
  **four of four jobs succeeded**, including Rust/Solidity, Gateway/ADK/A2A,
  EVM-native credentials and the positive disposable Gitea/Docker Runner.
- The positive Test Task now crosses a **real A2A SDK** Task exchange, an
  Engineer Ed25519-signed immutable plan, Gateway task binding, **real
  OPA/Rego** (`phase6-approved-branch-v2`), the real Gitea branch/head,
  the authenticated Runner HTTP service, six real Docker project phases,
  independent researcher acceptance and Gateway-correlated task-completion
  evidence. Security CI publishes `pending -> success` on the exact
  tested feature SHA. No feature PR was created or merged.
- A **first attempt** of the same job failed closed after a Docker phase
  reached its five-minute timeout; OPA had already returned `allow`.
  Retrying **only** that offline job on unchanged code passed in about
  56 seconds of provider execution. Do not reinterpret the first
  timeout as a policy failure or conceal it in thesis evidence.
- Crucial boundary: this single positive provider test still injects a
  **fixture child DC and verifier**. The EVM job independently proves
  *real* scoped child issuance by Rust, native Rust VP verification,
  real OPA and on-chain revocation with an A2A Task, but that separate
  run uses a **mock provider**. The whole graph has therefore **not yet
  been demonstrated in a single fully native VP + real Gitea/Runner**
  execution. The application implementation remains the pinned,
  scripted Account Suspension reference, not newly generated ADK code.
- No paid Gemini execution was launched. A future paid inference
  experiment still needs explicit owner authorization. No protected
  source `main` merge, forged human review or claim of a production
  authentication deployment occurred.

The next scoped milestone is to replace the fixture child/VP verifier
in the positive provider run with the **Rust-issued child and native
Verifier** while keeping the immutable signed Task, OPA branch policy
and the exact-SHA Runner acceptance unchanged. Only then evaluate
full ADK-generated multi-agent integration offline before asking
permission for any paid Gemini E2E.

## Unified native authorization + actual provider checkpoint — 22 October 2026

**Code commit:** `cc7c4333e3fb8896b8fea600190df13fdd10880b`.
**Evidence:** [Cumulative Offline Refactoring Validation #39740530903,
attempt 2](https://github.com/DarkGh0st03/delegation/actions/runs/39740530903).
**Result:** all four jobs `success`, including
`evm-real-credential` with the new
`Single signed native VP plus real A2A OPA Gitea and Docker acceptance`
step. No Gemini/OpenAI API request was made.

This *single native EVM CI job* now contains a **positive, signed,
pinned Test Task** with:

1. An ephemeral Engineer Ed25519 signature covering the immutable
   one-Task execution plan and the **actual observed Gitea main SHA**.
2. Rust Adapter-issued read-only preliminary Planning root; on-chain
   revocation **before** issuance of a new, independent operational root.
3. Task/role binding in Gateway, followed by a genuine **Rust Adapter-issued
   child DC** whose exact approved scope is `run_tests` on the feature
   branch. The root grants nothing beyond the signed approval.
4. A real A2A SDK Task and a private delegated evidence context. The
   Test Agent requests a real challenge-bound VP signed by Rust Adapter.
5. Independent native Core Rust VP validation, **real Rego OPA**
   `phase6-approved-branch-v2`, then authorized real Gitea
   `run_tests` dispatched over the authenticated Runner HTTP client.
6. Seven actual Docker checks: six project phases and separate researcher
   acceptance, all passing on the **same Gitea feature SHA**.
7. Gateway task completion corroborated against the real provider effect,
   operational root revocation, and Security CI publication
   `pending -> success` on the exact verified commit.
   The disposable Gitea main remains unchanged; no PR is created or
   merged.

Concrete provider evidence from the successful native step:
feature SHA `1139d9da9f21bb430293ff24cbad801d082c95b9`,
`policy_decision=allow`, `verification_ms=1607.84`,
`opa_ms=4.64`, `provider_ms=55978.10`,
`runner_status=pass`,
`runner_project_tests_status=pass`, and
`runner_researcher_acceptance_status=pass`.
The programmatic CI evidence explicitly records
`native_rust_signed_child_and_vp=true`,
`real_opa_signed_plan_policy=true`,
`real_a2a_sdk_task_completed=true`,
`exact_provider_sha_correlated=true` and zero merge calls.
These are observed values from **one integration run**, not average
performance measurements.

**Failure and reproducibility:** attempt 1 of the native job reached
a 300-second Docker Runner phase timeout. Its signed VP was already
accepted and OPA allowed the request; Gateway refused to attest
Task completion. Retrying the SAME job on the SAME framework commit
passed with no source modifications. This suggests environmental/
dependency-install variability; the exact timed-out Docker phase was
not conclusively identified from the CI's scrubbed diagnostics.
Do not conceal this unsuccessful first attempt, claim deterministic
reliability, or equate intermittent success with benchmark results.

**Limits:** this is a scripted, deterministic **Test Agent** running a
trusted, pinned reference Account Suspension implementation. It is
**not** a Gemini-generated three-agent DAG, a live LLM planner, a
production federated Engineer login, a real on-screen human sign-off,
a real organizational Gitea installation, or a source-`main` merge.
The Engineer Ed25519 approval uses a disposable CI test key and test
identity. Provider authorization, immutable SHA and independent
cryptographic checks are genuine inside the disposable environment,
but the complete multi-agent generative workflow still needs separate
real-world/paid verification with explicit owner permission.

## Full three-role signed ADK/A2A DAG orchestration — 22 October 2026

The opt-in trusted dispatcher now exports
`executeApprovedDag({invokeOrchestratorTask})`. It processes the immutable
Engineer-approved graph in dependency order, maps each specialized Task to
a private prebound Gateway Task ID, requires trusted provider completion
before unlocking dependent nodes, and closes the Gateway session plus
operational root after the whole DAG succeeds. A failure is terminal:
no automatic retry or further Task dispatch, and session closure/
credential-revocation failure must be surfaced for reconciliation.

The dedicated offline test
`poc/packages/orchestrator-runtime/test/trusted-approved-three-adk-a2a-offline.test.ts`
covers an actual **three-role Google ADK Runtime**, three separate A2A
HTTP+JSON Agent Card servers, real SDK sendMessage/getTask polling and
an **authenticated Ed25519 signed Engineer approval file**. A scripted
non-network model issues one tool request for Backend, then Frontend, then
Test. The plan's branch creation is handled separately by the trusted
Orchestrator. The test verifies the sequence
`branch -> backend -> frontend -> tests`, checks that every A2A request
is prebound, asserts that each model invocation is free from delegation
credentials, and denies a Backend attempt to edit the Frontend path.
Failure blocks all successor Tasks and closes the trusted session.

**IMPORTANT evidence boundary:** this new all-three-agent test uses
scripted `BaseLlm` models and deterministic **Adapter/VP/Gateway/OPA/
Git/Runner fixtures**. It establishes real ADK and A2A transport and
trusted DAG execution, NOT a positive full-cryptography, full-provider
three-agent E2E. The existing **single-Test-Agent** native EVM positive
run separately verified real Rust child DC issuance, Core Rust VP
verification, OPA, Gitea and Docker in one run
([#39740530903 attempt 2](https://github.com/DarkGh0st03/delegation/actions/runs/39740530903)).
Combining these two dimensions into one multi-agent native-provider
workflow remains an independent milestone.

Evidence: [Trusted Prebound A2A Dispatch (Offline)
#39744803272](https://github.com/DarkGh0st03/delegation/actions/runs/39744803272)
succeeded with the signed three-role ADK/A2A tests and existing runtime
regressions. The new DAG logic was not merged into `main`; no paid
Gemini calls, PR merge or production user identity assertion occurred.


### Additional signed DAG security preflight (22 October 2026)

The `executeApprovedDag` driver now **preflights the complete Task
permission coverage before performing even the first approved
create_branch**. A partially approved graph cannot create branches
or files before it discovers a later unapproved Task. This does not
turn an unapproved permission into a granted capability.

The dispatcher also derives `A2A subtask.relevant_paths` exclusively
from the **Engineer-approved permission rows**, not from the entire
candidate Task resources list. An unapproved proposed file path is
neither forwarded as a path hint nor authorized by the child DC.
The dedicated negative regressions cover both cases and all-three-
agent ADK execution:
[Trusted Prebound A2A Dispatch #39745367445]
(https://github.com/DarkGh0st03/delegation/actions/runs/39745367445)
**success**.

These are additional orchestration/context minimization guarantees.
They are independent of the underlying Rust Core VP check, OPA
and trusted provider attestation, which must remain active in the
eventual native multi-agent integration.


## 22 October — native three-role Rust/ADK/A2A execution (provider-emulated)

**Code commit:** `185d8dac926f7289a8950085c2662780d18902f1`.
**Evidence:** [Cumulative Offline Refactoring Validation #39746642733]
(https://github.com/DarkGh0st03/delegation/actions/runs/39746642733),
`evm-real-credential`, step `Three ADK and A2A roles with native Rust
DC VP and live OPA (provider fixture)`.

The native EVM CI runs a NEW dedicated scripted multi-agent scenario,
`poc/apps/gateway/native-test/native-approved-three-adk-evm-e2e.mjs`.
It starts from an Engineer Ed25519-signed and authenticated immutable
three-role plan, issues and revokes a real read-only Planning DC,
issues a separate real operational root, and delegates **distinct,
Task-scoped child DCs** to Backend, Frontend and Test via the real
Rust Adapter and EVM trust stack. Three real Google ADK Runners (using
deterministic offline models) send protected A2A HTTP+JSON Tasks via
the SDK. Each Gateway action is checked by **native Core Rust** on a
real challenge-bound signed VP, **real OPA/Rego**, the immutable
plan's branch, Task, role and dependencies, and then a simulated
Gitea/Runner effect. The Gateway requires its own effect record
before the next Task starts and the operational root is revoked
upon trusted session close.

A second scenario asks Backend to update a Frontend-only file.
The request is denied and the trusted DAG is terminated before
Frontend or Test can run. The suite explicitly asserts no provider
effect was created. Neither user approval nor ADK model messages
are treated as standalone permission grants.

**IMPORTANT limits:** The provider in this NEW native three-role
test is an **in-process deterministic effect simulator**, not real
Gitea or Docker. The separate existing native single-Test scenario
uses actual Gitea/Runner/Docker; it must NOT be described as the
same test. No generated backend/frontend application functionality
has yet been validated across ALL three roles against disposable
Gitea and real Docker in one unified run. The Engineer Ed25519
signature is a test key; model output comes from scripted BaseLlm,
not Gemini. A live user-approval UI/paid generative workflow remains
outside the scope. No merge to source main occurred.


## 22 October 2026 — first positive native three-agent + Gitea + Docker E2E

**Code commit:** `478a987540a4c8b86e9640df5d4d94c5c41082c0`.
**Validation:** [Cumulative Offline Refactoring Validation #39748475606]
(https://github.com/DarkGh0st03/delegation/actions/runs/39748475606).
**Result:** 4/4 CI jobs **SUCCESS on attempt 1**.
The native `evm-real-credential` job now also runs the new opt-in
`APPROVED_RUNNER_THREE_AGENT_DAG=1` provider scenario.

The scenario extends the existing single-Test-only signed approval with
a genuinely signed immutable three-specialist plan:
`backend (update_file) -> frontend (update_file) -> verify (run_tests)`.
The operational Engineer root grants exactly those three scopes on the
disposable `feature/account-suspension` branch, and independent native
Rust-issued child DCs bind Backend, Frontend and Test identities to
their distinct approved Tasks. Each credential's signed VP is validated
by **native Core Rust**, with **real OPA/Rego** policy checks before the
actual provider call. The Backend and Frontend use **real Google ADK
Runners and real A2A HTTP/SDK**. Their file edits are committed through
Gateway and the real Gitea API: 2 confirmed updates, in DAG order, each
with separately verified real Git HEAD and file content. The Test Task
is only prepared after both edits have been provider-corroborated.

The exact final Gitea revision (disposable):
`bd4404d79989b5a0a82053fe1f242e511f05d54c`.
The existing A2A Test role then uses its Rust-signed scoped child and
native VP to execute the actual authenticated Runner HTTP service,
on exactly that final revision. CI evidence:
`real_backend_frontend_gitea_edits=2`,
`native_rust_signed_child_and_vp=true`,
`real_opa_signed_plan_policy=true`,
`real_a2a_sdk_task_completed=true`,
`exact_provider_sha_correlated=true`,
`exact_project_phases=6`,
`project_tests=pass`,
`researcher_acceptance=pass`, status
`pending -> success`, `merge_calls=0`,
`persistent_gitea_modified=false`.

**Limits that must not be overstated:** The agents are scripted
`BaseLlm` instances; no Gemini / paid model inference occurred.
The Task plan, reference implementation and two benign appended
TypeScript comments were constructed by trusted test code, not generated
by an autonomous language model. The feature branch was initially
populated from the existing Account Suspension reference fixture;
the three roles have now *acted through the real provider* but have
not produced the whole application from a natural-language requirement.
The Engineer signature uses an ephemeral test signing key rather than
real production interactive consent or an externally verified login.
The trusted control plane and provider are composed within the CI
process; full multi-process fault recovery and restart reconciliation
remain out of scope. The public GitHub `main` is unchanged. This
single successful run is not a latency/reliability benchmark.

Next: review boundary hardening, agent-generated code quality,
task-to-task repository context under real ADK inference (with user
authorization before paid Gemini), rollback/restart semantics, and
explicit Engineering sign-off over the exact final plan.


## Signed A2A Task file-tool minimization — 22 October 2026

A prebound Engineer-approved A2A Task now supplies
`subtask.relevant_paths` to the ADK tool factory. It intersects
those file paths with the specialist's static role profile and
advertises only matching `read_file`, `update_file`, and
`create_file` paths in model-facing tool schemas and instructions.
A Test Task with no relevant file resources exposes only `run_tests`.

A model-selected path outside this narrow set is rejected **before**
Gateway Prepare, even if the ADK SDK does not enforce its schema.
Traversal, absolute, malformed and control-character paths are rejected;
untrusted repository files and tool outputs are explicitly described
to the model as data rather than instructions.

This is a usability and defense-in-depth measure, not delegation
authority: the trusted dispatcher derives path hints from approved
permission rows, and independent signed-plan Gateway, Rust DC/VP, OPA
and provider-effect checks remain the actual security boundaries.

**Shared MCP integration:** The same signed Task path ceiling is now
stored in the private, bearer-bound MCP task registry. Each actual MCP
read/write/create call checks it BEFORE the Gateway client is invoked.
The model-facing shared MCP catalog still has static argument schemas;
only its tool names are minimized at construction. Consequently path
authorization must never rely on the model schema: private MCP Task
registry, signed-plan Gateway, DC/VP and OPA remain the enforcement.
A Test Task with no file paths exposes only the bounded `run_tests`
tool. Non-legacy dynamic branches remain unsupported by the shared
MCP catalog and are refused rather than silently broadened. Real
code generation also needs explicit `read_file` grants in the
Engineer's plan before agents can inspect source files. No paid
Gemini calls are included.

The dedicated offline suite
[Trusted Prebound A2A Dispatch #39750696187]
(https://github.com/DarkGh0st03/delegation/actions/runs/39750696187)
passed with the narrowed signed ADK behavior. The cumulative suites
run independently.

## 22 October — exact signed read_file versus update_file in one live A2A DAG

**Validated code:** `cc1d162ce5d69787762b319f67df6a95d0364169`.
**Validation:** [Cumulative Offline Refactoring Validation #39754904362]
(https://github.com/DarkGh0st03/delegation/actions/runs/39754904362).
**Result: 4/4 jobs SUCCESS, first attempt**. A subsequent focused
A2A transport regression is also green:
[Trusted Prebound A2A Dispatch #39755193640]
(https://github.com/DarkGh0st03/delegation/actions/runs/39755193640).

The immutable Engineer-approved plan now carries **operation-specific
Task file hints** through the private prebound A2A dispatch:
`approved_file_permissions: [{operation,path}]`. These are derived from
the **approved permission rows**, never from a model request. A model
can see a `read_file` tool for its explicitly approved context but
not a `update_file` tool for that same context without a distinct
approved write permission. The ADK path enum, prompts and local tool
guard, as well as the private task-bearer MCP registry, enforce this
presentation limit and pre-Gateway denial. Signed authorization remains
independently enforced through Gateway, Rust DC/VP and OPA; the A2A
metadata is not itself authenticated delegation authority.

The **real Gitea + native EVM positive CI** was extended to two
separate scripted specialist ADK/A2A tasks with **four authorized
real provider file reads** (each agent reads its existing write
target and one separate read-only context file) and **two real provider
file commits** on its approved feature branch:
- Backend reads `apps/backend/src/users/user.service.ts` and
  `packages/shared/src/account-status.ts`, but may write only its
  approved user service.
- Frontend reads `apps/frontend/src/pages/UserDetailPage.tsx` and
  `apps/frontend/src/api/users-api.ts`, but may write only the
  approved UserDetailPage.
- Test Agent runs native-Rust-verified signed `run_tests` on the
  **resulting observed Git SHA**
  `ea0ae979a1146a1e95463ef73731ba38e759a16f`, after both
  writes are provider-confirmed.

CI verifies the exact data fields:
`native_approved_source_reads=4`,
`real_backend_frontend_gitea_edits=2`,
`native_rust_signed_child_and_vp=true`,
`real_opa_signed_plan_policy=true`,
`real_a2a_sdk_task_completed=true`,
`exact_provider_sha_correlated=true`,
six project phases pass, researcher acceptance passes, and
Security CI status progresses `pending -> success`. No PR or merge.

**Crucial limitation:** All agent models remain *deterministic
`BaseLlm` scripts*, not Gemini; these scripts issue the reads, then
append preselected harmless comments to existing reference
implementations. They do **not** actually synthesize new source code
from the retrieved files. File-read transport, scoped permissions
and provider effects are real within disposable CI; autonomous
generation and quality evaluation require a separate experiment
with explicit permission before any paid Gemini call. This is not
an LLM reliability benchmark and it does not implement a production
Engineer authentication or persistent fault-recovery path.


## 22 October 2026 — pinned functional Backend and Frontend code changes

**Validated code:** `aef4993b76651bfff437524481543e306b60de80`.
**Validated CI:** [Cumulative Offline Refactoring Validation #39756850796]
(https://github.com/DarkGh0st03/delegation/actions/runs/39756850796):
**4 of 4 jobs succeeded on the same commit**, including real EVM/Rust
credential checking, three-role ADK/A2A, actual Gitea file mutations,
six real Docker application phases, independent researcher acceptance
and Security CI `pending -> success` on the final Git SHA
`8d92339f9be858a34d9f25c5b76b57ae333f42ff`.

The previously appended inert comment edits are now replaced in
this opt-in **offline reference test** by two **substantive but
deterministic** transformations:
- Backend `apps/backend/src/users/user.service.ts`: its `listUsers`
  result is ordered by display name with `localeCompare`.
- Frontend `apps/frontend/src/pages/UserDetailPage.tsx`: success
  feedback uses `role="status"` and `aria-live="polite"`, while
  error feedback uses `role="alert"`.

`approved-functional-reference.mjs` is NOT an LLM. It applies only
these narrow changes to a byte-exact pinned source. Unexpected,
tampered or unpinned repository text is rejected. The signed
three-Agent workflow performs four real Gateway-protected,
native-Rust-VP-verified Gitea reads before the two changes: each
Agent reads its exact write target and one separately approved,
read-only contract/API context file. No read permission is inferred
from write permission or vice versa. The test verifies the exact
new file contents through an independent real Gitea reread and checks
that Docker builds, backend/frontend tests, browser E2E and researcher
acceptance pass on the final two-write SHA. Three dedicated offline
source-transform tests also cover exact edits and rejection of
malicious/unexpected source drift.

**Further fail-closed preflight:** the later commit
`e968d762c9ba6497566b8d61e80e3f1ff7daeb45`
additionally refuses to call Gateway Prepare for a source update
unless both the current target and approved context have first been
read and matched. This is a defense-in-depth offline fixture guard,
NOT a new authority mechanism. Its CI is
[#39757771822](https://github.com/DarkGh0st03/delegation/actions/runs/39757771822);
check the run status before asserting that extra change is fully
validated.

**Crucial scientific limitation:** These effects were created by
fixed `BaseLlm` scripts over a prebuilt reference repository. No
paid Gemini inference or autonomous requirements-to-code generation
has been tested in this positive example. It must not be presented
as evidence of the generative capability, production human
authentication, persistence/recovery, or benchmark reliability.
All crypto/plan/OPA/provider checks remain independent of the
scripted model. GitHub `main` was not merged or modified.
