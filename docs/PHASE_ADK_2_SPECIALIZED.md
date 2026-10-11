# Phase 2 — ADK Specialized Agent Factory (2026-10-09)

Status: specialized ADK factory implemented and validated by a keyless
Google ADK `Runner` test suite; **A2A remains connected to the original
controller until Phase 3**.

## New runtime pieces

- `poc/packages/agent-runtime/src/adk-specialized-agents.ts` contains
  `createAdkSpecializedAgent()`, which instantiates real Google ADK `LlmAgent`
  instances for the existing `backend`, `frontend`, and `test` roles.
- Source of the file-scoped prompt and role-tool mapping remains
  `SPECIALIZED_AGENT_PROFILES` (unmodified).
- ADK tools are `FunctionTool` instances with strict Zod argument schemas,
  wrapping the previously tested `ControlledToolRegistry.execute()`.
- The registry delegates to `GatewayControlledToolClient.invoke()`: Gateway
  still derives the canonical permission, verifies the Rust delegated evidence
  via Adapter, queries OPA, and alone invokes Gitea or the Controlled Runner.
- `DelegationEvidenceHandler` and its service tokens are private to the Gateway
  wrapper, not part of ADK prompt, tool schemas, messages, or session state.

## Defense in depth

1. ADK tool exposure is constrained by role profile; unauthorized tool names
   are not registered.
2. Tool schemas reject unexpected keys, malformed branch and incorrect test
   profile before Gateway invocation.
3. Registry/Gateway remain authoritative about resource scope and permission.
   For example, an otherwise valid `update_file` targeting `security/`
   must still be denied server-side.
4. A controlled `authorization_denied` result is returned to the model as
   `ok:false`, not treated as a successful file operation.
5. Unexpected tool implementation errors return a sanitized failure response,
   not raw provider messages or secrets.

## Reproducibility / scope

- `@google/adk` is fixed at 2.2.1 in the `agent-runtime` workspace.
- `zod` is pinned at 4.2.1.
- `poc/package-lock.json` records the resulting full dependency tree.
- The official A2A v1.0 contract remains on its existing dependency line.
- The Phase 2 smoke uses `BaseLlm` scripted responses to drive actual ADK
  `Runner` events and `FunctionTool` callbacks **without an external model**.
- Production OpenAI Responses-to-ADK model adaptation, A2A executor routing,
  session lifecycle, iteration bounds, event/audit parity, and full Gitea E2E
  remain Phase 3/4/5 responsibilities. This checkpoint alone is **not**
  an end-to-end completed migration.

## Commands

```sh
npm --prefix poc ci --ignore-scripts --no-audit --no-fund
npm --prefix poc run agent-runtime:test
npm --prefix poc run orchestrator-runtime:test
```

CI: `.github/workflows/adk-phase2-smoke.yml`.

## Security policy

Do not remove the custom controller until the replacement has passed
full A2A/E2E and negative authorization experiments. Do not allow ADK agents
direct Gitea, arbitrary shell, raw permission selection, private keys,
JWT/VP payloads or unsanitized Delegation Evidence.
