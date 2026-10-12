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
