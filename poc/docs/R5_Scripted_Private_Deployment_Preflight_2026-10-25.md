# R5 — Private scripted_offline dispatch registration preflight

**Status: R5 NO-GO until same-SHA CI and one real distributed execution.**
This is an operator read-only preparation step, not authorization, Engineer
approval, an actual runner deployment, a test of mTLS, or a signed-DAG receipt.

## Why this check exists

GitHub registers a manually dispatched workflow only when the workflow file
exists on the repository default branch. On 25 October 2026, the reviewed
`.github/workflows/trusted-scripted-offline-session-hold.yml` exists on
`refactor/post-prof-plan-contracts-20261021` but not on `main`.
Do **not** merge or modify `main` merely to clear this readiness check.
An independently reviewed operator decision is required to register the
workflow on the default branch or to use a separately configured test
repository with new verified repository/owner identity pins.

## Non-billable operator preflight

After independently provisioning the isolated `delegation-private` Linux
self-hosted runner, immutable reviewed source under `/opt/delegation/r5`,
its 0600 configuration, private TLS keys, pinned Engineer Host certificate,
and protected `r5-private-scripted-admission` environment, run locally:

```bash
export DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG=/path/to/owner-protected/scripted-runner.json
node --experimental-strip-types poc/scripts/r5-scripted-dispatch-registration.mjs
```

The immutable `trusted-scripted-offline-session-hold.yml` also invokes
this check as its **first job step**, before the runner requests any
GitHub OIDC token or opens an admission session. The mandatory workflow
step reads only the independently provisioned runner configuration; no
repository checkout, mutable install or model invocation is allowed.

Run from the independently installed and operator-protected tree. The
script reads the existing fail-closed private-runner configuration loader,
then checks the **local** executable installation before querying GitHub:
the runner must be a non-root service account, the checkout, Git metadata,
tracked source files and source directories must be root-owned and not
group/other writable, the source tree must be a real Git checkout with
`HEAD` matching the independent 40-character owner SHA pin, the index
must have no symlinks/gitlinks, and tracked/untracked Git status must be
clean. This guard executes local `/usr/bin/git` and does not authorize a
session. It then queries only the public GitHub REST API to check that (a) repository/default branch are the
reviewed ones; (b) the pinned source SHA equals the current feature HEAD;
(c) the scripted workflow file is present on **both** main and that branch
with the **same Git blob SHA**; and (d) GitHub reports it as an active
registered workflow. It never dispatches anything, requests an OIDC token,
signs approval, loads a model, sends an API key, or changes a repository.

Exit 1 / `NO-GO` is expected while the default-branch registration is
absent, source SHA differs or GitHub is unreachable. Exit 0 means only
`registration_verified_only_not_r5_go`: do not equate it with a working
mTLS network, a live Coordinator, a human Ed25519 approval or a successful
real Gitea/Docker/Gateway/Rust/OPA DAG. Neither this probe nor its mocked
unit tests can establish that evidence.

## Required later evidence

Record the exact branch SHA and 5/5 cumulative offline CI on that same SHA.
Separately document the real private self-hosted runner, persistent Engineer
service running the **original** Planning Coordinator, real Engineer-signed
plan, GitHub OIDC/mTLS first-attempt admission, approved scripted A2A DAG,
actual Gitea/Docker/Runner acceptance, confirmed Gateway + Rust revocation,
and matching terminal `completed_verified` for the selected job.

Do not use the cold-recovery-only service CLI as evidence of active Planning.
Do not fabricate Engineer consent, downgrade to `push` or mutate `main`.
A paid Gemini workflow remains forbidden without separate explicit consent.

## Local trust limitations and installation prerequisites

The private operator must install code **outside** the runner's write
permissions, e.g. review and pin the commit before installing in
`/opt/delegation/r5` with owner `root`, mode 0755 or stricter for
directories, and mode 0644/0755 for tracked files. Use a separate
non-root `delegation-private` runner service identity. Do not grant
that identity sudo, Docker daemon control or source-write permissions.
If deployment dependencies are needed, install/pin them independently;
ignored files such as `node_modules` and OS trust cannot be attested
by `git status`. An operator must also check system package provenance,
supply chain, `/usr/bin/git`, Node runtime, Git config, runner isolation,
and the entire dependency tree. A clean root-owned local Git checkout
is a **defence in depth**, not a cryptographic proof of runtime purity,
and it does not eliminate TOCTOU against root-level compromise.

The new local guard is called BEFORE the workflow-registration REST check
and therefore before OIDC admission. An installation with the wrong SHA,
a modified tracked file, an untracked source file, a symbolic-link/gitlink
or unsafe ownership/perms is denied. No automatic remediation or mutation
occurs. Even after this preflight passes, the real private mTLS network,
original live Planning host, approved DAG, Gitea/Docker effects and root
revocation remain unproven until an independent operational E2E run.

The actual `hold-private-scripted-github-session.mjs` independently invokes
the same local check **again, in the process that will request OIDC**.
A direct manual invocation or skipped workflow step therefore cannot bypass
the local installed-source guard. It reads protected runner pins first,
checks local install, and only then submits the OIDC admission. The real
GitHub job, signed Engineer review and scope-constrained execution are still
separate authorization requirements.

## Independent Engineer Host configuration preflight (read-only)

The private operator must independently provision the Engineer service's
existing strict owner-only configuration file and its 0600 keys/0700 journals.
Before opening any listener or beginning the original Planning session, run
**on the Engineer machine**, as its protected service owner:

```bash
export DELEGATION_ENGINEER_SERVICE_CONFIG=/path/to/owner-protected/engineer-service.json
export DELEGATION_R5_EXPECTED_SOURCE_SHA=<40-character-reviewed-commit>
node --experimental-strip-types poc/scripts/r5-scripted-host-deployment-preflight.mjs
```

This command only loads the already-supported protected service config and
validates the scripted OIDC repository/branch/workflow/SHA, exact immutable
GitHub repository/owner identity and subject, separate paid/offline audiences
and client certificate pins, explicitly private IPv4 scripted binding, fixed
distinct ports, and the scripted HTTPS leaf/issuing-CA certificate validity,
CA signature, private IPv4 SAN and matching protected server private key.
It must **not** be connected to the public Internet. The paid listener stays
loopback-only during scripted R5. CA and server certificate must be valid and
the leaf directly issued by the pinned local CA for this conservative
one-hop PoC preflight. A different PKI chain requires separate review, not a
silent reduction in authentication checks.

**Stage isolation:** the host preflight uses the strict
`pendingPlanningOutput:true` loader. It is run BEFORE the preliminary
Planning root, when the reviewed-plan file MUST be absent. A stale file
fails closed. The separate cold-recovery loader requires that file to
exist, but does not reconstruct an active Coordinator; its signed
checkpoint and native root recovery are verified during startup.
Never run the pre-Planning check as proof that an approved plan exists.

The preflight never creates, resumes or approves a plan; never starts
`startConfiguredTrustedEngineerService`; never opens ports, invokes
Gateway/Rust, contacts GitHub, requests OIDC, dispatches a DAG or calls Gemini.
All failures are NO-GO with sanitized output; success is
`scripted_host_config_verified_only_not_deployed`, **not** live-host proof.
Operator still needs the original in-process
`prepareConfiguredOwnerEngineerBootstrap(...).start(planning)` plus a
reviewed owner-only execution driver, independently authenticated Engineer
Ed25519 approval, real runner admission and verified root retirement.
Simply launching the existing cold-recovery CLI does not establish that.

## Independently pinned scripted runner TLS preflight

The separate private runner now also verifies its own protected mTLS client
identity, in both the registration-preflight command and the final hold
process before any OIDC request. It validates the protected runner key
matches its certificate, the leaf is directly issued by the configured
client CA, the leaf and CA are valid on the test date, the leaf has explicit
clientAuth EKU, the host's pinned server fingerprint is syntactically valid
and does not reuse the client leaf, and the fixed private Engineer endpoint
and exact source/repository/workflow pins match the reviewed profile.

It is possible to test these local checks separately on the protected
private runner, without connecting to GitHub or the Engineer Host:

```bash
export DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG=/path/to/owner-protected/scripted-runner.json
export DELEGATION_R5_EXPECTED_SOURCE_SHA=<40-character-reviewed-commit>
node --experimental-strip-types poc/scripts/r5-scripted-runner-tls-preflight.mjs
```

This command returns only a sanitized readiness marker. It does not prove
the remote host's identity or certificate fingerprint, test actual mTLS
reachability, issue a GitHub OIDC token, complete a signed DAG or confer
execution authorization. The real mTLS handshake and independently
pinned Engineer host remain mandatory. Do not copy the runner's client
private key into an Engineer host process for cross-host verification.

## Real private-network mTLS negative challenge (no OIDC, no authority)

After the *original live* Engineer Host starts its separately pinned
`scripted_offline` mTLS intake on the chosen RFC1918 interface, the
isolated private runner can verify **actual reachability** over mTLS
without submitting a workflow token:

```bash
export DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG=/path/to/owner-protected/scripted-runner.json
export DELEGATION_R5_EXPECTED_SOURCE_SHA=<40-character-reviewed-commit>
node --experimental-strip-types poc/scripts/r5-scripted-mtls-network-probe.mjs
```

The operator command loads the existing 0600 runner configuration and
performs the local client certificate checks, then makes one genuine TLS
`GET` to the dedicated status endpoint using an intentionally invalid
`run_id=0`, alongside the reviewed source SHA. It verifies the server
certificate IP SAN, trusted CA, independently pinned exact leaf SHA-256,
mutual TLS client key, and the expected `404 {"status":"denied"}` response.
An invalid client certificate, TLS mismatch, REST error, unexpected
response or inaccessible host is NO-GO; it sends **no** GitHub OIDC,
Engineer Ed25519 signature, root parameters or model prompts.

The installed private GitHub workflow now performs the negative mTLS
challenge **after** the immutable-source/registration preflight and
**before** the GitHub OIDC submission. In the workflow, the independently
pinned source is checked against `GITHUB_SHA`. When run manually outside
GitHub Actions, use the explicit owner-reviewed SHA environment variable.

A positive negative-challenge proves a live pinned HTTPS/mTLS endpoint
returned the expected denial for that request. It does **not** prove
an authenticated GitHub job, an Engineer signature, a completed DAG or
credential revocation, and must never be reported as `completed_verified`.

## Same-configuration, original-Coordinator Planning bootstrap (R5)

The operator's protected Engineering process must now call
`prepareConfiguredR5ScriptedEngineerBootstrap(configPath,
{expectedSourceSha})` from `poc/apps/orchestrator/src/trusted-engineer-service.mjs`,
rather than calling the more general bootstrap without R5 pins.
The R5 API is read-only: it loads the **pending Planning** service config
once, checks the exact source SHA and the offline workflow identity,
private scripted mTLS configuration and certificate material on **that
same loaded config object**, and returns a single-use preparation object.

The operator constructs the real `TrustedExecutionCoordinator`,
`TrustedPlanningReviewGate`, a genuine Gitea-pinned snapshot, the
read-only ADK Planner with a **locally approved non-billable scripted
model**, a preliminary scoped root, Gateway/Adapter transports and the
original journal. It must attach
`planning.checkpointStore = prepared.planningCheckpointStore` and the
same Coordinator/journal identities; otherwise the immutable
`prepared.start(planning)` denies BEFORE Planning/root effects.
Only that explicit start invokes the original
`startOwnerControlledPlanningReview` and subsequently starts the
authenticated persistent Engineer Host with the **same Coordinator**
instance. It cannot automatically sign the Engineer's Ed25519 receipt,
authenticate a GitHub runner or execute the A2A DAG.

An external standalone preflight is NOT sufficient to authorize the
owner's later startup: the owner API rechecks the protected config during
the actual bootstrap and does not accept network/model-selected overrides.
Existing cold recovery remains a separate mode, not a reconstructed
Planning Coordinator.

These API assertions are covered by
`r5-scripted-host-deployment-preflight.test.mjs`, including a valid
protected pending configuration, wrong independent SHA, mismatched
paid/offline pins and refusal of an existing unsigned review plan.
The tests do NOT deploy or start the owner process. The operator still
must supply and manually authorize the genuine Engineered-approved DAG
and the real private runner/Gateway/Gitea environment. Running an ADK
paid provider is still forbidden for this no-charge R5 profile.

## Bounded ADK Planning without model-provider charges

R5 now requires a locally constructed **R5ScriptedNoProviderPlanningModel**
at the original owner-controlled Planning startup. This is a real Google
ADK BaseLlm class, but has no outbound model connection. It emits two
read_file FunctionTool requests against the original Gitea snapshot using
the ordinary pinned Gateway/Rust/OPA Planning read port, followed by a
deterministic, reviewable five-Task proposal:
branch → backend/frontend → test → Pull Request.

The owner supplies the signed Gitea inventory, reviewed feature branch,
two separate existing source paths, and one new regression test path in a
known directory. Unsupported source paths, overlapping writes and unsafe
test paths are refused. Plan compilation, DID identity, authorization,
the Engineer's independent Ed25519 signature and final execution are
still verified separately. This is an infrastructure workflow test, not
evidence that an LLM autonomously created a plan.

The R5 owner bootstrap now enforces this model's in-process identity and
snapshot/branch binding BEFORE any preliminary root issuance. A paid
Gemini BaseLlm, fake model-like object, or Planner bound to a different
Gitea snapshot fails closed. Start remains a one-use operation. The
non-R5 general owner bootstrap is unchanged, and cannot be used as
evidence that the scripted R5 run is free of model charges.

### No-provider model identity must remain immutable

The R5 bootstrap rejects a subclass of the scripted model, an instance
whose `connect` or `generateContentAsync` was shadowed/replaced, and
a model bound to another Gitea snapshot. An `instanceof` test alone
would not provide this guarantee: `super(intent)` also initializes the
parent's private WeakMap binding for a potentially fee-capable subclass.
The model guard requires the **exact original prototype and both original
method implementations** before any Planning root is issued. It cannot
attest a machine compromised with owner-level code execution; such a
machine remains outside the trust boundary.

## R5 — Actual private Gateway Planning registration (26 October 2026)

The persistent Engineer Host and the Gateway can run in separate
processes. Before this change, the authenticated HMAC Unix-socket API
could retire a Planning session but could not register it; constructing
the original Coordinator with a remote Gateway could not start the
pinned read-only Planning lease over this transport.

The `TrustedPlanIpcClient` now implements `begin(sessionId,ttlMs)`
as a signed private `begin_planning` command. **Only** the Gateway's
existing `TrustedPlanningRevisions` registry reads the actual Gitea
main commit SHA, and the response returns its pinned revision and
deadline. The Engineer cannot supply that SHA in a request. Remote
registration is denied if the Gateway does not advertise a durable
Planning retirement journal. The Unix socket remains strictly private,
with owner-only secret, nonce, timestamp and HMAC validation; no public
Gateway, ADK, A2A or MCP route exposes this command.

The corresponding private client `end(sessionId)` calls the durable
`retire_planning` command, rather than an in-memory close. The
`TrustedEngineerAuthoritySession` now **awaits** this result on
Planning cancellation, authorization transition and partial-startup
cleanup. In particular, an unresolved or rejected Gateway retirement
must never silently precede a new independent write root. Its failure
remains terminal and requires manual reconciliation, even if Adapter
revocation succeeds.

To use it, the operator must construct the original Coordinator's
`TrustedEngineerAuthoritySession` with the **actual authenticated**
`TrustedPlanIpcClient` as `planningRevisions`, and pass that same
client as `approvedGatewayPlans` to the Coordinator. The service
already checks its lease and retirement capabilities at startup.
The existing durable Planning/operational root journals and real
Adapter credential port remain mandatory. A new private IPC transport
does not authenticate an Engineer signature or bypass OPA.

The offline regression starts a real HMAC IPC listener around an
actual `TrustedPlanningRevisions` and durable retirement store;
additional tests assert that asynchronous Gateway retirement finishes
before native root revocation and that a rejected retirement cannot
report a clean shutdown. Physical runner/Engineer deployment and the
complete real signed DAG remain separate R5 acceptance evidence.

## R5 — Original Coordinator and trusted service assembly (26 October)

The protected `prepareConfiguredR5ScriptedEngineerBootstrap()` now
returns one owner-only `assemblePlanning(options)` method. It uses the
**same owner-verified service object** as `start(planning)`, not an
independently reloaded mutable JSON file. The assembly validates the
session, Gitea repository, exact base SHA, selected Backend/Frontend
paths, test destination, bounded zero-provider ADK model, original
checkpoint signer Ed25519 public/private correspondence and fixed
loopback Gateway URL **before** issuing any authority.

On that operator-only path, the code authenticates to the *real*
private Gateway Unix socket and requires the Gateway itself to attest
a functional operational lease, durable operational session,
Planning retirement and durable Planning tombstones. It constructs:
- the genuine `TrustedExecutionCoordinator`, with the **same**
  operational journal instance as the prepared Engineer Host;
- `TrustedEngineerAuthoritySession` with the actual remote Gateway
  Planning revision port and native Rust Adapter credential client;
- `TrustedPlanningRecoveryStore` and independent signed-approval
  verification keyed to the protected Engineer DID;
- `TrustedPlanningReviewGate`, backend-signed checkpoint store and
  deterministic, no-provider Google ADK Planner;
- the scoped read-only Gateway Planning transport, to be opened only
  by the existing original Planning bootstrap after the real preliminary
  root is issued.

The owner must call `const a = await prepared.assemblePlanning(options)`
then `await prepared.start(a.planning)`, in that order and exactly
once. **Only the specific assembled Planning object is accepted.**
Any handwritten lookalike Coordinator, swapped model or a second
startup attempt is rejected before root issuance. The operator supplies
the independently protected backend Ed25519 signing key in memory;
it must not be copied to GitHub Actions, ADK, A2A or MCP.

Assembly performs a read-only local IPC capability handshake. It
does NOT issue either root, run a plan, create human consent, sign
approval, request GitHub OIDC, invoke Gemini or establish an E2E.
The existing start invokes the original Planning and exposes the
loopback-only Engineer review UI; Execution must separately use the
signed Engineer receipt plus authenticated private runner admission.

A new offline integration fixture verifies that an actual HMAC Unix
socket and real durable Gateway Planning registry are connected to
the original idle Coordinator, and denies missing durable capabilities,
mismatched Gitea SHA/repository, mismatched backend signer and malformed
paths. This fixture uses no paid model and does not start a Planning root.

## R5 — Offline original Planning: source reads and signed checkpoint

A new regression uses the **real owner-controlled Planning bootstrap**
and original Coordinator with the new bounded, no-provider Google ADK
model. It exercises two distinct scoped `read_file` calls through the
existing Gateway prepare/execute implementation, pinned Gitea read
executor, VP verification and OPA interfaces, then validates the
immutable five-task plan, backend Ed25519-signed checkpoint, replay-safe
checkpoint store and owner-only Engineer review file. It checks that
no Engineer approval receipt exists and confirms provisional root
revocation on closure. A separate denial test requires native revocation
and absence of both signed checkpoint and review file after failed
Gateway proof binding.

**Evidence boundary:** these integration tests explicitly stub the
Rust Adapter, VP verifier, OPA and Gitea transport using deterministic
offline fixtures, as indicated in the suite source. They prove the
original Planning/checkpoint control flow, **not** a deployed
physical host, actual on-chain revocation, human Ed25519 approval
or an authenticated GitHub runner. Operator acceptance still needs
the full externally provisioned real transport, signed approval and
real A2A DAG in the same persistent host session.

## R5 — Owner service foreground launcher

The operator may now launch the *original* protected R5 Planning process
without constructing ad-hoc JavaScript callback glue:

```bash
export DELEGATION_ENGINEER_SERVICE_CONFIG=/private/engineer/engineer-service.json
export DELEGATION_R5_EXPECTED_SOURCE_SHA=<40-char independently reviewed branch HEAD>
export DELEGATION_R5_OWNER_INPUT_FILE=/private/engineer/scripted-planning.json
node --experimental-strip-types poc/apps/orchestrator/src/run-trusted-r5-scripted-owner.mjs
```

The separate owner input file must be 0600 inside a 0700 directory,
owned by the SAME service UID. Required JSON top-level fields are
`profile:"scripted_offline"`, `snapshot` (session ID, Gitea repository,
exact current base SHA, verified file/directory inventory),
`preliminaryRoot` (fresh owner-reserved revocable DC parameters),
`edits` (Backend/Frontend existing source files),
`newTestFile`, `requirement`, `planId`, `agents` (Backend,
Frontend, Test DID and private Agent Card reference), `gatewayBaseUrl`
(loopback), and `backendPrivateKeyFile` (independent signer key path).
The Backend private key is itself a separate 0600 file under a 0700
directory; it must NOT appear inline in this JSON or in an Action secret.

The foreground entrypoint loads the protected host and independently
pinned SHA, reads the owner input only locally, assembles the actual
durable-IPC Coordinator, and calls its original single-use Planning
startup. Planning reads still pass Gateway → Adapter VP → Rust → OPA
→ pinned Gitea, and it must materialize a valid Backend-signed review
packet before the Engineer review UI is exposed. Any failure aborts;
there is no automatic retry after uncertain credential issuance.
SIGTERM/SIGINT signal handlers await in-flight startup and root
retirement; an unconfirmed closure reports an explicit NO-GO.

Neither GitHub Actions nor any external A2A/MCP/HTTP client may invoke
this launcher. It never chooses a paid model, issues a fabricated human
signature, starts Execution, merges a PR, or claims R5 E2E success.
Its startup success message means only original live Planning is ready
for **independent human review**. Next the operator must acquire an
authentic Engineer Ed25519 approval and select an independently verified
private GitHub job; the explicit owner-only signed DAG handoff remains
a separate step. The backend checkpoint key and Engineer signing key
must be cryptographically distinct (even if supplied under different PEM
text or aliases); R5 rejects the same Ed25519 identity before a root is
issued. A credential or private key for a real operator/Engineer must
never be placed in this Git repository.

## R5 — Explicit owner-only admission-to-Execution bridge

The live R5 session object now exposes a **private in-process**
`runApprovedScriptedDag({...})` method. It does NOT accept or return the
raw Coordinator or Engineer Host. This method is available only to
trusted operator code that receives the original session object from
`startProtectedR5ScriptedOwnerSession()`; it is NOT a GitHub Action,
HTTP handler, ADK FunctionTool, A2A method or MCP route.

Once the Software Engineer has independently reviewed and signed the
immutable plan using the loopback Engineer UI, and once an actual
private GitHub workflow job has acquired its one-use mTLS+OIDC admission
receipt, the owner supplies these *data and already-approved-code*
fields: `runId`, fresh `operationalRoot`, three distinct bound
`ports`, the three trusted deterministic `handlers`, the protected
`sendProtectedTask` function, and durable
`childStatusProvisioning` metadata. All trusted Gateway/Adapter
URLs and the Adapter bearer are derived **only** from the same
original protected Planning assembly, never accepted from this input.

The binder rejects extra keys including externally supplied
`execution`, `authorityForTask`, `privateGatewayTransport`,
`geminiApiKey`, and other attempts to override trusted authority.
It requires exactly the Backend/Frontend/Test role ports and handlers,
canonical GitHub run ID and compatible child Status List metadata,
then freezes independent copies of the candidate root and allocator
data before passing them to the existing
`host.runReviewedScriptedApprovedDagWithGateway` pathway.

**The host remains the sole authority:** it independently consumes
a real single-use `scripted_offline` OIDC receipt, checks the
currently active GitHub job and the Engineer's real Ed25519 signature
against the Backend-signed checkpoint, issues the scoped root,
starts real A2A role servers, executes the signed DAG through
Gateway/Rust/OPA and Gitea/Docker, then retires the operational
authority. The owner facade itself NEVER fabricates a signature,
receipt or task result. It is one-shot even on failure and cannot
promote a prematurely closed or unapproved Planning session.

The standalone foreground CLI stages Planning and displays only the
login-protected loopback Engineer UI URL. It intentionally provides
no unauthenticated remote way to trigger Execution. A separately
reviewed local owner-process driver must call the in-process method
once all external human and runner prerequisites are fulfilled.
The offline tests only verify protected argument binding; they are
not evidence that external admission, task effects or revocation
have occurred. R5 remains NO-GO until those real observations exist.

## R5 — Real signed Engineer review preflight before one-time OIDC admission

The protected, original owner session now exposes
`reviewReadiness()` as a **non-authoritative, read-only check** of
its exact active Coordinator, Backend-signed checkpoint, original
staged proposal and independently authenticated Engineer Ed25519
approval. The returned receipt contains only the session ID, source
revision, signed plan digest and trusted Engineer DID. Its explicit
status is `signed_human_review_verified_only_not_oidc_admitted`.

The in-process `runApprovedScriptedDag(input)` verifies the same
signed review **after validating the owner-only Execution transport**
but **before** marking its one-shot GitHub selection and consuming an
admission receipt. Missing, altered or expired Engineer approvals do
not consume the one-use GitHub receipt, and the owner may retry
readiness after the Engineer authenticates and signs. An in-flight
readiness/dispatch attempt is serialized: no concurrent caller may
consume a second admission or race host shutdown. Once the real
Execution handoff starts, its one-shot selection remains irrevocable
even if a later root, A2A, GitHub or Gateway step fails.

The Host independently verifies the Engineer Ed25519 approval and
GitHub OIDC admission *again* at actual root issuance and during DAG
execution. The early check is only a usability and safety gate, not
a substitute for those security boundaries. The offline fixture
includes one real independently signed Ed25519 approval receipt,
checks trust-store verification and rejects a modified signature;
other unit cases cover mismatched Backend digest, retired Coordinator,
no approval and a shutdown race. Tests do **not** constitute real
human consent: fixture keys are generated inside isolated tests.

## R5 — Owner read-only GitHub private-environment preflight (26 October 2026)

The new owner-only `poc/scripts/r5-private-github-readiness.mjs` checks
GitHub administrative prerequisites with **GET requests only**:

- The reviewed development branch still equals the independent source SHA pin.
- `r5-private-scripted-admission` has required human reviewers,
  `prevent_self_review: true` INSIDE the `required_reviewers`
  protection rule. The GET response does not guarantee that administrative
  bypass is disabled; verify that independently before authorizing dispatch.
  The script denies any explicitly reported `can_admins_bypass: true`.
- The deployment-branch policy is unrestricted. Custom restrictions
  require separate review; the script does not guess their glob semantics.
- Exactly one private runner is idle and online, labelled `self-hosted`,
  `linux`, `x64` and `delegation-private`. Multiple eligible runners,
  unavailable runners or incomplete paginated listings fail closed.
- The reviewed workflow exists and is active on `main`, with the exact
  same Git blob SHA on the feature branch.

Run only from an operator-controlled host, **not from GitHub Actions**:

```bash
export DELEGATION_R5_OPERATOR_GITHUB_TOKEN_FILE=/private/engineer/github-admin-read.token
export DELEGATION_R5_EXPECTED_SOURCE_SHA=<independently-reviewed-40-character-commit>
node poc/scripts/r5-private-github-readiness.mjs
```

The GitHub token must have sufficient permissions to read environment
protection and self-hosted runner registrations. Keep it in a separate
owner-only 0600 file under an owner-only 0700 directory. Never copy
this token onto the runner, into Action inputs, model prompts or Git.
Insufficient permission means NO-GO, not a guessed success.

The result `private_admin_and_registration_preflight_only_not_r5_go`
proves only GitHub configuration *visible at inspection time*.
Administrative bypass is NOT independently attested by this REST
response and remains a manual deployment authorization requirement.
It does not attest the physical runner, installed dependencies, real
mTLS, human Ed25519 approval, operational root, A2A DAG or revocation.
PR #37 remains a one-file draft review against `main`: **no merge or
dispatch** was performed. Merging or running it requires independent
owner authorization.

## R5 — Exact one-file registration PR #37 owner review

The registration proposal stays separate from the R5 functional branch.
A new **public, read-only** audit command checks the draft PR #37 before
any owner authorization to register the workflow:

```bash
export DELEGATION_R5_EXPECTED_SOURCE_SHA=<independently-pinned-current-feature-HEAD>
export DELEGATION_R5_EXPECTED_MAIN_SHA=<independently-pinned-current-main-HEAD>
node poc/scripts/r5-scripted-registration-pr-audit.mjs
```

The audit verifies repository/default branch, expected source and main
SHAs, exact same-repository PR source and target, the independently
reviewed registration commit, draft/open/unmerged state, **exactly one**
added workflow file with 50 lines, and Git blob
`ff11137db63ade2806387537f5fd87c37e1a2285` on both the PR and
development branch. It also insists the workflow is still absent on
`main`. It performs only seven public GitHub API GET requests.

This audit will fail after an authorized merge, as intended: it verifies
the **pre-merge proposal**, not the post-merge workflow registration.
After approval, use the distinct owner-only environment/runner
and registration preflights. The PR audit never makes a merge request,
changes GitHub permissions, signs an Engineer plan, starts a workflow,
requests OIDC, or claims an R5 pass.

All reviewed pins must be reconfirmed if the default branch or source
branch moves. A green offline mocked test cannot itself verify that
the real PR is ready, nor can public repository access attest protected
environment settings, runner integrity, or administrator bypass rules.

## R5 — Durable, non-authoritative post-run evidence receipt

The owner process now requires a dedicated 0700 evidence directory
before it may use the **single-use** approved scripted DAG handoff.
Set `DELEGATION_R5_EVIDENCE_DIRECTORY=/private/engineer/evidence`
for the foreground owner launcher. It must exist and belong to the
same service UID. Nothing is written at Planning time and no receipt
is created for missing approval, aborted execution, incomplete Tasks,
unconfirmed operational root retirement or a cancelled GitHub run.

Only after `host.runReviewedScriptedApprovedDagWithGateway()` resolves,
the owner checks the *same* session and signed Engineer plan digest,
an exact one-to-one set of approved/completed task IDs and the
original Coordinator's `closed` phase. It then atomically creates
an exclusive 0600 `r5-scripted-run-<github-run-id>.json` file,
refusing to overwrite another run's evidence. The payload carries
the source SHA, manual GitHub run ID, signed-plan digest, authenticated
Engineer DID and task IDs. It deliberately omits credential bodies,
private keys, JWT, bearer tokens, model prompts and A2A artifact data.

The receipt says `verified_complete_local_owner_observation` only:
it is a *local owner-process observation*, not an independent signed
third-party attestation and never an external R5 GO. This file alone
cannot establish a remote runner's physical identity or provide
cryptographic evidence that the on-chain revocation was witnessed
outside the original trusted host. Keep the corresponding GitHub logs,
Engineer signature, Gateway/Rust/OPA traces and Gitea/Docker change
evidence for the final dissertation appendix. Any missing or partial
post-run receipt is **NO-GO** and requires manual reconciliation;
never rerun the original admission or silently overwrite an artifact.

## R5 — Fix verified terminal phase and liveness at durable close (26 October 2026)

A security-sensitive control-flow regression was found by reading the
real dispatcher/bridge contracts: `TrustedApprovedA2ADispatcher.executeApprovedDag()`
**always awaits** `TrustedExecutionCoordinator.closeExecution()`
after every signed Task. That method transitions the Coordinator
to `closed`, retires the Gateway plan, requests native Rust root
revocation and reconciles the durable record. The reviewed-DAG bridge
previously demanded the phase still be `execution` *after* that
successful awaited call. Consequently, a genuine successful Execution
could not return a verified positive result, even if all tasks completed
and revocations were confirmed. A mocked test did not notice, because
its fake dispatcher never closed the Coordinator.

The repaired path has **three distinct checks**:

1. During Execution, the host independently checks live GitHub OIDC/REST
   identity before each signed Task.
2. After the final Task and **before** Gateway and root retirement, a
   new trusted `beforeCompletion` hook rechecks that same live job.
   If it is canceled during the last A2A/Docker effect, the dispatcher
   closes the operational root in the fail-closed path.
3. After the real dispatcher returns from awaited native retirement,
   the reviewed bridge now **requires `closed`**, not `execution`.
   It independently checks the same GitHub job once more. Cancellation
   during root retirement still prevents the owner from reporting a
   successful signed DAG, even though authorization is already closed.

No test/model data can supply these liveness callbacks: they belong to
the authenticated Engineer Host; no new OIDC scope or paid model path
is created. The tests now cover proper callback ordering against the
real approved Dispatcher, failure before retirement, falsely completed
Tasks without actual closure, cancellation during retirement, and a
genuine terminal success path. The isolated bridge unit fixture is
explicitly made to mirror the Coordinator's real `closed` phase.

The CI remains an offline integration test, not a substitute for a
real distributed private runner/Engineer Host. R5 is still NO-GO until
the independently authorized deployment, genuine signature and native
end-to-end closure have been observed.

## R5 — Awaited operational revocation before positive owner evidence

Security audit after commit `948cb1b` found an important second edge
case: the real Coordinator's `closeExecution()` sets its public phase
to `closed` synchronously to fence new operations, **before** its
asynchronous Gateway shutdown, Rust/EVM root revocation and durable
journal reconciliation have all completed. A check of `phase ===
"closed"` alone is therefore insufficient evidence of revoked
authority.

`TrustedExecutionCoordinator.assertOperationalClosureConfirmed()`
now requires a real operational root, the original one-shot
`#shutdown` promise and terminal phase, then **awaits that same
promise**. Any rejected Gateway, native revocation or durable journal
action rejects the owner evidence; Planning-only cancellation is not
misclassified as operational success. The owner witness uses a real
`TrustedExecutionCoordinator` instance, cannot accept a forged
`{phase:"closed"}` object, and awaits the revocation assertion before
serializing its local completion file.

Regression tests use the **actual Coordinator**, with an artificially
held Gateway retirement to show that the phase is already `closed`
while the witness is still pending, then assert success only after
release and native revocation; a failed native revocation must deny a
positive receipt even though the Coordinator remains `closed`.
These tests do not prove a physical deployment or on-chain third-party
attestation; the original private end-to-end R5 remains NO-GO.

## R5 — Evidence provenance and atomic publication fix (26 October 2026)

An owner evidence audit found two independent weaknesses in the earlier
receipt helper. First, the write function accepted *any JSON-shaped*
`verified_complete_local_owner_observation` object, which could be
constructed without having awaited the actual Coordinator closure.
Second, direct `O_EXCL` creation at the final path exposed a partially
written JSON receipt during an interrupted write, despite the old
documentation calling the operation atomic.

The verifier now privately records the **exact frozen object identity**
it emitted after awaiting the real Coordinator's operational shutdown.
Only that same in-memory object is accepted by the writer. Clones,
object literals and altered proof envelopes fail closed. Each valid
object is also reserved synchronously, before any filesystem awaits,
so concurrent callers cannot publish it twice. This is in-process
provenance, **not a digital signature or remote attestation**.

The writer now creates a unique owner-only 0600 temporary file in the
same 0700 evidence directory, writes and `fsync`s its entire JSON,
then atomically hard-links the finished inode to the final run-specific
path with **no replace**. It removes the temporary name and syncs the
directory. A pre-existing completed-run file is never overwritten.
Publication errors, incomplete writes, permissions failures or
unknown durability produce NO-GO, require manual reconciliation, and
do not reuse the original verified observation.

New tests reject fabricated or cloned evidence, exercise concurrent
writers, verify atomic no-overwrite and temporary cleanup, and ensure
unsafe-directory/symlink tests use distinct genuine observations rather
than accidentally passing on the one-use guard alone. The resulting
file is still only a local owner-process observation; verified EVM
revocation and the independently pinned distributed runner require
external evidence before anyone may declare R5 GO.

## R5 — SIGTERM/SIGINT concurrency hardening on original owner (26 Oct 2026)

The protected owner process no longer treats a shutdown request as
independent of a currently running approved DAG. As soon as
`close()` is requested, it synchronously fences new callbacks and
aborts completion evidence publication, then asks the original
Engineer Host to terminate its active authority. It does **not**
wait for the DAG *before* asking the Host to close, because doing so
could deadlock if a hung A2A operation needs forced root retirement.
After the Host's original shutdown resolves, it awaits the retained
in-flight run/evidence promise before returning to the foreground
signal handler. SIGINT/SIGTERM remain one-shot and idempotent.

The owner checks the shutdown fence both after the original
`runReviewedScriptedApprovedDagWithGateway` returns and again after
the trusted native closure witness is obtained, and requires the
evidence writer to receive the same `AbortSignal`.

The atomic completion writer checks cancellation *before* any file
creation, after writing/fsyncing the private temporary file and after
atomically linking/fsyncing the completed run name. If cancellation
races the final link, the writer removes only its own newly linked
receipt and fsyncs the directory; it never removes a previously
existing run's receipt. If publication durability or rollback fails,
the operation returns NO-GO and requires manual inspection of the
owner-only evidence directory.

Offline regressions exercise early cancellation, deterministic
cancellation after hard-link publication and structural ordering of
Host closure versus run settlement. These tests are not an external
signed attestation or a distributed runner execution. R5 remains
NO-GO until explicit owner approval of deployment, independent
review of PR #37, authentic human Engineer consent and witnessed
real root/child revocation.
