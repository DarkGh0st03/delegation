# R350.5 — owner-bound native effect staging at same-session A2A dispatch

The R350 authority-only review host now provides `dispatchEnrolledTask` on the same private `admitOperationalExecution` handle. A privileged owner cannot pass an arbitrary `{stage()}` callback as if it were a native Gateway effect. The stager must be an actual `TrustedAuthorityOnlyEffectStager`, and its private Gateway object, runtime Task ID and update/test operation must match the original R349 Engineer session and R350 Child enrollment. The new read-only stager identity method exposes no key, grant or execution authority.

The A2A dispatch is one-shot with replay rejection, root rechecks before and after SDK activity, root retirement after ambiguous dispatch failure, and host shutdown waits for in-flight dispatch. The return remains `a2a_report_not_gateway_completed`: independent provider/Runner evidence is required separately. Negative unit tests reject foreign Gateway instances, Task IDs, operations and arbitrary fake stage ports before A2A.

The earlier R350.4 **offline** ADK/A2A test still exercises the underlying SDK owner using a fixture stage callback to prove transport behavior and denial of unobserved Gateway completion. Production-facing `dispatchEnrolledTask` refuses that callback. A positive native Gitea/Docker dispatch through this stricter boundary and persistent service crash reconciliation remain for the next integration gates.

No Gemini billing, signed-DAG fallback, main change or merge.
