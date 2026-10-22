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
