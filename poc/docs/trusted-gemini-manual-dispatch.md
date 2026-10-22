# Trusted Gemini manual dispatch: limits and trust boundary

The optional GitHub Actions workflow named Trusted Gemini Manual Dispatch
Input Check validates **event inputs only** and makes **zero model calls**.
A green workflow run does NOT prove approval or permission to execute Gemini.

The validation pins the feature branch, source workflow path, GitHub event
repository/ref, a first manual attempt, the exact explicit API-charge consent,
the model identifier and strict per-call/turn limits. Its helper is
verifyGithubManualGeminiDispatch.

An actual billable execution must use startGithubReviewedGeminiHandoff inside
the existing trusted host (not a fresh GitHub-hosted job). The host supplies
the live TrustedExecutionCoordinator, Engineer review gate, backend-signed
Planning checkpoint store, Rust root parameters, private transports and API
secret independently of the workflow event. The backend-signed checkpoint
is pinned to the independent Gitea base revision; this must not be confused
with GitHub's source code checkout SHA.

The host must verify authentic separate Ed25519 backend provenance and
Engineer permission approval, issue independent operational authority after
provisional revocation, enforce Gateway/OPA/Core Rust/VP on every effect,
and revoke authority on completion or failure.

**Not yet integrated**: a deployed/authenticated stateful Engineer backend
that can maintain the real Planning session and invoke the bridge. JSON
checkpoints and CI environment flags do NOT rebuild an active root.
The older gemini-paid-shared-mcp-final.yml is not wired to this new gate.
The new manual event workflow does not call it or inject a Gemini API key.

This workflow_dispatch file will not appear as a runnable action until GitHub
exposes the workflow from the default branch. Do not merge this feature work
to main just to enable input validation.


The paid in-process bridge also independently checks an active workflow run
through the GitHub Actions REST API using a host-owned read-only GitHub token.
It requires an independently pinned source SHA, the correct workflow file,
repository, branch, first attempt, a fresh run, and an in-progress status.
This blocks a copied/old dispatch event from being accepted as a live run.

**Important remaining limitation:** the GitHub REST run record does not
cryptographically attest the free-form workflow_dispatch input values.
Any persistent Engineer backend accepting dispatch data from outside the
runner must authenticate its caller, for example through validated GitHub
OIDC claims or a private authenticated IPC channel. REST corroboration
alone is not authentication of the user's charge-consent string.


## Authenticating runner-to-Engineer calls with GitHub OIDC

The new trusted-github-oidc.ts validates a genuine **RS256** signed
GitHub Actions JWT against the issuer's fixed public JWKS URL. The trusted
backend independently configures a **unique audience**, an exact expected
subject (the GitHub default subject may be legacy or ID-based), stable
numeric repository and owner IDs, the exact workflow path/ref and source
revision. JWT issuer, timestamps, jti, workflow SHA, event type, run ID and
attempt must match; no JWT-provided URL or public key is trusted.

The host should receive this short-lived token and the manual input payload
in a single authenticated TLS/IPC request. GitHub OIDC authenticates the
**workflow job**, not the Engineer and not the content of arbitrary manual
workflow inputs. Signed Engineer approval remains a separate requirement.
GitHub OIDC uses the trusted provider
https://token.actions.githubusercontent.com and its fixed JWKS; no callback
may supply a new issuer URL or audience.

The receiving trusted host must have a persistent GithubOidcReplayFileStore
directory, owned by its own account and mode 0700. Each verified jti is
atomically marked consumed via an exclusive filesystem create (0600). A
replayed or ambiguous job token is always denied, including after restart;
a failed downstream attempt is not an authorization to retry.

The host entry startGithubReviewedGeminiHandoff now requires, in order:
strict event input bounds, cryptographic OIDC job authentication, independent
fresh GitHub Actions REST run corroboration, atomic replay consumption, and
the existing live preliminary-root/Planning checkpoint/Engineer signed
approval verification. It cannot be called with only a JSON file or an API
charge-consent phrase.

**Deployment is not complete:** no authenticated always-on Engineer service
or runner-to-host endpoint is deployed by this change. No GitHub OIDC token
is sent anywhere and no actual Gemini inference happens in offline CI. A
future authorized workflow will require job-level GitHub Actions permission
id-token: write, a host-specific OIDC audience, an independently pinned source
SHA, and a secure authenticated transport to the host. Do not add the paid
Gemini API secret to the input-check-only workflow, or infer human approval
from the JWT alone. The old paid workflow is still separate.


## Real GitHub-issued OIDC diagnostic (offline)

The cumulative **push** workflow has an isolated job named github-issued-oidc-offline.
It requests a real GitHub OIDC JWT with job-scoped id-token: write and validates
issuer JWKS signature, unique test audience, exact subject, pinned numeric
repository/owner IDs, ref, workflow path, SHA and run ID. No JWT or jti is
logged or sent to an Engineer backend. There are zero model calls.

It returns offline_push_identity_only, a separate type that is NOT accepted
by the paid workflow_dispatch verification path. No signature of the human
Engineer is supplied or inferred. Deployment of an authenticated Engineer
service remains outside this offline smoke test.


### GitHub immutable OIDC subject (July 2026)

The real GitHub-issued push test found an OIDC subject differing from the
legacy name-only template. This is expected for repositories created after
July 15, 2026. GitHub's documented immutable default format is
repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:refs/heads/BRANCH.

For this repository the independent GitHub API record fixes owner ID
150908952 and repository ID 1374168963. The offline smoke therefore pins
repo:DarkGh0st03@150908952/delegation@1374168963:ref:refs/heads/refactor/post-prof-plan-contracts-20261021.
The trusted paid backend still requires an independently provided exact
expectedSubject for its actual workflow and cannot derive trust from a
JWT-supplied subject.


## Loopback Engineer-host OIDC admission endpoint

The trusted-github-oidc-intake.ts module starts a **localhost-only** HTTP
endpoint at /v1/trusted/github/oidc-admission. The Engineer host independently
injects OIDC audience/subject and immutable repository owner IDs, a pinned
source revision, the GitHub Actions read token, and its **persistent**
owner-only replay ledger. The incoming JSON may only include the GitHub
workflow event, bounded environment metadata and short-lived OIDC token.

Admission enforces manual workflow_dispatch identity, cryptographic GitHub
OIDC signature, independent in-progress Actions REST corroboration and
atomic one-use replay consumption. Responses never expose the JWT, API
secret, token ID, Engineer approval or private host config.

**This endpoint is deliberately authentication-only**. It does not issue
root credentials, load Engineer signing keys, open ADK/Gemini, invoke tools,
or launch execution. It cannot accept an unauthenticated public reverse
proxy or replace actual Engineer Ed25519 approval. A future persistent
Engineer service must deliver the OIDC assertion and event over an
authenticated private channel and integrate the full trusted Coordinator
and signed permission review atomically. No external backend is deployed.


## Persistent Engineer handoff of OIDC-verified manual inputs

The intake now requires a TrustedGithubAdmissionReceiptStore configured
with an independently selected **Engineer session ID** and a stable secret
containing at least 256 bits, sourced from the trusted backend's secret
manager. Only after OIDC, GitHub Actions REST corroboration and replay
consumption does it persist a bounded HMAC-SHA256-authenticated record in
an owner-only 0700 directory. The GitHub job's exact consent, bounded model
settings, repository/ref, run ID and checkout SHA are covered by the MAC.
The original JWT, its jti, private keys and Gemini API key are NOT written.

The independent Engineer host calls startAdmittedGithubReviewedGeminiHandoff
using its own pinned session, run ID, repository/ref and GitHub source SHA.
The receipt is accepted only for these exact parameters, is valid for up to
five minutes and is irreversibly consumed via an atomic exclusive marker
even if a subsequent Engineer signature check or operational issuance
fails. A fresh run and separate signed Engineer approval are necessary
for subsequent attempts. Never treat the receipt, OIDC signature or manual
charge consent as an authority grant by themselves.

**Important:** two independently trusted processes must have the same host
secret and protected persistent filesystem; this does NOT deploy a remote
Engineer backend or create an authenticated network connection between
GitHub-hosted Actions and the localhost-only intake. The old paid
workflow is still separate, with no approval shortcut and no Gemini call.


## Consuming authenticated admission in the Engineer host

The trusted-admitted-github-handoff.ts module introduces a separate, in-process
continuation. consumePinnedGithubAdmission requires an independently configured
session ID, GitHub run ID, exact source SHA, repository and ref. It consumes a
short-lived HMAC-authenticated receipt exactly once and returns only bounded
manual model settings: **not** an Engineer signature, operational DC or token.

startAdmittedGithubReviewedGeminiHandoff first requires a live Planning
Coordinator and trusted Engineer/checkpoint objects; it then consumes the
admission and passes only its pinned model/turn/token/timeout limits and
host-owned API secret to the original persisted signed-review handoff.
Engineer Ed25519 approval, backend checkpoint verification, operational root
issuance and Gateway/Rust/OPA checks remain independent and mandatory.

This is a code-level in-process boundary, **not a deployed end-to-end runner**.
The existing input-check-only GitHub workflow remains non-billable. There is
still no publicly reachable Engineer service or permitted remote connection.
Do not interpret an OIDC CI probe or stored admission as authorization for
Gemini inference, and do not run the paid workflow without explicit consent.


## Local co-hosted Engineer/OIDC process (offline, non-billable)

poc/apps/orchestrator/src/trusted-engineer-host.mjs now composes the existing
password/CSRF-protected Engineer approval console and the signed GitHub OIDC
admission verifier in ONE trusted local process. It uses owner-only, separate
persistent directories for the Engineer's Ed25519 approval receipts, OIDC
replay ledger, and authenticated HMAC admission receipts. A single trusted
session ID is pinned by the host; the GitHub code SHA and the independent
Gitea Planning base SHA remain distinct.

Neither HTTP endpoint starts Gemini, issues an operational root, consumes an
Engineer approval or triggers an A2A task. The host offers a private
in-process consumeAuthenticatedRun(runId) and startReviewedHandoff(...)
interface; the latter is not exposed over HTTP and still requires the live
Coordinator, backend signed checkpoint and independent Engineer signature.
The simulated GitHub/JWKS and password integration test uses only disposable
keys and zero paid API calls.

IMPORTANT: both listeners bind to 127.0.0.1 ONLY. This is a testable local
composition boundary, NOT a deployed remote connection from GitHub Actions
to an Engineer machine. For a real GitHub-hosted workflow a separately
authenticated private relay/tunnel or mTLS transport and its deployment
must be designed and validated. Never open these loopback ports via a
public reverse proxy, never forward an API key or Engineer signing key
to a runner, and do not trigger the older paid workflow as a workaround.


## Optional private mTLS runner transport (offline-tested, not deployed)

The local Engineer host optionally accepts owner-configured mTLS material for
its *OIDC admission listener only*. With mTLS configured, the intake uses
HTTPS, requests a client certificate, rejects untrusted peers and binds to
127.0.0.1. The password-protected Engineer approval UI remains separate
and loopback HTTP. The OIDC JWT is still cryptographically verified against
GitHub issuer keys and corroborated against an in-progress Actions run.
The client certificate alone is NEVER the signed Engineer approval.

trusted-github-oidc-submit.ts is a bounded runner-side helper. It obtains
the short-lived GitHub job token from the official Actions issuer request
endpoint with a host-pinned audience and submits the JWT and manual event
in a single HTTPS request with client key/certificate and an independently
supplied server trust CA. It refuses redirect-based token fetching, TLS
verification bypass, response ambiguity and replay; it never returns or logs
the JWT. The offline test uses disposable OpenSSL certs and a fake issuer
to exercise a real HTTPS/mTLS socket and one-use HMAC receipt persistence.
It cannot authorize models or issue DCs.

No billable workflow is changed or dispatched. A GitHub-hosted runner cannot
reach a local 127.0.0.1 socket by itself. The operator must still provision
a separately authenticated private-network relay/overlay, protected
certificates and an always-on live Planning/Engineer backend before any
real manual run. NEVER configure this helper with public HTTP, add Gemini
keys to GitHub Actions, or treat OIDC admission as permission to execute.


### Exact mTLS client identity pin (security hardening)

The HTTPS intake now requires a host-pinned fingerprint256 of the one
authorized GitHub runner certificate in addition to CA validation. A
different client certificate issued by the same trusted CA cannot
authenticate as the pinned runner or consume its OIDC replay record.
The test uses separate short-lived disposable CA, server, trusted client,
and CA-signed rogue client identities. Never reuse test certificates for
deployment. Rotating an authorized client leaf requires an explicit trusted
host configuration change.


The runner obtains ACTIONS_ID_TOKEN_REQUEST_URL from GitHub rather than
constructing a fixed issuer endpoint. GitHub's OIDC service URL can use
token.actions.githubusercontent.com, vstoken.actions.githubusercontent.com,
or pipelines.actions.githubusercontent.com. The bounded client accepts only
these HTTPS hosts on the default TLS port, refuses redirects, and preserves
the independently selected audience; no GitHub bearer is forwarded to a
generic URL. The endpoint continues to authenticate the signed token
against token.actions.githubusercontent.com and the pinned run identity.


## Full offline OIDC-to-Coordinator cross-boundary regression

The trusted-planning-review-gate suite now exercises a complete local chain:
a real RSA-signed mock issuer JWT is verified using the production GitHub OIDC
validator with pinned immutable owner/repository IDs, audience and workflow
SHA, independently corroborated against a simulated active GitHub Actions
REST run, then passed through one-use replay and session-bound HMAC admission.
A real active TrustedExecutionCoordinator, independently signed backend
Planning checkpoint, Ed25519 Engineer receipt, and Gateway plan registry
are required before the operational root and three local A2A listeners can
activate. The test first rejects a wrong signed subject and unapproved handoff,
then admits a new separately signed first-attempt manual run, approves the
real plan and proves cleanup/revocation. No provider-model inference occurs.

Only the earlier isolated push probe uses a token actually issued by GitHub.
The combined integration test uses disposable mock issuer keys and a mocked
GitHub REST response, so it is **not** evidence that a deployed private
network runner-to-host connection exists. Its intake is local HTTP because
mTLS is separately exercised with real sockets and certificates in the
Engineer host suite; neither endpoint is publicly exposed.


## Recheck GitHub run status at the operational handoff

An accepted and persisted OIDC admission proves that the manual job was
in progress at INTAKE time, not necessarily when its Engineer-approved
execution later starts. startAdmittedGithubReviewedGeminiHandoff now
permanently consumes the one-use admission and immediately corroborates
the exact GitHub run via a SECOND host-owned REST request: workflow file,
first attempt, pinned repository/ref/source SHA, freshness, and
**in_progress** state must still match. Completed, canceled, stale or
substituted runs are denied before operational root issuance and cannot
reuse the consumed receipt. The Engineer local host injects its OWN GitHub
Actions read token and exact workflow path rather than trusting them from
a runner-supplied request. Offline tests cover a run that completes after
admission, then show that only a fresh, independently authenticated run
can activate the real trusted Coordinator with Ed25519 approval.

This check closes the intake-to-start TOCTOU window; stopping a run AFTER
execution begins would still require a separate runtime cancellation/
revocation watch. Do not claim it provides continuous GitHub status
monitoring or that this process has been deployed.


## Runtime GitHub-run watch and operational-root shutdown

Once a manual signed run has passed the independent Engineer/Planning gate
and activated the operational root, the trusted handoff starts a 15-second
GitHub Actions REST status watch. It checks the same pinned first-attempt
workflow identity, branch, GitHub source SHA and **in_progress** state using
the host's Actions:read token. This does **not** call Gemini. An immediate
check after starting A2A listeners closes the remaining activation race.

If the run becomes canceled, completed or unverifiable (including loss of
API connectivity), the watch closes A2A listeners, deactivates the Gateway
approved-plan session and attempts revocation of the independent operational
Rust DC. The watch exposes an in-process checkNow() for deterministic tests
and a status of active, closing, closed or revocation_unconfirmed. The latter
requires operator reconciliation; it must never be treated as a successful
revocation. Manual shutdown and automatic shutdown share one promise and
cannot issue a second root. A successful check does not prove that the run
will remain active for the entire next 15-second interval: this is a
bounded, fail-closed polling mechanism, **not instantaneous cancellation**.

The regression test uses an active trusted Coordinator and models a completed
GitHub run AFTER operational issuance. No paid Gemini inference is invoked.


### Termination order at the policy boundary

The trusted handoff closes the Gateway approved-plan session and attempts
revocation of the operational Rust root **before** waiting for A2A HTTP
listeners to drain. This denies new provider effects promptly even when
an agent connection does not close immediately. A2A listener cleanup is
still attempted if Gateway closure or DC revocation fails, and uncertain
revocation is reported explicitly rather than treated as a successful stop.


## Crash fence: Gateway-owned expiring operational lease

To avoid depending on the Engineer process for enforcement, the opt-in
TrustedApprovedExecutionPlans registry can be configured with an independent
operationalLeaseMs (10 to 120 seconds). For the authenticated GitHub manual
handoff, a lease-aware Gateway is now **mandatory** before consuming OIDC
admission or issuing an operational root. The trusted Coordinator renews
that lease only after a successful live GitHub Actions run verification
(default manual watch: every 15 seconds; fixture Gateway lease: 45 seconds).
No agent, ADK callback, MCP tool or public Gateway HTTP request can renew it.

The Gateway checks its own wall-clock expiry on task binding, Prepare, and
again **after** VP and OPA verification and immediately BEFORE provider I/O.
A stale already-Prepared request therefore fails even if its signed VP and
OPA decision would otherwise allow it. The lease also blocks asynchronous
task-completion attestations when it expires before their return.
Expiration permanently marks the session inactive: later renewals, even
after clock rollback, cannot resurrect it. The tested failure scenario
simulates an Engineer crash by stopping renewals while leaving Gateway
running; authorization is denied without requiring the Engineer shutdown
callback. Underlying Rust DC validity/revocation remains a separate and
necessary security boundary, not replaced by this lease.

The lease currently lives in the trusted Gateway registry's own process.
An independently deployed Gateway process must inject the SAME in-memory
registry into its real Prepare/Execute request paths and expose authenticated
private renewal IPC to the Engineer process; no remote Gateway deployment or
crash-recovery persistence is claimed. Provider operations already in flight
at the precise instant of expiry are not automatically interrupted; a
continuous trusted cancellation mechanism would be separate hardening.


### Authenticated separate-process lease renewal

The pre-existing owner-only Unix socket Gateway control plane now accepts
two strictly scoped HMAC-authenticated management commands: lease_status
and renew_lease (session ID + independently approved plan digest). Both
commands are denied over public Gateway HTTP, A2A, MCP and agent tool
surfaces. During connection, the Coordinator reads the actual remote Gateway
lease capability over the authenticated socket, rather than trusting a
caller-provided flag. The trusted deployment bootstrap optionally accepts
TRUSTED_PLAN_OPERATIONAL_LEASE_MS (10,000..120,000) and owns the clock.

A dedicated separate-process regression deliberately stops renewing the
lease, leaves the Gateway child process and already-prepared challenge
alive, waits for the minimum TTL, and checks that both Execute and Prepare
are rejected. Even a valid private IPC renewal with the wrong plan digest,
or any attempted renewal after expiry, is denied. The test also verifies
that normal explicit Coordinator cleanup can still revoke the DC after
Gateway expiry, but is not required to stop new provider calls.

The separate-process IPC transport is implemented, but **not deployed** on
an always-on Engineer + Gateway infrastructure. Lease enforcement is at
Gateway authorization boundaries, not at the independent Rust status
registry, and does not kill provider operations already in flight.


## Durable operational-root crash recovery (trusted-only)

A one-use, 0600, fsynced owner-only journal records the **intended operational
credential ID and exact session/Gitea SHA before the Adapter issuing request**.
If the Engineer process dies during or after issuing that root, a new trusted
bootstrap can enumerate pending intents, permanently retire the session in the
Gateway (including before activation), revoke the exact credential through
the Rust Adapter, and retire the journal entry only after both operations
have returned confirmation. A failed revoke, inaccessible Gateway or partial
journal record blocks fresh Planning and demands operator reconciliation.
Pending sessions are never resumed or automatically reapproved. The journal
contains no keys, signed tokens or permission bodies. The authenticated
GitHub handoff requires both this recovery journal and the Gateway lease.

The explicit `reconcileOrphanedOperationalRoots` entrypoint is a trusted
bootstrap operation, not an A2A/MCP/HTTP endpoint. Its caller must supply
separate authenticated Gateway retirement and Adapter revocation ports.
The journal prevents losing the root identifier, while the separate Gateway
lease independently denies new operations if the Engineer is unavailable.
