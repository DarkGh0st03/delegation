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

## Supported operations

- Shared MCP agents: `read_file`, `update_file`, `create_file`, `run_tests` (according to their DC and OPA rights).
- Orchestrator directly via Gateway: `create_branch`, `create_pull_request`.
- Automated writes to `main` and model-controlled merges are not supported.

The final live reference is [run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436). The Gateway is **not** an MCP server and does not replace the Rust Delegation Adapter.

## Start / verify

```bash
npm --prefix poc run gateway:test
npm --prefix poc run gateway:start
```

The start command requires trusted Adapter, OPA and Gitea/Runner configuration. See `src/config.ts` for supported environment variables and `src/runtime.ts` for runtime wiring.
