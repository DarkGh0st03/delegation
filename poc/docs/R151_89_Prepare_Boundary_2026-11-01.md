# R151.89 — MCP prepare rejection origin and signed-grant preflight

Run 41309296352 on R151.88 recorded four Frontend read_file failures and one
update_file failure categorized gateway_prepare_rejected. Three reads succeeded;
no Frontend write, Test Agent or Docker result was observed.

This category did not prove that Gateway authorizePrepare rejected the requests:
the native host's transport catches assertions before gateway.prepare as well as
Gateway exceptions, returning the same 403 response. Historical causal attribution
remains unknown; this checkpoint does not claim to repair Gemini's old requests.

The native transport now assigns fixed categories at the actual boundary:
request validation, runtime scope, missing same-Task source witness, or Gateway
prepare without a more specific category. Gateway binding, inactive/expired Task,
exact signed permission and dependency rejections carry fixed trusted categories.
Existing error kinds, status codes and rejection behavior are preserved. No raw
exception-message matching is used. Unknown Gateway failures remain unclassified.
The existing private worker/MCP/ADK reason allowlists and both public histogram
sanitizers preserve only this closed vocabulary, role and tool.

Before the protected specialized A2A send, the host checks the same immutable
file permission hints consumed by ADK/private MCP against the current Gateway
Task binding and the exact Task/role/resource/operation pairs in its signed plan.
This is read-only: no provider operation, Prepare challenge, new grant or child
credential is created by the check. The normal live per-operation checks remain.
It does not guarantee a valid model request or satisfy read-before-write.

Validation: eight focused Gateway epoch/preflight tests passed locally; client
and two-stage public sanitizer tests passed. Static imports/type audits pass.
The existing shared MCP and Functional E2Es exercise the new preflight through
real specialized Frontend and Backend transports. Remote CI must still validate
this SHA, including real Gitea/Rust/OPA/Docker scenarios. No new long scenario is
added. D1, terminalTestFailure and Core Rust/OPA/credential policy are unchanged.

The five historical rejected argument payloads are not retained. A precise cause
cannot be reconstructed merely by adding this diagnostic. Do not report that
inconsistent grants or credential expiration caused that run without evidence.
No paid model inference was dispatched by this work.
