# Active ADK/A2A/shared-MCP thesis workspace

This is the current TypeScript/Node integration layer. The [root README](../README.md) is the main architecture map.

- `packages/orchestrator-runtime/`: deterministic Coordinator, DC permissions and human gate.
- `packages/agent-runtime/`: A2A/Google ADK/Gemini server, private credential evidence and MCP Worker.
- `mcp-shared/`: one shared MCP server, catalogue and TaskRouter.
- `apps/gateway/`: permission canonicalization, Rust verification, OPA and controlled provider operations.
- `apps/test-runner-controller/`: exact-SHA Docker execution and independent CI.
- `infra/`, `opa/`, `runner/acceptance/`: local dependencies, policy and researcher-owned acceptance.
- `scripts/`: initialization, current security-negative experiments and pinned reproducibility.

Canonical live entrypoint: `packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`. It **requires a new manual billing decision**. Regular regressions are offline and do not call Gemini APIs.

For a quick workspace check: `npm --prefix poc run check:scaffold`.
