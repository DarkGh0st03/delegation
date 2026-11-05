# R312 — canonical HTTP prepare + execute on Test Agent native proof

## Difference from R311

R311 proved the signed Test Agent execution over the real owner-assembled
Gateway HTTP listener after a fixture-only in-process prepare. R312
moves BOTH /v1/authorization/prepare and /v1/authorization/execute
for the Test Task to the SAME canonical owner HTTP host and request
store. The owner constructs the Runner and private reserved-effect
journal before starting the listener, but only stages the specific
Test request AFTER HTTP prepare has returned a real challenge.

## Invariants

- Permission-only Engineer authority is unchanged; native Root and
  independent Child DC/VP verification, EVM status, real OPA and Gitea
  HEAD pinning stay mandatory.
- The `run_tests` HTTP payload is only the runtime Task ID, Test
  role, approved feature branch and `poc-default` profile.
- The trusted owner retrieves the SAME PreparedRequestRecord from
  the private store, reserves the exact immutable Test intent, and
  verifies the pinned Frontend SHA before the one-shot Runner POST.
- The signed VP is created through the private native Rust interface
  and submitted to /execute, with no exposed owner enrollment route.
- A finally block closes the HTTP listener even on earlier prepare
  or preflight failure; no retry after ambiguous Docker outcomes.
- No live Gemini, OpenAI calls, signed-DAG fallback or merge.

## Limitations

This is a pinned scripted three-Task test of a preseeded reference app:
Backend/Frontend mutations still invoke canonical GatewayRuntime
directly; only the Test Task uses full HTTP prepare+execute. This is
not an ADK/A2A model-generated execution or a production remote
authentication deployment. A green full Docker run at R312 SHA is
required before claiming native HTTP Task success.

## Follow-up

Route the two CAS mutations through the same HTTP boundary and connect
the owner-only Orchestrator Task registration, per-Agent A2A bindings,
recovery, and true unsolved-baseline application changes.
