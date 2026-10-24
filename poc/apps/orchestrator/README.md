# Trusted Engineer and Orchestrator host

This application is the **trusted Engineer-side bootstrap**, not the
model, the three A2A agents, or a second orchestration engine.

**Canonical thesis path (R0–R6):**
1. The trusted Planner performs repository discovery against a pinned
   revision using a read-only preliminary delegation.
2. The Software Engineer reviews and signs an immutable plan/permission
   set with Ed25519; a GitHub Actions OIDC identity is **not** approval.
3. The trusted Coordinator revokes the preliminary root and creates a
   distinct operational delegation for the exact approved plan.
4. `TrustedApprovedA2ADispatcher` executes only approved DAG tasks via
   the three specialist ADK/A2A agents and the shared MCP Server.
5. The Gateway, OPA and native Rust verification independently enforce
   delegation and provider operations. Gitea/Docker Runner outcomes and
   the tested branch SHA gate Pull Request creation.
6. A shutdown blocks new tasks immediately and must await Gateway
   closure and Rust root revocation; uncertain revocation requires
   manual reconciliation.

The canonical runtime is implemented primarily in
[`poc/packages/orchestrator-runtime/src`](../../packages/orchestrator-runtime/src),
[`poc/apps/gateway/src`](../gateway/src) and
[`poc/packages/agent-runtime/src`](../../packages/agent-runtime/src).
The application here owns Engineer UI, private OIDC intake, trusted
handoff lifetime and the local service bootstrap.

## Operative entrypoints

| File | Purpose | Security boundary |
| --- | --- | --- |
| `src/engineer-approval-server.mjs` | Local Engineer review and signed receipt | Loopback UI, authenticated independent Engineer; never an ADK tool |
| `src/trusted-engineer-host.mjs` | Engineer review host with GitHub OIDC/mTLS intake | Only OIDC listener may bind an explicitly configured RFC1918 interface |
| `src/start-trusted-engineer-service.mjs` | Operator-owned service launcher | Protected local config/PEM files; actual host deployment is external |
| `src/trusted-reviewed-handoff-lifecycle.mjs` | One-shot Execution lifetime and shutdown | Failure to confirm closure remains fail-closed |
| `src/submit-private-github-oidc.mjs` | Private self-hosted runner admission client | Authenticates GitHub job only; no Engineer signature or model key |
| `src/validate-trusted-gemini-dispatch.mjs` | Manual input validation | Input preflight does not make an execution R5-ready |

**Operator-only service command (Node 22):**

```sh
# Run from repository root. Requires a real, owner-protected local config.
DELEGATION_ENGINEER_SERVICE_CONFIG=/absolute/operator-owned/config.json \
  npm --prefix poc/apps/orchestrator run engineer:service
```

This is **not an automatically provisioned deployment**: the operator
must separately configure the IPC-connected Gateway, Rust Adapter,
pinned private network, isolated runner, certificates, independent
Engineer session and a process supervisor. Do not place client key
material in workflow_dispatch inputs, repository files or model context.

For offline checks (no Gemini charge):

```sh
npm --prefix poc run orchestrator-runtime:test
node --experimental-strip-types --test \
  poc/apps/orchestrator/test/trusted-engineer-host.test.mjs \
  poc/apps/orchestrator/test/trusted-engineer-service.test.mjs
npm --prefix poc run audit:r6:references
```

These commands test implementations or inspect sources, but **cannot**
prove a remote two-host deployment or real paid inference.

## Historical paths — NOT the canonical workflow

`src/bootstrap-engineer.ts` and its
`npm --prefix poc run orchestrator:bootstrap` script implement the
**historical IAM Console template-root experiment**. Do not use it to
start the new signed Planning/Execution sequence.

Likewise, the older
[`sequential-coordinator.ts`](../../packages/orchestrator-runtime/src/sequential-coordinator.ts)
and the historical
[`a2a-production-coordinator-mcp-gemini-live.mjs`](../../packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs)
were used to validate the previous Account Suspension scenario.
That coordinator is deliberately **not exported** from the current
Orchestrator runtime barrel. These historical scripts and their
workflow remain reference evidence; **the old paid workflow is not
an R5-approved Gemini entrypoint**.

A genuine R5 paid validation is still **NO-GO** until the private
Engineer/runner deployment is configured, consent is independently
authenticated and the real Gemini driver is bound to the same signed
approved plan. Never invoke a paid provider from offline CI and never
treat a synthetic Engineer receipt as real human approval.

## Canonical documentation

- [Current canonical route and legacy inventory](../../docs/R0_Canonical_Route_Legacy_Inventory_2026-10-23.md)
- [R4 security gate and R5 NO-GO criteria](../../docs/R4_Security_Gate_and_R5_Readiness_2026-10-23.md)
- [Trusted manual admission, private runner and recovery](../../docs/trusted-gemini-manual-dispatch.md)
- [R6 conservative cleanup and historical-caller evidence](../../docs/R6_Legacy_Reference_Baseline_2026-10-24.md)

**Documentation cleanup note:** The earlier chronological Stage 9–12
implementation diary in this README was superseded by these focused
handoff files and remains recoverable in Git history at commit
`05c0859ff20c8e3496b98cb5542506a98f261521`. Historical test results are not reattributed to the
current signed architecture. Do not merge this branch into `main`
without explicit project review.
