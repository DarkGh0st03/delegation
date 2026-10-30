# R124 — Real Engineer Host reserves a trusted new repair DAG after signed Test FAIL

Date: 30 October 2026. Development branch: `refactor/post-prof-plan-contracts-20261021`.

## Why
R123 reached the real admitted Engineer Host but delegated the entire
owner recovery to an arbitrary private callback. R121 and R122 already
provide one-use Gateway HMAC attestation and a non-consuming confirmed
read-back. The real owner still did not assemble the repair planner
with the original signed Agent registry and independently observed Gitea
HEAD.

## R124
The owner-only recovery configuration can now choose EITHER the
original custom continuation OR a built-in `planRepairEpoch` mode,
never both. The latter requires an actual private `GiteaClient`
and proposal callback. Neither is accepted from GitHub/OIDC, A2A,
MCP, model output or the signed Task executor; both are selected in
the trusted host bootstrap.

After the dispatcher has authenticated and finalized the Test FAIL,
the R123 owner bridge re-reads the actual Gateway registry through
R122 IPC. Under the SAME Coordinator-issued Rust root and original
Ed25519 Engineer signature, it constructs `TrustedOperationalRepairPlanner`.
The immutable candidate Agent identities/repository originate
exclusively from the original authenticated approval. The next plan ID
is fresh, owner-generated, and all model-proposed permissions must
fit the actually issued original root grants. Gitea HEAD must equal
the failed Runner's SHA both before and after the proposal.

The planner reserves exactly one fsynced additional epoch and returns
`execution_authorized:false` and `child_credential_issued:false`.
It does NOT admit Gateway work, issue a child, run Docker or create a PR.
The outer reviewed handoff still revokes the original root and verifies
terminal closure. One-use protection prevents retry after an error.

Five offline tests cover successful signed root→IPC→fresh epoch,
stale HEAD before model, out-of-root proposal, root revocation during
proposal, and ambiguous owner configurations. Gitea HEAD and Runner
effects are test fixtures, not real Docker repair acceptance.

## Remaining
R125 must add durable cross-process Gateway admission of the owner
reserved epoch, with a source-of-truth shared signed journal or
independently matched authenticated epoch proof, before issuing fresh
attenuated Rust Child DCs and executing another Task. Do not allow
`read_test_failure` or this reserved plan to bypass Gateway's
separate operational admission requirements.

No Gemini charges and no main merge.
