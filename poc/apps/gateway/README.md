# Cloud Access Gateway — current PoC

This Node.js service is the **Policy Enforcement Point (PEP)** for protected operations on the thesis IAM Console repository. It does not trust model-selected permissions.

## Runtime flow

1. The private Worker or Orchestrator calls `POST /v1/authorization/prepare` with a validated tool name/argument set.
2. `src/canonical.ts` derives the exact `ResourceUri + Operation`; `src/prepare.ts` binds a `request_id`, challenge, audience, required permission, role, task and input to a short-lived prepared request.
3. The *trusted private caller* obtains a signed VP using the Rust Delegation Adapter. Gemini does not receive the DC, keys or Adapter token.
4. `POST /v1/authorization/execute` consumes the prepared request, sends the VP to the Rust verifier and requires a valid delegated authorization.
5. `src/policy-client.ts` asks the **OPA Policy Engine** for a separate contextual allow/deny decision.
6. Only on success may `src/gitea-executor.ts`/`src/gitea-read-executor.ts` access protected Gitea, or `src/runner-client.ts` call the Controlled Docker Runner.

A denied/expired/replayed request or unavailable verifier/policy fails closed. Protected provider credentials exist only in trusted service configuration.

## Rust Operation catalog — refactoring stage 3

The **authoritative catalog** is the Rust `Operation` enum in
`src/delegation/authorization/operation.rs` (currently 31 operations).
`src/operation-catalog.ts` is a **generated mirror**, not a separate
permission model. Regenerate and check it with:

```sh
node poc/scripts/sync-rust-operation-catalog.mjs --write
node poc/scripts/sync-rust-operation-catalog.mjs --check
```

The prepare endpoint has three explicitly distinct outcomes:

- **400 `unknown_operation`**: the requested operation is absent from
  the Rust enum.
- **501 `provider_operation_unavailable`**: the operation exists in Rust,
  but the current Gateway has no normalized tool schema/provider adapter.
  This fails *before* creating any prepared request/challenge and does not
  claim an authorization decision.
- The six currently normalized operations proceed through the existing
  prepare, VP verification, OPA and provider flow. They can still be
  denied with 403 or return a provider-specific 501.

Recognizing an enum variant **does not grant authority**. Catalog
synchronization does not implement additional provider tools or permit
`merge_pull_request`, deletes, or writes to `main`. The later roadmap
will add multi-permission checks and local Rust verification in the Gateway
independently. The historical Adapter-backed verification path remains
unchanged during this increment.

The dedicated `Gateway Rust Operation Catalog (Offline)` GitHub Actions
workflow runs the synchronization check and existing Gateway unit tests
without invoking Gemini.

## Stage 5 — Atomic multipermission verification (authorization-only)

Two additional **non-executing** Gateway routes are available for checking
several distinct tool permissions before a proposed workflow is executed:

- `POST /v1/authorization/prepare-composite`: send a common `task_id`,
  `agent_role` and 2–12 `actions` (`tool` + `arguments` each).
  The Gateway normalizes each action and derives its canonical permission;
  client-selected permissions and duplicate permissions are rejected.
  Returns `request_id`, `audience`, one-time `challenge`,
  `required_permissions`, `expires_at`, and `authorization_only:true`.
- The trusted caller obtains one signed VP disclosing **all** required
  permissions, then calls `POST /v1/authorization/verify-composite` with
  `request_id` and `signed_vp`. The Gateway calls the authenticated
  Adapter endpoint `/v1/verify-multiple` and evaluates the existing OPA
  policy for **each** normalized action before returning allow.

One invalid, undisclosed, expired, or policy-denied permission means
**the entire request is denied**. Challenge bindings are single-use,
with replay and expiry protection. Audit events record pending/allowed/
denied outcomes, always with `provider_result:"not_called"`.

A successful result is a **verification observation**, not permission
to execute later without a new trusted check. Neither of these routes
invokes Gitea, Docker Runner or the existing `ExecutionPort`. The
original `/v1/authorization/prepare` and `/execute` endpoints
remain unchanged. We do not implement a multi-write batch or advertise
atomic commits: independent Gitea writes cannot be rolled back
automatically without a deliberate transaction/compensation design.

Example (read and update same file require distinct permissions):

```json
{
  "task_id": "backend-task",
  "agent_role": "backend",
  "actions": [
    {
      "tool": "read_file",
      "arguments": {
        "branch": "feature/demo",
        "path": "apps/backend/src/app.ts"
      }
    },
    {
      "tool": "update_file",
      "arguments": {
        "branch": "feature/demo",
        "path": "apps/backend/src/app.ts",
        "content": "updated"
      }
    }
  ]
}
```

This is the incremental bridge toward a trusted plan-conformance gate.
It does **not** by itself bind the request to a signed human-approved
plan: that integration remains a separate requirement and is never
delegated to prompts or ADK callbacks.

## Stage 8C — Native Rust Core verifier (experimental, opt-in)

A new `services/delegation-core-node` crate provides a compiled native
**Node-API** addon (no TypeScript verification shortcuts). Its async
worker task invokes the existing `DelegationVerifier<Bn254>`, with the
standard `EvmTrustResolver`, `EvmAnchoredStatusListResolver`, the
`FilePublicArtifactStore` mounted read-only, and a DID-ethr
assertion key resolver. No issuer/governance signing keys are required.

`GATEWAY_VERIFIER_MODE=core-rust` now requires an actual trusted addon
at `poc/apps/gateway/src/native/delegation-core.node`; startup calls
its `assert_verification_ready` entrypoint and refuses to accept
traffic when required EVM trust sources are not available. If no addon
is installed, startup still fails closed. No fallback to Adapter exists.

The new native crate README documents build steps and seven
`CORE_RUST_*` environment inputs. The optional directory-based
public artifact store was implemented in Stage 8B. This does **not**
alter the default `adapter` mode or the permission/OPA policy model.

**Verified in real local EVM integration:** the offline unit CI
[Native Gateway to Core Rust #39575348140](https://github.com/DarkGh0st03/delegation/actions/runs/39575348140)
built and loaded the native addon. The real Anvil test
[Native Core Rust EVM #39576496255](https://github.com/DarkGh0st03/delegation/actions/runs/39576496255)
issued a root DC in the EVM Adapter, created a signed VP, verified it
**directly in the native Gateway** against current on-chain accumulator,
DID and status evidence, received an OPA allow, and rejected replay,
wrong challenge and later on-chain revocation.

The provider was intentionally `mock`: the successful authorization
did **not** mutate Gitea or run Docker. The default remains `adapter`
until full workflow compatibility, plan-level enforcement, runtime
timeouts and concurrency limits have been separately validated. A
positive crypto E2E is not a full Gemini/A2A/approval E2E.

## Stage 8A — Historical TypeScript contract stage

Stage 8A introduced the explicit `adapter` (default) versus
`core-rust` selection and the TypeScript `DirectCoreRustVerifier`
boundary. That stage alone was only mock-binding tested and could not
run the native mode. **Stages 8B and 8C completed the separate public
artifact source, real native addon and real Anvil verification above.**

Both verification modes require correct Core Rust proof validation;
neither bypasses Gateway authorization contexts or OPA. Selecting
`core-rust` without its real addon, correct chain or existing public
artifacts fails at startup rather than falling back to Adapter.

## Stage 6 — Read-only repository exploration

The Rust `Operation` catalog already includes `read_repository` and
`list_directory`. The Gateway now implements both tools using the same
`prepare → signed VP → Core Rust verification → OPA → Gitea` path as
`read_file`. No separate unprotected browsing API has been introduced.

### Tool arguments and canonical permissions

| Tool | Arguments | Required permission |
|---|---|---|
| `read_repository` | `{}` | `read_repository` at `gitea://gitea.local/thesis/iam-console-poc` |
| `list_directory` | `{"branch":"main","path":""}` for root; optional `path` for a nested directory | `list_directory` at `gitea://gitea.local/thesis/iam-console-poc/branches/main/directories[/path]` |
| `read_file` | `{"branch":"main","path":"src/file.ts"}` | `read_file` at the canonical per-file URI |

The normalizer rejects relative traversal (`..`), absolute paths and
unexpected caller-supplied permission fields. Every tool call gets a
dedicated one-time challenge, and its permission is derived by the
Gateway, not by Gemini. The caller must possess a legitimate DC/VP
whose disclosed permission matches the specific target URI and operation.

### Planning permissions and provider boundaries

OPA `phase6-ro-v1` permits the **Orchestrator** to read repository
metadata, list directories and read files from `main` **only** when
a separately verified credential grants those operations. The existing
feature-branch tool policy remains active; **writes to `main` remain
denied**, including requests by the Orchestrator.

The Gitea client validates its configured repository identity, resolves
the branch's current commit SHA, then performs directory/file reads
against that **pinned commit**, avoiding moving-branch read races.
Directory results contain only names, types, paths and optional file
sizes (max 200 immediate children). Unsupported entry types and
inconsistent returned paths fail closed. Neither directory traversal
nor metadata reads invoke the Test Runner or Gitea mutation endpoints.

The `gitea-readonly` mode now supports all three discovery tools and
still rejects every mutation independently of OPA. The standard Gitea
provider also supports these reads. The `mock` provider retains its
existing no-side-effects behavior.

### Scope still pending

This stage **does not issue preliminary read-only DCs**, expose the
discovery tools through the new cryptographic MCP service, implement
the Gemini Planning loop, authenticate a human plan approval, or bind
execution to an approved plan version. Those integrations follow in
their assigned roadmap stages. No vector database or RAG index is used.

Run the offline checks with:

```sh
npm --prefix poc run gateway:test
bash poc/scripts/phase4a-policy-test.sh
```

The branch's Gateway CI runs both suites and the Rust catalog drift
check without calling Gemini.

## Supported operations

- Shared MCP agents: `read_file`, `update_file`, `create_file`, `run_tests` (according to their DC and OPA rights).
- Planning reads through Gateway: `read_repository`, `list_directory`, and explicitly delegated `read_file` access to `main`.
- Orchestrator operational tools directly via Gateway: `create_branch`, `create_pull_request`.
- Automated writes to `main` and model-controlled merges are not supported.

The Gateway is **not** an MCP server and does not replace the Rust Delegation Adapter. Historical real-Gemini evidence includes [13 October run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) and the later [15 October run 38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) at framework SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673`. Neither run attests the subsequently audited `main` commits.

## Start / verify

```bash
npm --prefix poc run gateway:test
npm --prefix poc run gateway:start
```

`src/config.ts` defaults to `mock` provider mode for standalone use. A real Gitea provider requires explicit `GATEWAY_PROVIDER_MODE` and trusted Adapter, OPA and Gitea credentials; the Runner is configured for controlled `run_tests`. See `src/config.ts` for supported environment variables and `src/runtime.ts` for runtime wiring.
