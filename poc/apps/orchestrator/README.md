# Orchestrator bootstrap utility

This application provides an **optional trusted Software Engineer → Orchestrator root-credential bootstrap command**. It is not the canonical three-agent Coordinator itself.

`src/bootstrap-engineer.ts` calls the Rust Delegation Adapter as the trusted Engineer identity, requests a root Delegation Credential with `ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY`, and prints a sanitized issuance summary.

```bash
npm --prefix poc run orchestrator:bootstrap
```

Required environment: `DELEGATION_ADAPTER_URL`, `ADAPTER_CALLER_ENGINEER`; optional root-credential ID/validity/status configuration appears in the source.

## Current execution path

The **actual** Account Suspension sequential workflow is implemented in `poc/packages/orchestrator-runtime/src/sequential-coordinator.ts`, started by `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`. It sends A2A tasks to Backend → Frontend → Test and uses the Gateway directly for branch and PR operations. It never performs automatic merge.

A green offline scripted test is not a paid live Gemini inference.

## Stage 9 — Trusted two-root Engineer authority (opt-in)

The reusable trusted backend contract lives in
`poc/packages/orchestrator-runtime/src/trusted-engineer-authority.ts`.
**It is not installed as a Gemini FunctionTool or exposed over A2A/MCP.**
This package's existing `bootstrap-engineer.ts` command still creates
the old IAM Console template root and is unchanged.

The new `TrustedEngineerAuthoritySession` has two explicit operations:

1. `startPlanning(root)` issues a new Rust Engineer→Orchestrator root
   credential valid for at most **900 seconds**. All privileges are
   derived by trusted code from a **pre-validated repository snapshot**
   (repository identity, pinned base SHA, directory list and file list).
   They consist only of `read_repository`, `list_directory` and
   `read_file` permissions with exact `main` resource URIs. There is
   **no write, test, branch-create or PR permission** in this root.
2. `approveAndIssueOperationalRoot(root)` first retrieves the
   **persisted authenticated** plan/approval from a `TrustedApprovalStore`
   supplied by a future Engineer backend. It verifies Engineer identity,
   repository/base revision, immutable plan version/digest, task/agent
   permission assignments, the authoritative Rust Operation catalog,
   supported Gateway tools, canonical URIs and denial of main writes.
   It then requires an acknowledged **irreversible revocation** of the
   provisional root via the Engineer-authenticated Adapter endpoint
   `/v1/credentials/status`. Only afterwards does it issue a **new
   independent** Engineer→Orchestrator root containing precisely the
   approved permissions (maximum 128). The second credential must
   have a new ID and a different revocation status entry.

On any revocation uncertainty the session fails closed. The old
provisional DC may still exist until its short TTL expires in a
failed network situation, so **no operational DC is issued** until a
trusted operator reconciles the incident. Roots are still verified
by the Rust Core and Gateway policy; a credential alone **does not**
authorize an action absent approved-plan compliance.

### Important limits of this stage

The `TrustedApprovalStore` is **an interface**; it does not yet
authenticate actual GUI logins, persist immutable approval records, or
prove real human consent. CI supplies an explicitly simulated
trusted-store fixture. Nobody may treat a user-controlled plan JSON,
a SHA digest or the current mock UI as authenticated approval.

The repository manifest is **trusted input** to the module; later
bootstrap logic must obtain it from a verified Gitea snapshot and
check the real HEAD against `base_revision`. Gateway discovery tools
currently resolve each read at a branch commit, but this stage does
not yet enforce a single *common* Git SHA across the whole Planning
session. That end-to-end revision binding must be completed before
live autonomous Planning.

The operational root permission union is derived from the approved
plan; runtime enforcement of the immutable plan and assigned Task at
**each Gateway provider effect** remains a separate mandatory
upcoming integration. No second plan engine or new trusted signing
keys have been introduced.

Offline tests:
```sh
node --test poc/packages/plan-contracts/test/*.test.mjs
npm --prefix poc run orchestrator-runtime:test
```

These tests use **no Gemini calls, no paid APIs and no real GUI approval**.



## Stage 12 — Signed Engineer approval and trusted handoff (opt-in)

A new domain-separated, expiring Ed25519 Engineer receipt lives in
`poc/packages/plan-contracts/src/signed-approval.mjs`. It signs the pinned
plan SHA-256 digest, **all approved permission IDs**, the full approval
decision, Engineer DID, signing-key ID and receipt timestamps. Its
verifier rejects altered/expired records and unknown pinned keys.

`SignedEngineerApprovalFileStore` loads the receipt from a protected
directory and checks it with a trusted Engineer DID/public-key
allowlist. It has no public write endpoint or model-visible method.
Both the Engineer credential issuer and the Gateway-approved-plan
registry consume this SAME authenticated record interface.

Manual operator procedure (not an LLM/tool action):

```sh
ENGINEER_DID=did:your:engineer node --experimental-strip-types \
  poc/apps/orchestrator/src/sign-engineer-approval.mjs \
  /secure/input/plan.json /secure/input/approval.json \
  /secure/approvals /secure/keys/engineer-ed25519.pem engineer-pinned-key-v1
```

The signer requires an interactive terminal, a mode-0600 private key,
shows Engineer identity, exact repository/base SHA/plan digest,
version and approved permission IDs, and requires the operator to
type `APPROVE <plan_digest>`. The signed receipt is created once, with
mode 0600, in the requested protected directory; neither the private
key nor the signed VP is exposed to ADK, Gemini or MCP.

**Cryptographic signing proves possession of the pinned key, NOT a
production identity-provider login or real authenticated GUI click.**
This is an explicit local signing ceremony, with genuine Ed25519
signature verification, not a claim of completed GUI consent.
A production Engineer identity/session and safe key management must
still be integrated.

`TrustedExecutionCoordinator` connects the existing read-only
Engineer-root session to the opt-in Gateway approved-plan guard:

1. Start the Gitea-SHA-pinned provisional read-only root.
2. Retrieve the authenticated signed Engineer approval; confirm
   revocation of the provisional root before independent operational
   root issuance.
3. Activate the SAME digest/SHA in the trusted Gateway plan registry,
   or revoke the newly issued operational credential on failure.
4. Bind actual A2A task IDs to plan tasks/agents; leave actual
   provider authorization to Rust VC/VP + OPA + per-effect plan checks.
   Completion requires trusted provider evidence and a separate
   task-completion attestor.
5. Close the operational session and revoke the operational root.

The tests use **disposable locally generated keys**, a real signed
on-disk receipt, simulated Rust/OPA/provider outcomes and a simulated
task-completion attestor. No Gemini call or paid API is used.

**Not yet deployed:** authenticated human GUI consent, a real
cross-process authenticated Gateway/coordinator integration, durable
multi-replica session/task state, real A2A completion evidence and
full argument-bound branch/PR approvals. The historical Gemini
workflow remains on its legacy, tested configuration.

Offline test:
`node --experimental-strip-types --test poc/packages/orchestrator-runtime/test/signed-approval-coordinator.test.ts`


## Authenticated Engineer local console (opt-in, offline)

A separate **local-only** approval GUI is served by
\`src/engineer-approval-server.mjs\`. It replaces neither the existing
\`poc/workflow-ui/index.html\` mock nor the legacy Gemini workflow.

It accepts the Software Engineer's password against a pre-provisioned
**scrypt verifier** (not a raw password), uses a short-lived HttpOnly,
SameSite=Strict cookie, an independent CSRF token, explicit local Origin/Host
checks and a six-attempt/minute login bound. The HTTP listener binds **only
127.0.0.1**. This is suitable for a trusted local demonstration, **not**
internet exposure or an enterprise OIDC/SSO provider. Do not reverse-proxy
it publicly or treat a machine with another untrusted local account as safe.

Before startup, the operator provisions the following trusted resources
**outside the repository**: an owner-only plan file \`0600\` inside an owner-only
directory \`0700\`, an Engineer Ed25519 PKCS8 private PEM with the same
protections, a pinned public PEM, and an empty owner-only \`0700\` receipt
directory. The plan must be independently validated and tied to the
session, repository, Agent Card registry and **actual Gitea SHA** by the
trusted importer. Nothing submitted by the browser is used as the plan.

Provide these environment variables:

\`\`\`text
ENGINEER_DID                     expected authenticated Engineer DID
ENGINEER_SIGNING_KEY_ID          pinned Ed25519 key identifier
ENGINEER_TRUSTED_PLAN_FILE       independently sourced trusted plan JSON
ENGINEER_SESSION_ID              trusted session identifier
ENGINEER_BASE_SHA                pinned 40-character commit SHA
ENGINEER_REPOSITORY_JSON         exact trusted repository object JSON
ENGINEER_SIGNING_KEY_FILE        protected PKCS8 private PEM path
ENGINEER_PUBLIC_KEY_FILE         independently pinned SPKI public PEM path
ENGINEER_APPROVAL_DIRECTORY      owner-only output directory
ENGINEER_PASSWORD_SALT_HEX       >=16 random bytes, hex
ENGINEER_PASSWORD_SCRYPT_HEX     scrypt(password, salt, 64 bytes), hex
ENGINEER_APPROVAL_PORT           optional, defaults to 8787
\`\`\`

Generate the scrypt verifier outside version control, from a password chosen
by the Engineer, using the standard Node \`crypto.scryptSync(password,
Buffer.from(saltHex,"hex"),64).toString("hex")\`. Never commit password,
verifier, private key, signed receipt, token or a live approval to GitHub.

Run:

\`\`\`sh
node --experimental-strip-types poc/apps/orchestrator/src/engineer-approval-server.mjs
\`\`\`

Visit \`http://127.0.0.1:8787/\` locally. Once authenticated, review the
**server-trusted** tasks, repository SHA and proposed permissions, select a
nonempty subset and type \`APPROVE <64-character-plan-digest>\` exactly.
Only then the backend constructs \`makeApproval\`, signs an Ed25519
receipt, checks its pinned key and atomically creates the protected
\`<session_id>.json\` with \`wx\` and \`0600\`. No operational root DC
is emitted by this console. A later authenticated trusted coordinator
can load the result via \`SignedEngineerApprovalFileStore\` and perform
confirmed preliminary revocation, independent root issuance and Gateway
activation.

**Still needed:** durable multi-process authenticated handoff, actual
repository Engineer ACL/authority resolution, secrets management such as
KMS/HSM, stronger web identity federation, A2A artifact/completion attestor
and deployment hardening. The single-process session store does not
survive restarts. This GUI is separate from any model-exposed tool.

Offline CI: \`.github/workflows/engineer-approval-ui-offline.yml\`.


## Trusted A2A completion bridge

The general planning/execution refactor now includes
`TrustedExecutionCoordinator.confirmObservedA2AResult(result)` and
`confirmObservedOrchestratorTask(runtimeTaskId)`. They send normalized
metadata from the trusted `DelegatedA2ARoleRunner` result to the
Gateway's private IPC command. They do not accept an ADK FunctionTool,
LLM decision or public API request as an authenticated completion.

The Gateway requires the exact approved runtime Task binding, correct
DAG dependencies, and separately recorded provider writes/test results.
For code agents, the artifact's paths and SHA must correspond to
Gateway-observed Gitea writes. For tests, the Runner must independently
report a matching passing SHA and mandatory pass statuses. The
`trusted-a2a-observer.test.ts` tests this adaptation.

The existing deterministic Account Suspension orchestrator is not
silently switched to this opt-in approved-plan path. A separately
approved DAG dispatcher is available and tested; adopting it as the
normal execution path and adding durable A2A re-polling remain future work.

## Trusted approved A2A dispatcher — opt-in stage

`TrustedApprovedA2ADispatcher.load(...)` obtains a previously signed and
authenticated plan from `AuthenticatedPlanStore`, checks Engineer DID,
session, pinned Git SHA, operation catalog, granted permissions and exact
activated plan digest. It does not derive authority from ADK tool calls or
browser/LLM-supplied task descriptions. Its source of tasks, dependencies,
agent roles and scope is the immutable approved plan.

**Critical ordering:** a trusted Orchestrator generates a cryptographically
random private Gateway `dispatch_<22-base64url>` ID, installs its
Task/role binding over the existing HMAC Unix IPC *before* calling a protected
Gateway operation or dispatching A2A, then supplies the ID privately in the
A2A Message metadata. The server-assigned SDK A2A Task ID is separate:
it is learned only after submission and must never be used as a retrospective
approval. The Agent's private Gateway client uses the prebound ID while ADK
still receives its normal reduced Task context without that ID or DC/VP.

The dispatcher checks DAG dependencies before child DC issuance, sends only
the approved Task description and file paths, and confirms completion only
after `DelegatedA2ARoleRunner` accepts a completed A2A Task and validated
artifact. The Gateway still rejects completion unless it has independently
recorded matching authorized Gitea/Runner effects for that binding. On an
uncertain dispatch/result failure, the Coordinator closes the active Gateway
session and attempts to revoke the operational DC; the Task is not retried
silently.

Orchestrator-only tasks use `runOrchestratorTask(planTaskId, trustedCallback)`
which binds *before* invoking the private Gateway client. Specialized tasks
use `dispatch(planTaskId)`; child credentials and unique revocation status
entries come from the trusted `authorityForTask` allocator, not the model.

**Approved branch support:** the signed plan must reference exactly one
canonical `feature/...` branch, encoded consistently in its repository
resources and approved permissions. The dispatcher derives that branch from
the signed plan and rejects mismatched repository/branch scopes. When using
direct ADK FunctionTools, the per-task tool schemas and reduced prompt are
restricted to this branch; the server accepts a nonlegacy branch only with
a private prebound Gateway dispatch ID. A2A artifacts are checked against
the branch from the trusted dispatch.

**Important limits:** shared MCP argument schemas remain explicitly
frozen to `feature/account-suspension`; the dynamic-branch ADK path
fails closed if shared MCP is enabled. The authorized *file catalog* remains
the existing Account Suspension role profiles; this change does not grant
arbitrary repository navigation or dynamic tool catalogs. The dispatcher
is opt-in, not yet the normal paid-Gemini workflow. Parallel execution,
arbitrary approved agent/file catalogs, runtime restart recovery,
cryptographically authenticated remote A2A Task results and a fully dynamic
planner remain future work. Rust DC/VP/OPA and the Gateway provider
enforcement remain independent from DAG plan validation.

**Offline integration:** `poc/apps/gateway/test/trusted-plan-ipc.test.ts`
contains a separately started Gateway process, real HMAC Unix IPC,
Engineer Ed25519 approval, and a real A2A SDK Task/server using a
scripted role handler on `feature/approved`. It confirms provider effects
against the immutable Task DAG. The test's root issuance, Rust/VP
verification, policy decision and Gitea executor are **simulated**.
The standalone Gateway no-dependency suite explicitly skips only this
A2A SDK integration subtest when the SDK is absent. The dedicated trusted
IPC workflow installs pinned dependencies and runs it without skipping.
This does not replace an E2E with disposable Gitea and Docker Runner.

## Trusted Task-scoped child credentials — opt-in

Use TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority(...) when
running an approved DAG with actual credentials. This factory first checks
the authenticated Engineer-signed plan, frozen digest and repository SHA.
It then builds a TrustedApprovedPlanChildAuthorityIssuer from the
**operational root actually issued and confirmed by
TrustedExecutionCoordinator**, not from caller-provided permission arrays.

For each authorized specialized Task, the issuer takes ONLY the rows selected
by approved_permission_ids for that Task and role. It checks that every
operation/resource pair belongs to the confirmed operational root, freezes
the list, and sends exactly these permissions to the Rust Adapter
POST /v1/credentials/child. The Rust core independently enforces
parent-child attenuation. The issuer checks the returned credential ID and
the exact ordered permissions and refuses a missing Task, different role,
wrong parent, invalid status, excessive validity or a second issuance
attempt after uncertain network results.

The dispatcher still binds the approved role/Task to Gateway before
allocating delegated child authority or sending any A2A message.
The DelegatedA2ARoleRunner forwards an internal approved_task_id to
the issuer; this is NEVER taken from an ADK/MCP tool argument. The Agent
receives its resulting DC privately in A2A Delegation Evidence. The
legacy DeterministicOrchestratorAuthorityIssuer with static IAM Console
role templates remains unchanged for backward compatibility.

The dedicated offline tests check exact Backend and Test grants, denied
permission amplification, mismatched signed/root state, malformed Adapter
responses, duplicate attempts and ordering through the real Role Runner.
These tests mock the Adapter HTTP response; they do **not** claim to
re-execute the whole new DAG with native Rust, real Gitea, Docker Runner
and Gemini. Existing Rust Adapter subset tests independently validate
cryptographic parent-child attenuation. The next full-system milestone is
the integrated disposable-provider, offline E2E.


## Verified offline EVM scoped-child integration — 22 October 2026

The cumulative offline CI EVM job executes
`poc/apps/gateway/native-test/native-approved-scoped-child-evm-e2e.mjs`
**after** its existing native verifier/revocation regression. This is a
separate, disposable, single-session integration test with no paid AI calls.

It constructs a short-lived Engineer Ed25519 signed approval (pinned
public key and protected receipt file), starts a second opt-in Gateway
using the owner-only HMAC Unix control socket and native Core Rust
verifier, and exercises the actual trusted two-phase transition:

1. Real Rust Adapter issues a read-only preliminary Engineer root.
2. The trusted authority checks the receipt and revokes the preliminary
   root on Anvil before issuing a NEW operational root, independently.
3. The Gateway accepts only the signed plan and binds a Backend Task
   BEFORE its child credential is issued or its A2A Task is submitted.
4. Rust Adapter issues a Backend child DC with **only** the Engineer
   approved file update; the proposed-but-excluded create-file grant
   never appears in the parent/child authorized scope.
5. The real A2A SDK runs a scripted Backend Task whose VP is signed
   by the Rust Adapter, verified by the Gateway's *native Rust Core*
   and separately evaluated by OPA.
6. The extra unapproved operation is denied. Because the provider is
   deliberately non-mutating, Gateway refuses to attest Task completion.
   The trusted dispatcher closes the session and the operational root
   is revoked rather than treating a model/agent success claim as proof.

The proof prints `signed-plan-scoped-child-native-evm-pass` and is
tracked by the cumulative EVM CI job. It uses disposable Ed25519 keys,
test DIDs, a **fixture** base SHA (not a live Gitea pin), the legacy
`feature/account-suspension` branch (the existing OPA policy is still
branch-specific), and the Gateway's mock provider. This establishes
real DC issuance, on-chain revocation, VP verification and task/plan
enforcement, **not** an end-to-end real Gitea mutation or real Docker
Runner execution inside this same session.

The remaining integration step is a single offline run against a
trusted actual Gitea SHA, a disposable real Gitea provider and the
Docker Runner with matching test evidence. Dynamic OPA branch support
must first be engineered without relaxing its existing main-branch
restrictions.

## Unified native EVM-to-Docker Test Task (22 October)

The approved-plan and Task-scoped child paths have been combined in
a **single successful offline CI integration** for the scripted Test
role: [#39740530903, rerun attempt 2](https://github.com/DarkGh0st03/delegation/actions/runs/39740530903).

`poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs`
accepts an explicit `APPROVED_RUNNER_NATIVE_EVM=1` trust profile, which
uses `SoftwareEngineerAuthorityBootstrap`,
`TrustedEngineerAuthoritySession`,
`TrustedExecutionCoordinator`,
`TrustedApprovedPlanChildAuthorityIssuer` and
`loadDirectCoreRustVerifier`. It refuses missing native credentials
rather than falling back to fixture authorization. After the native
challenge-bound VP passes Core Rust and real OPA, the live Gitea/Runner
provider effect must corroborate the A2A observation and exact tested
SHA before the Task can complete. The trusted operational root is
revoked when the session closes.

Do **not** generalize this experiment to three generative Agents or
human-review production readiness: the Test Agent uses a scripted
handler against a known reference project; the Engineer signing key is
ephemeral. The first run timed out in Docker, while an unchanged-code
rerun passed, so reliability remains an explicit experimental limit.

## Full approved DAG runner, three ADK roles — offline

The `TrustedApprovedA2ADispatcher.executeApprovedDag` method adds a
deterministic, dependency-aware execution driver to the previously
manual `dispatch` and `runOrchestratorTask` operations. Orchestrator
tasks must be invoked by a separately trusted callback; no model may
supply its own authority, Agent Card URLs, resources or task graph.
Success requires trusted Gateway/provider completion for *every* Task,
followed by Gateway closure and operational-root revocation. An
uncertain completion prevents downstream dispatch.

The new integration test uses **three real ADK Runners and three live
loopback A2A server instances** with scripted `BaseLlm` implementations.
They execute the signed sequence Backend -> Frontend -> Test against a
fixture-only controlled Gateway and Adapter exchange. The test checks
that tool calls outside the Backend's approved resource fail closed and
that no child credential or private Adapter token reaches the model
request. The Engineer approval is signed with disposable Ed25519 keys
and verified from an owner-only approval-file store.

CI: [Trusted Prebound A2A Dispatch (Offline)
#39744803272](https://github.com/DarkGh0st03/delegation/actions/runs/39744803272)
**success**.

This is NOT an actual Gemini call, production authentication, or a
native Rust/Gitea/Docker three-agent execution. The latter is the
next integration milestone, building upon the separately successful
real-native, single-Test-Agent provider acceptance.


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
