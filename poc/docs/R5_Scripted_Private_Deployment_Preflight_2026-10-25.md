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
