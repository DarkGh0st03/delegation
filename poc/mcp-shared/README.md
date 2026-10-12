# One shared MCP server — experimental spike

Status: **read_file experimental spike validated in separate real-infrastructure and native-ADK tests**. An opt-in combined ADK → MCP → Gateway → Rust → OPA → Gitea read-only smoke is also provided; run it before claiming combined E2E success. All other tools continue through existing FunctionTools. Full write-enabled A2A integration remains out of scope.

The standalone `poc/mcp-shared` package remains outside the existing `poc` npm workspaces. The ADK agent-runtime workspace now pins MCP SDK 1.26.0 in its npm dependencies and committed lockfile; the shared package has its own committed lockfile.

## Architecture

```text
                   ONE shared MCP server (Streamable HTTP)
       Backend Agent ──┐           │
       Frontend Agent ─┼── MCP authenticated tools/call
       Test Agent ─────┘           │
                                 ▼
                     role-routed private worker
                                 │
                  ACTIVE task registry, task_id + jti
                                 │
                     task-scoped Gateway client
                                 │
                       prepare → signed VP → execute
                                 │
                       Rust Verifier → OPA → Gitea
```

- The MCP service stores only public Ed25519 verification keys and fixed
  worker endpoints. It **never** receives the Adapter token, Delegation
  Evidence or a Gitea/Runner token.
- A task-scoped signed bearer is issued by the trusted Agent runtime. The token
  carries role, task_id, audience, issued/expiry timestamps and a random jti;
  it is NOT a Delegation Credential and does not authorize repository access.
- A private `POST /internal/mcp-tool-call` worker is mounted on the existing
  Agent A2A Express server **only when** `mcpTaskSigning` is explicitly supplied
  in `startSpecializedAgentServer({role,adk,mcpTaskSigning})`.
- The worker checks the token signature, exact active task id and current jti.
  It then uses that task's EXISTING `GatewayControlledToolClient`, which owns
  its own `DelegationEvidenceHandler`. Task cancellation/finish deregisters it.
- The shared catalog currently supports `read_file` and experimental `update_file`; ADK writes are explicitly opt-in. The Gateway (not MCP)
  computes the authoritative ResourceUri and Operation.
- Cross-role or cross-task token selection is not an LLM-controlled argument.

## Running the shared server

```sh
cd poc/mcp-shared
npm install
npm test
npm start
```

The MCP server expects `MCP_BACKEND_PUBLIC_KEY`, `MCP_FRONTEND_PUBLIC_KEY`,
`MCP_TEST_PUBLIC_KEY`, plus the three fixed `MCP_<ROLE>_WORKER_URL` values.
By default it binds `127.0.0.1:8097`.

The private Agent worker must be enabled using the matching keypair in trusted
runtime configuration. The runtime's private signing key is never given to MCP.
The worker listens on the Agent's existing private network endpoint.

**Native Google ADK MCPToolset is wired to the task bearer.** A successful `/health` response alone still does not demonstrate functional MCP authorization; run the integration tests below.

## Security limitations (deliberate / not yet solved)

1. A task bearer can be replayed by whoever possesses it until it expires,
   rotates, or the worker deregisters the task. It is scoped to one active
   task/Agent and still subject to Gateway/DC/VP/OPA, but must be protected
   in transport, memory and logs. Keep the worker on a private network.
2. The existing VP does not carry a cryptographically signed A2A task_id claim.
   This spike enforces cross-task isolation through trusted active-task
   association, not by modifying Rust cryptography.
3. MCP results must be adapted to the existing Gateway-confirmed ADK tool
   outcomes. An LLM's claimed success is never sufficient for an A2A Artifact.
4. read_file-only cannot complete a full positive A2A task, which currently
   requires a confirmed repository revision. Test MCP read separately before
   the full write/Artifact integration.
5. Native ADK/MCP integration, cross-task HTTP tests and real Gateway/Adapter/Gitea read-only smoke have passed locally; combined ADK + real-infrastructure smoke remains a separate opt-in gate. Writes, production deployment and full A2A validation need further tests.

No modifications to core Rust, OPA, Gateway, Orchestrator templates or main.


## Opt-in native Google ADK MCPToolset (read_file only)

Use **Google ADK 2.2.1** and the compatible **MCP SDK 1.26.x**, not MCP SDK v2.
The pinned ADK package declares `@modelcontextprotocol/sdk ^1.26.0` as an
optional peer dependency. Installing the SDK only inside `poc/mcp-shared` is NOT enough
because ADK resolves its own dependencies from the root npm workspace.

On a connected development machine, generate a VALID npm lock update:

```sh
cd poc
npm install @modelcontextprotocol/sdk@1.26.0 --save -w @thesis/agent-runtime
npm ci
cd mcp-shared
npm install
npm test
```

**Commit both updated `poc/packages/agent-runtime/package.json` and
`poc/package-lock.json` together** after verifying `npm ci`. Do not edit
the lockfile manually or merge this spike with a broken reproducibility check.
The isolated shared server package now has a committed lockfile.

For each agent configured with `AGENT_RUNTIME_ENGINE=adk`, opt in with:

```text
ADK_MCP_SHARED_URL=https://shared-mcp.example/mcp
MCP_TASK_SIGNING_PRIVATE_KEY=<private Ed25519 PKCS8 PEM, trusted runtime ONLY>
MCP_TASK_SIGNING_PUBLIC_KEY=<matching public Ed25519 SPKI PEM>
```

Loopback `http://127.0.0.1:8097/mcp` is allowed for a local development
spike. Remote MCP endpoints must use HTTPS. The shared MCP process receives
ONLY public verification keys and fixed worker URLs. Set
`MCP_BACKEND_PUBLIC_KEY`/`MCP_FRONTEND_PUBLIC_KEY`/`MCP_TEST_PUBLIC_KEY`
to match the agent runtimes and use the correct
`MCP_<ROLE>_WORKER_URL`. Do not expose the private worker publicly.

The trusted Agent runtime refreshes the task bearer for EVERY MCP HTTP
request; the transport refuses to send it to any URL other than the exact
configured endpoint or across redirects. The model sees only
`read_file(branch,path)`, never tokens or role/task credentials.

## Test gates before integrating more tools

- `node --experimental-strip-types --test poc/packages/agent-runtime/test/mcp-task-fetch.test.ts poc/packages/agent-runtime/test/mcp-read-result.test.ts` from repository root tests the pure transport and result handling.
- The shared package integration tests exercise `tools/list` and `tools/call` over real Streamable HTTP SDK client/server; the native ADK tests verify the MCPToolset Runner path.
- Repeat with the real Gitea/Adapter/Verifier/OPA stack, positive and negative
  role/task permissions, no Gemini spending first.
- A read-only `read_file` spike CANNOT produce the commit SHA required by
  the normal A2A success artifact; full A2A E2E needs a later write tool.


## Real authorization smoke (no Gemini)

Run the existing Phase 5A infrastructure, fixture and Adapter/Gateway services
as in the baseline \`phase5a-smoke\` GitHub Actions job, including
\`GATEWAY_PROVIDER_MODE=gitea-readonly\`. The read fixture must exist at
\`feature/account-suspension\`. If that branch has advanced, set \`EXPECTED_GITEA_REVISION\` to its verified current SHA; never reset the branch just to run a read-only smoke.

The smoke runs **real MCP HTTP**, the **private Agent worker**, **Gateway
prepare/execute**, the **Rust Adapter/Verifier**, **OPA** and **Gitea**, not
fake Gateway/Adapter responses:

\`\`\`bash
# From the repository root; load the same private dev credentials as Phase 5A.
set -a
source poc/infra/.env
source poc/infra/runtime/gateway.env
set +a
export GATEWAY_SMOKE_URL=http://127.0.0.1:8080
export ADAPTER_SMOKE_URL=http://127.0.0.1:8090
npm --prefix poc/mcp-shared run smoke:real
\`\`\`

This command does **not** bootstrap Docker/Gitea/OPA/Adapter/Gateway itself.
Start those services first using the existing Phase 5A instructions/job. The
script issues temporary root and child DCs using developer fixture credentials;
never run it against a production Adapter or repository.

Assertions: authorized \`read_file\`; denied out-of-scope file; denied
cross-task and cross-role; denied completed task; unchanged Gitea file and
exact original Git revision. Output contains only fixed labels, count-free
test categories and the public test revision; no DC, token, VP or file content.

The script does **not** establish full A2A/Gemini integration or validate
the LLM's tool selection. Those are separate gates.

## Combined native ADK + real infrastructure smoke (no Gemini)

After `npm --prefix poc run agent-runtime:test` (115 passing tests as of this
spike) and `npm --prefix poc/mcp-shared test`, run the combined smoke with
the SAME locally running read-only Gateway, Rust Adapter, OPA and Gitea.
Do not run against production: the script creates fresh fixture DCs in the
Adapter, reads an existing Gitea file, and never writes to Gitea.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
export GATEWAY_SMOKE_URL=http://127.0.0.1:8080
export ADAPTER_SMOKE_URL=http://127.0.0.1:8090
# Use the CURRENT feature/account-suspension branch SHA, verified beforehand.
export EXPECTED_GITEA_REVISION=ff8032c6fa5def272f1fd222ea47a7746d2d5328
npm --prefix poc/packages/agent-runtime run adk:mcp:real-smoke
```

The scripted `@google/adk` Runner first requests a delegated `read_file`,
then an out-of-scope `read_file` (denied by real authorization), then the
original permitted read again. All three calls must traverse ONE shared MCP
listener and the private task worker. The script checks Gitea content/revision,
the authoritative ADK after-tool outcomes, and that private DC IDs, Adapter
caller tokens and the MCP bearer never enter the model request context.
It prints only safe labels and a public test revision.

**Scope:** this tests a real ADK tool cycle against real infrastructure, NOT
the external A2A transport, actual Gemini reasoning, write tools, or end-to-end
multi-agent task/merge completion. Those need dedicated follow-on tests.

## Protected A2A + native ADK + real MCP read-only regression

To exercise an actual protected A2A HTTP+JSON task in addition to the
standalone ADK Runner smoke, keep the local Gitea, OPA, Rust Adapter and
read-only Gateway running and run:

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
export GATEWAY_SMOKE_URL=http://127.0.0.1:8080
export ADAPTER_SMOKE_URL=http://127.0.0.1:8090
export EXPECTED_GITEA_REVISION=ff8032c6fa5def272f1fd222ea47a7746d2d5328
npm --prefix poc/packages/agent-runtime run a2a:mcp:real-read-smoke
```

This starts ONE shared MCP HTTP server and one **real Backend A2A endpoint**.
The A2A client discovers the Agent Card, submits two protected tasks with
privately transported Delegation Evidence and polls terminal Task status.
A locally scripted Google ADK Runner requests: (1) a real delegated Gitea
file read, (2) a forbidden, out-of-scope read. Gateway/Rust/OPA enforce both.
The test validates model-visible results, terminal Task privacy, and that
a completed task no longer authorizes MCP tool calls.

**Expected behavior:** both read-only A2A tasks finish FAILED **on purpose**,
with zero Artifacts, even though the first `read_file` succeeds, because the
protected Agent contract requires a Gateway-confirmed Git commit revision to
publish a completed Artifact. A read-only tool cannot produce that revision.
This is a fail-closed invariant, not a smoke failure.

No external model calls or Gitea writes are made. This is not yet a successful
write-enabled multi-agent A2A workflow; MCP write operations and merge approval
need their own isolated authorization tests before integration.

## Experimental MCP update_file (write tool NOT enabled by default in ADK)

The shared Streamable HTTP service now advertises `update_file` and `create_file` alongside
`read_file`. The trusted private worker accepts this operation only for an
ACTIVE, role-bound task with an allowed writable path; the Gateway and real
Delegation Credential/Verifier/OPA still make the authoritative authorization
decision. Complete source replacement has a 60 KiB UTF-8 cap, including a
128 KiB JSON request cap at both MCP and the private worker.

**Safe staged rollout:** `read_file` remains the only MCP tool in Google ADK
unless the ADK handler is explicitly configured with `mcpUpdateFile:true`
**and** `mcpSharedUrl` plus matching private worker signing keys. Legacy
`update_file` FunctionTools remain unchanged when this flag is absent.
Existing read-only Gateway mode also continues to forbid actual writes.

Synthetic regression:
- `npm --prefix poc/mcp-shared test`: MCP SDK HTTP write allow/deny, inactive
  task rejection, Backend role-specific path control and schema validation.
- `npm --prefix poc run agent-runtime:test`: native ADK `MCPToolset` write
  routing and rejection of unconfirmed/malformed Gitea revisions.

**Important:** These tests use mock Gateway tool clients for writes and do
not modify Gitea. A separate isolated real-Gitea write test and A2A
integration must pass before activating MCP writes in the normal workflow.

## Opt-in REAL update_file integration against isolated Gitea

The previous native ADK write tests are simulated. This optional script performs
one real delegated MCP write with the unchanged Rust Adapter/Verifier and OPA
policy, but against a **disposable Gitea Docker container**, NOT the persistent
`delegation-poc-gitea` instance.

Prerequisites: Docker Desktop, running OPA on localhost:8181, running Rust
Adapter on localhost:8090, and env loaded from `poc/infra/.env`. The normal
Gateway can remain running in `gitea-readonly` mode.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc/packages/agent-runtime run adk:mcp:isolated-write-smoke
```

It starts temporary Gitea with **no bind mounts or named volumes** and a
random loopback-only port, creates a private fixture repository with the
same identifier as the fixed OPA policy, and launches a separate ephemeral
write-enabled Gateway on another random loopback port. The existing Gateway,
Gitea and Git branches are never selected by this script.

After creating fresh root and Backend child Delegation Credentials in the
existing *development* Adapter, native Google ADK invokes shared MCP
`update_file`. Real Gateway/Verifier/OPA authorize one write. A second
out-of-scope write must be denied. The script checks the actual isolated
Gitea branch and file content, exact returned commit SHA, unchanged isolated
main, and no private authority in model requests.

The disposable Gitea is stopped and removed on completion; no real repository
changes survive. Docker may need temporary disk space for a second Gitea
container. **Do not run against production credentials or Adapter**.
No Gemini/OpenAI requests. A successful result prints
`"event":"adk_mcp_isolated_real_write_smoke","status":"PASS"`.

**Coverage boundary:** this validates a real write through the MCP tool, but
not yet multi-agent A2A write completion or approval-gated merges.

## Experimental create_file — Test Agent only

`create_file` is advertised on the SAME shared MCP endpoint. It only accepts
the exact path `tests/e2e/account-suspension.spec.ts`, and a maximum source
size of 60 KiB UTF-8. The private task registry rejects all create requests by
default. Activation requires the Test Agent A2A/ADK configuration
`mcpCreateFile:true`, a matching active task registry and shared MCP endpoint.
The private worker checks the task role and its precise creatable path before
calling the unchanged Gateway; DC/VP/OPA/Gitea remain authoritative.

Without the flag, Test Agent's existing `create_file` FunctionTool is
unchanged. Backend/Frontend cannot enable this tool. The MCP result adapter
only accepts an exact Gitea-confirmed create commit and blob SHA.

Synthetic create_file regressions have passed. An opt-in isolated real-Gitea
create smoke is available below but must be run before claiming that specific
integration is validated. Complete protected A2A write/create is not yet
validated. `run_tests` remains a FunctionTool pending separate integration.

## Opt-in real create_file smoke on isolated Gitea (no Gemini)

Prerequisites: Docker Desktop; local running Rust Adapter on 127.0.0.1:8090
and OPA on 127.0.0.1:8181. The persistent Gitea and read-only Gateway are
**not used** by this test.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc/packages/agent-runtime run adk:mcp:isolated-create-smoke
```

This script launches a SECOND, disposable Gitea Docker container with no
named volumes or bind mounts and a random loopback port. On an isolated
feature branch, the test target `tests/e2e/account-suspension.spec.ts` is
initially absent. A dedicated ephemeral Gateway is configured in real Gitea
mode with the existing local Rust/OPA infrastructure; fresh root and
**Test Agent child** Delegation Credentials allow only that create operation.

A scripted `@google/adk` Test Agent calls `create_file` via the ONE
shared MCP Streamable HTTP service and its active private worker. The
Gitea commit SHA and file bytes are then verified directly through Gitea;
a second identical create must be rejected, and the isolated `main`
revision must remain unchanged.

On exit the temporary container is stopped/removed, and the existing
Gitea and Git branches remain untouched. The script has **no Gemini
calls**, but it creates ephemeral DCs in the local development Adapter.
It is not yet an A2A multi-agent workflow or `run_tests` MCP integration.

## Experimental MCP run_tests — Test Agent only

The shared stateless Streamable HTTP server now advertises `run_tests` as
the **fourth** specialized tool. Its argument schema allows only
`branch:"feature/account-suspension"` and `profile:"poc-default"`.
It never executes arbitrary commands or accepts shell arguments. The
trusted Test Agent worker requires a signed, ACTIVE task **and**
`mcpRunTests:true`; Backend and Frontend are always denied. The real
Gateway performs DC/VP verification and OPA evaluation and invokes the
existing Controlled Test Runner pinned to the current Gitea commit.

The network router uses a maximum 16.5-minute upstream timeout only for this
tool (ordinary MCP calls retain the existing 10-second timeout). The Test Agent Gateway wrapper uses a separate 16-minute execute timeout for\nthe controlled Runner; normal Gateway operations preserve their original limit. A\nnon-passing project test gate or researcher acceptance gate is mapped to
`tests_failed`, never an authorized success. Both mandatory PASS gates,
matching 40-character tested Git SHA and controlled Runner metadata are
required before ADK can count a successful test execution.

With the flag absent, the legacy `run_tests` FunctionTool is unchanged.
An isolated synthetic Runner test covers the MCP and native ADK calls; the
actual Docker Controlled Runner and the full A2A multi-agent pipeline
are **not yet validated through MCP**. Real long-running SDK behavior and
timeouts still need end-to-end verification.

## Real Docker Controlled Test Runner behind ADK + shared MCP (negative gate)

The opt-in smoke below launches a **second disposable Gitea Docker container**
and a separate local Controller, Gateway and Test Agent MCP worker. The
persistent thesis Gitea and already running Gateway are never selected.

It creates a minimal **deliberately failing** repository on the temporary
feature branch: a `package.json` without a lockfile. Thus the unchanged
Controlled Runner must fetch its exact Git SHA, extract it, create and start
an isolated Node Docker container, execute the *fixed* `npm ci` phase
(which fails quickly), skip later phases, and return a structured FAIL.
The ADK Test Agent must receive only `tests_failed` (not a false PASS).
This validates the *negative* real-Runner path; it does NOT demonstrate
the successful Playwright/researcher acceptance pipeline.

The script checks the returned Runner commit SHA against the isolated
Gitea feature branch, confirms neither `feature` nor `main` moved,
then destroys temporary logs and Gitea after use. Rust Adapter and OPA
must be running on local loopback. Credentials and model output are sanitized.
No Gemini calls or Gitea writes outside the disposable container.

**Important disk safeguard:** the `node:22.15.0-bookworm` Runner image must
already be cached locally. The script does *not* download it. To inspect:

```bash
docker image inspect node:22.15.0-bookworm --format '{{.Id}}'
```

Run only on a machine with Docker Desktop, sufficient temporary disk space,
the Node Runner image locally cached, Rust Adapter and OPA healthy:

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc/packages/agent-runtime run adk:mcp:isolated-real-runner-smoke
```

Expected top-level event: `adk_mcp_isolated_real_runner_smoke` with
`status:"PASS"`, **expected_controlled_outcome:"tests_failed"**.

## Three real A2A role servers, ONE shared MCP, real read-only infrastructure

This opt-in smoke extends the validated Backend-only A2A read smoke to
**Backend, Frontend and Test** running as three separate native Google ADK
A2A HTTP+JSON servers. Every role gets its own private task registry and
Ed25519 key; all three share ONE external Streamable HTTP MCP listener.
Use the already running **read-only** Gateway, Adapter, OPA and Gitea,
preserving the existing feature branch and protected main unchanged.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
export GATEWAY_SMOKE_URL=http://127.0.0.1:8080
export ADAPTER_SMOKE_URL=http://127.0.0.1:8090
export EXPECTED_GITEA_REVISION=ff8032c6fa5def272f1fd222ea47a7746d2d5328
npm --prefix poc/packages/agent-runtime run a2a:mcp:three-role-read-smoke
```

The script creates fresh local development DCs for exactly three individual
`read_file` permissions; each role is given only its own selected path.
Six real protected A2A tasks run (per role: an authorized read then a
foreign/out-of-scope read), which **must all terminate FAILED without an
Artifact** because there is deliberately no write or confirmed commit.
This tests role/task isolation, policy denials, inactive task tokens and
private evidence not entering ADK model requests or public A2A Task state.

Expected success event:
`a2a_three_roles_shared_mcp_real_read_smoke` with `status:"PASS"`.

**Scope:** this is NOT the full Backend→Frontend→Test write/create/run_tests
flow, and does not produce a PR or merge. It is a separate no-write gate before
testing the stateful multi-agent pipeline against isolated Gitea.

## Stateful three-role A2A smoke with genuine isolated Gitea writes

This separate *opt-in* smoke exercises genuine Backend and Frontend
`read_file` + `update_file` operations, then Test Agent `create_file`,
followed by a deliberately failing `run_tests` gate, all over the **same
shared MCP server** using independent real protected A2A servers.

A SECOND disposable Gitea is used, with NO persistent volumes or host bind
mounts. The real Gateway runs only on a random loopback port with real local
Rust Adapter and OPA; the existing read-only Gateway and persistent Gitea
remain unchanged. The two application-file updates and one E2E file creation
produce three distinct Gitea feature-branch commit SHAs. The isolated
`main` branch stays protected.

**The Controlled Test Runner here is an authenticated HTTP STUB** that
intentionally reports FAIL, with the exact real final Gitea SHA. It is NOT
an actual Docker test run, and researcher acceptance is NOT a pass.
The separate `adk:mcp:isolated-real-runner-smoke` already exercised real
Docker failure handling. The Test Agent must terminate FAILED with no
Artifact; there must be no Pull Request and no merge.

Prerequisites: Docker Desktop, live local Rust Adapter and OPA, dev .env.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc/packages/agent-runtime run a2a:mcp:isolated-sequential-write-smoke
```

A successful smoke event is
`a2a_shared_mcp_isolated_sequential_write_smoke` with `status:"PASS"`.
This does NOT exercise the production SequentialCoordinator itself, the
positive test/acceptance gate, PR creation or human-approved merge. Those
need separate validation.

## Production SequentialCoordinator integration with shared MCP (fail-closed)

This opt-in test runs the **actual** `AccountSuspensionSequentialCoordinator`
with `SoftwareEngineerAuthorityBootstrap`,
`OrchestratorProtectedGatewayClient`,
`DeterministicOrchestratorAuthorityIssuer`,
`DelegatedA2ARoleRunner`, and `DeterministicA2AOrchestrator`.
The role runner is wrapped only to assign unique development DC IDs
and verify Gitea commits after each successful role. These are the
production coordination and authority classes, not a handwritten
substitute for the workflow.

The Coordinator creates `feature/account-suspension` itself through
real Gateway / Rust / OPA against a **SECOND disposable Gitea**.
Backend and Frontend then update files over A2A -> native ADK -> ONE
shared MCP -> real Gateway, and Test creates its E2E file.
The **authenticated HTTP Runner is a deliberately FAILING stub**, so
the real Test Agent must not produce a successful Artifact and
the Coordinator must abort **before** any PR. Isolated `main` must stay
unchanged. The Gateway instance and Gitea used for earlier PoC tests
are never selected; no PR/merge operation is sent.

Run with local Rust Adapter, OPA and Docker Desktop active; no Gemini,
no real Runner Docker job, no persistent repository writes:

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc/packages/agent-runtime run a2a:mcp:production-coordinator-smoke
```

Expected success event:
`a2a_production_coordinator_mcp_isolated_fail_closed` with `status:"PASS"`.
This only validates the **negative Coordinator gate**. A full
passing researcher acceptance, PR creation and explicit human-approved
merge remain separate work.

## Positive production Coordinator gate with real isolated PR (stubbed PASS only)

This optional integration covers the OTHER side of the coordinator's gate.
Three native ADK A2A Agents use ONE shared MCP to commit real controlled
Backend, Frontend and Test files to a **disposable Gitea**. The real
`AccountSuspensionSequentialCoordinator`, root/child DC issuance,
Gateway+Rust+OPA, and `OrchestratorProtectedGatewayClient` are exercised.

**Crucial limitation:** the internal, Gateway-authenticated Controlled Runner
HTTP endpoint returns a deliberately **FAKE PASS** with matching real feature
Git SHA, `project_tests:pass`, and `researcher_acceptance:pass`.
NO actual tests or researcher-owned acceptance execute in this smoke.
This is only a control-flow integration test, not proof of real test quality.

Given the simulated PASS the Coordinator must create exactly ONE real,
OPEN Gitea pull request on the disposable repo through protected Gateway
authorization. It must NOT merge or issue approvals. The script checks
that the PR head matches the tested SHA, has no human reviews, remains
`merged:false`, and that `main` is unchanged. Both the PR and entire
repository are automatically destroyed when the temporary Gitea exits.

```bash
cd ~/Documents/GitHub/delegation
set -a
source poc/infra/.env
set +a
npm --prefix poc/packages/agent-runtime run a2a:mcp:production-pr-open-smoke
```

Expected smoke event: `a2a_production_coordinator_mcp_isolated_pr_open`
with `status:"PASS"`, `runner:"controlled_http_stub_simulated_pass_only"`
and `coordinator_result:"PR_CREATED_PENDING_HUMAN_APPROVAL"`.

This is NOT validation of real researcher acceptance or a revision-bound
human merge approval security pipeline; those require separate tests.

## Revision-bound human approval + trusted security status (read-only gate)

`GiteaMergeReadinessVerifier` is a **read-only** prerequisite for a future
Orchestrator merge workflow. It does **not** implement or authorize a merge,
create a review, or post a status. It checks all of the following against
Gitea's current repository state:

- Exact target PR number, controlled same-repo feature -> main branch,
  PR still open/unmerged/mergeable, exact expected HEAD SHA, and current
  base SHA.
- Enforced main protection (no direct/force push, required approvals,
  stale-approval dismissal, outdated-branch blocking and no admin override).
- Latest review from a specifically configured HUMAN Gitea account
  (immutable numeric ID **and** login) must be `APPROVED` on exact HEAD SHA.
  A prior approval invalidated by a later review is not sufficient.
- Newest Gitea commit status for fixed context
  `thesis/security-pipeline` must be `success`, created by a distinct,
  specifically configured trusted CI account. Earlier green statuses do
  not override a later pending/failing status. Both identities are validated
  from the fetched Gitea records, never model arguments.
- The PR head/base is rechecked before returning a readiness observation.
  The eventual merge endpoint MUST recheck all evidence atomically where
  possible and enforce an exact-SHA precondition (TOCTOU protection).

If any required evidence is missing or malformed, it fails closed. In
particular, the **simulated PASS** of the preceding isolated PR smoke
provides NO trusted CI status and NO human approval and therefore must
NOT be treated as merge permission.

This module is preliminary. **There is not yet a live security CI pipeline
publishing this context, no approved human review in the disposable smoke,
and no Orchestrator merge operation.** A reviewer username/ID is only as
human-trustworthy as the Gitea organization identity policy that manages it.
Future pipeline work must actually run trusted acceptance and security checks
on the exact SHA before its CI account may publish a success status.

Offline tests (no Gemini, no Gitea mutations):

```bash
npm --prefix poc run test -w @thesis/orchestrator-runtime
```

## Live Gitea merge-readiness negative check (isolated PR)

The existing `a2a:mcp:production-pr-open-smoke` now additionally queries
the temporary real Gitea PR through `GiteaMergeReadinessVerifier`.
It creates three separate synthetic accounts **inside that disposable
Gitea only**: a read-only auditor, a placeholder reviewer and a placeholder
CI identity. No actor creates a human review or publishes a CI status.

A fake Runner PASS is never sufficient to pass this independent gate.
The test requires `merge_readiness:"DENIED"` and confirms the absence of
a real `thesis/security-pipeline` status. The precise early rejection reason
from live Gitea is surfaced as `merge_readiness_denial` (e.g.
`human_approval_missing`, `pr_not_mergeable`, or
`branch_protection_insufficient`). The pipeline and human approval
remain genuinely absent: the synthetic actors are NOT evidence.

This is a negative integration exercise with real protected branch state;
the positive ready path still requires actual independently trusted
human/CI identities and a genuine security pipeline on an exact Git SHA.
