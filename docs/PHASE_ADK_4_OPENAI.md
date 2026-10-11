# Phase 4 — OpenAI Responses to Google ADK Bridge (2026-10-09)

Status: native OpenAI Responses `BaseLlm` and opt-in ADK agent-process startup
implemented; deterministic tests use an injected OpenAI client, not paid API
calls. Live provider key and full Gitea end-to-end validation remain outstanding.

## How the model is connected

- `OpenAIAdkModel` implements Google's ADK `BaseLlm` interface.
- The existing `openai@7.17.0` SDK performs Responses API calls.
- The default model name is unchanged from the original PoC:
  `gpt-5.6-sol`, unless `OPENAI_MODEL` is set. Availability of this model
  at the actual provider/account must be verified during live E2E.
- ADK `LlmRequest` system instructions, text content, function calls, and
  function responses are translated to OpenAI Responses request items.
- Function call IDs and tool output are preserved across turns. The bridge
  reconstructs history from ADK session data and does not rely on shared
  provider `previous_response_id` state.
- The provider-reported model is forwarded as ADK `modelVersion`.
- `parallel_tool_calls:false`; all tools have strict schemas and are limited
  to the existing `read_file`, `update_file`, `create_file`, `run_tests`
  whitelist. Unknown schema keywords, arbitrary remote/built-in tools,
  images and malformed arguments fail closed.

## Runtime mode switch

The existing `poc/apps/a2a-agent/src/main.ts` now supports explicit:

```sh
AGENT_RUNTIME_ENGINE=adk
AGENT_ROLE=backend        # or frontend / test
AGENT_PORT=43171
OPENAI_API_KEY=...        # never commit or log this value
OPENAI_MODEL=gpt-5.6-sol  # optional: existing baseline name
GATEWAY_URL=http://127.0.0.1:8080
DELEGATION_ADAPTER_URL=http://127.0.0.1:8090
ADAPTER_CALLER_BACKEND=...  # role-specific service token
ADK_MAX_MODEL_TURNS=8      # optional, max 100
```

Provide `ADAPTER_CALLER_FRONTEND` or `ADAPTER_CALLER_TEST` for those roles.
Service identities and tokens must be provisioned outside model history.

If `AGENT_RUNTIME_ENGINE` is unset, the old deterministic bootstrap remains
unchanged. Unknown engine names or missing ADK credentials are refused at
startup, rather than downgrading silently. The process never gives the model
unrestricted shell, Git provider tokens, private VP signing keys or direct
Rust Adapter access.

## Testing and limitations

- Existing Phase 2/3 Gateway-controlled and protected A2A suites still run.
- Phase 4 tests exercise the actual Google ADK Runner over an injected
  Responses API mock, verifying function declarations, ID roundtrips and
  absence of delegation secrets in provider input.
- Negative tests reject unsupported remote tools, provider parse failures,
  unknown engine names and missing provider keys.
- An actual OpenAI provider request and fully networked Gitea/OPA/Adapter
  Account Suspension E2E have **not** been executed in this phase.
- Keep `main` frozen until real regression, model availability, orchestration
  and measurements are successful.

CI: `.github/workflows/adk-phase4-smoke.yml`.
