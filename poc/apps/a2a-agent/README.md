# Optional standalone A2A agent launcher

`src/main.ts` is an independent CLI that can start a single `backend`, `frontend` or `test` agent via `@thesis/agent-runtime`, with Express Agent Card, `/a2a/rest`, and (if configured) the private MCP Worker endpoint.

This is **not** the entrypoint used in the successful live three-role experiment: the canonical program starts its three A2A servers in-process using `startSpecializedAgentServer`:
`poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`.

## Optional standalone configuration

- `AGENT_ROLE=backend|frontend|test`, `AGENT_PORT`.
- `AGENT_RUNTIME_ENGINE=adk` and `ADK_MODEL_PROVIDER=gemini` with the provider credential for real Gemini.
- Trusted `GATEWAY_URL`, `DELEGATION_ADAPTER_URL` and caller token.
- Optional shared MCP: `ADK_MCP_SHARED_URL`, trusted `MCP_TASK_SIGNING_PRIVATE_KEY` / `MCP_TASK_SIGNING_PUBLIC_KEY`, plus per-tool opt-ins as validated by `src/mcp-tool-flags.ts`.

If MCP is not configured, this standalone launcher may use local ADK FunctionTools depending on its settings; **do not confuse that with the current canonical shared-MCP experiment**.

```bash
npm --prefix poc run test -w @thesis/a2a-agent
```

Never copy private DC, Gitea credentials or Task signing keys into the model-visible request.
