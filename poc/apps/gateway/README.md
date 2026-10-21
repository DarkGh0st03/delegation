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

## Stage 8A — Direct Core Rust verification boundary (not yet activated)

The Gateway now has an explicit `GATEWAY_VERIFIER_MODE` selection:

- `adapter` (default): existing **verified baseline**. Gateway sends VP
  to authenticated Rust Delegation Adapter, which calls the Rust Core.
  The Adapter URL and Gateway caller token are mandatory in this mode.
- `core-rust` (future native): Gateway will call the Rust Core
  `Verifier::verify_verifiable_presentation` **in-process**, via a fixed
  native Node addon, without contacting the issuing Adapter. This mode
  deliberately fails at startup until the trusted addon and required
  independent verification-data providers are built. There is **no**
  fallback from `core-rust` to the Adapter.

The new `DirectCoreRustVerifier` is only the **typed boundary**: it
serializes the original Rust `AuthorizationContext` (singleton
`required_permission` or plural `required_permissions`), resolves
presenter DIDs from trusted runtime configuration, rejects malformed
and duplicate requirements, then requires consistent
`VerifiedDelegation` output. Its TypeScript code does **not**
validate cryptography, trust anchors or credential status.

**Required before activating native mode:**

1. Implement and compile the actual in-process Rust addon, directly
   linked to the repository's `delegation` Core Rust crate. Its
   `verify_verifiable_presentation(context_json, signed_vp)` API must
   invoke `DelegationVerifier`, not a handwritten shortcut.
2. Remove the current verifier's process-local dependency on issuer
   `InMemoryTrustStore` accumulator material and
   `InMemoryStatusListStore` status artifacts. Publish **public-only**
   verification materials to authenticated durable/discoverable stores
   and validate their anchor commitments/versions against the EVM
   registry. Never copy private signing keys into the Gateway.
3. Define verifier initialization, trust-anchor/resolver refresh,
   revocation/suspension freshness, error handling and concurrency
   for an independently deployed Gateway. The current Rust code
   contains `Rc`-based resolver state, so a naive shared async addon
   would require special consideration.
4. Exercise native mode against signed VPs and real EVM/OPA/Status List
   evidence, including status changes, missing material, wrong
   presenter/audience/challenge, partial disclosure and replay. This
   must occur **before** any release switches the default to native.

The new offline unit tests use a **mock implementation of the native
function** to verify Gateway contract, serialization, rejection and
OPA ordering. They **do not** prove that the missing native addon
performs real cryptographic verification. Production use of
`core-rust` is blocked, not silently simulated.

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
