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
