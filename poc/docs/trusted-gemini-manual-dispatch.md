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
