# R319 — bind authority-only ADK tool result to exact Gateway execution

The optional native owner effect staging bridge from R317/R318 completes
after Gateway HTTP prepare and before a private signed VP. A success-like
HTTP 200 must **not** be treated as execution evidence unless it includes
both the exact prepared request ID and the explicit `allow` decision.

R319 applies this result check when the trusted owner stager is installed.
It is deliberately strict for the authority-only path, while leaving
historical client tests/configurations without a stager unchanged.
Malformed, missing, denied or cross-request responses fail with the
constant safe reason `gateway_execute_unclassified` and do not return
an optimistic `execution` result to ADK. They cannot be retried through
the already one-shot owner stager.

The real Gateway response already includes `request_id` and
`decision: allow` on successful execution. Four negative offline tests
cover cross-request, missing ID, false allow and missing decision.
This is **not** proof that a separate real ADK/A2A process is attached
to the owner stager, nor a substitute for native Docker/OPA verification.
No paid API calls or workflow checkpoint changes.
