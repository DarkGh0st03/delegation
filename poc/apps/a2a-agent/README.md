# Optional standalone A2A agent launcher

`src/main.ts` is an independent CLI that can start a single `backend`, `frontend` or `test` agent via `@thesis/agent-runtime`, with Express Agent Card, `/a2a/rest`, and (if configured) the private MCP Worker endpoint.

This is **not** the entrypoint used in the successful live three-role experiment: the canonical program starts its three A2A servers in-process using `startSpecializedAgentServer`:
`poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`.

## Optional standalone configuration

- `AGENT_ROLE=backend|frontend|test`, `AGENT_PORT`.
- `AGENT_RUNTIME_ENGINE=adk` and `ADK_MODEL_PROVIDER=gemini` with the provider credential for real Gemini.
- Trusted `GATEWAY_URL`, `DELEGATION_ADAPTER_URL` and caller token.
- Optional model-facing legacy MCP: `ADK_MCP_SHARED_URL`, with its legacy read/write/test tool profile.
- Optional **private cryptographic MCP**: `ADK_MCP_CRYPTO_URL`, pointing to a separately running `MCP_TOOL_PROFILE=crypto` server. Its `delegation_create_presentation` tool is invoked by trusted runtime code only, not placed in the model's FunctionTool list.
- Either MCP mode requires trusted `MCP_TASK_SIGNING_PRIVATE_KEY` / `MCP_TASK_SIGNING_PUBLIC_KEY` and configured role public keys/worker URLs on the MCP listener. Write/test tool opt-ins are validated by `src/mcp-tool-flags.ts` and still require the legacy MCP endpoint.

If MCP is not configured, this standalone launcher may use local ADK FunctionTools depending on its settings; **do not confuse that with the current canonical shared-MCP experiment**.

```bash
npm --prefix poc run test -w @thesis/a2a-agent
```

Never copy private DC, Gitea credentials or Task signing keys into the model-visible request.

The crypto-only integration currently has an offline SDK + Gateway-positive
and outage/denial regression suite, but it is not enabled in the historical
paid Gemini E2E and does not authenticate a genuine Engineer-approved plan.
The Gateway's independent DC/VP verification and OPA policy remain mandatory.
Never expose a crypto-only MCP listener as a model-facing toolset.
