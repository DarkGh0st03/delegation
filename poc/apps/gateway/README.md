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

## Supported operations

- Shared MCP agents: `read_file`, `update_file`, `create_file`, `run_tests` (according to their DC and OPA rights).
- Orchestrator directly via Gateway: `create_branch`, `create_pull_request`.
- Automated writes to `main` and model-controlled merges are not supported.

The Gateway is **not** an MCP server and does not replace the Rust Delegation Adapter. Historical real-Gemini evidence includes [13 October run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) and the later [15 October run 38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) at framework SHA `02c3395b9111a63ccc9f441ea2c91c81865d6673`. Neither run attests the subsequently audited `main` commits.

## Start / verify

```bash
npm --prefix poc run gateway:test
npm --prefix poc run gateway:start
```

`src/config.ts` defaults to `mock` provider mode for standalone use. A real Gitea provider requires explicit `GATEWAY_PROVIDER_MODE` and trusted Adapter, OPA and Gitea credentials; the Runner is configured for controlled `run_tests`. See `src/config.ts` for supported environment variables and `src/runtime.ts` for runtime wiring.
