# R340 — Original Gateway Test flight in the D1 evidence chain

The R339 owner preflight inspected the durable HMAC Runner FAIL and
original Engineer Coordinator/Child, but did not independently correlate
the already **reserved Gateway effect flight**. The pre-dispatch binder
deliberately rejects in-flight and completed Tasks.

R340 adds `assertTrustedFailedRunnerFlight`, a host-private read-only
Gateway projection for an original, incomplete, signed Test flight.
It checks Test role, native Child and epoch, Task/Runner request pins,
original permission-only ceiling, completed predecessors, unexpired
Child and absence of successful Test completion.

The R339 owner preflight now mandates this live Gateway flight before
accepting independent FAIL evidence, and rechecks it after the
asynchronous durable MAC/Gitea read. Tampered Task, Child, request ID
or forged success cannot arm the recovery preflight.

This is **not** a new D1 epoch or executable permission; all outputs
explicitly deny recovery authorization and provider completion.
Negative and positive offline regressions accompany the bridge.
R338 real negative Docker E2E remains separately attested on its
own pinned SHA. No Gemini charge or `main` change.
