# R295 — owner-only Gateway read result publication (fail-closed, dormant)

Parent: `ea3dc8b0d742065e45d7e488985c647c7ce35099`. Branch: `refactor/post-prof-plan-contracts-20261021`.

## Changes

A real `GiteaExecutor` now retains an unforgeable **in-process WeakMap
witness** for each successful `read_file` result: the original *object
identity* of the protected Gateway Prepare record, request ID/fingerprint,
revision, path, blob SHA and SHA-256 of actual returned bytes. A reconstructed
JSON result or a mutated result cannot pass that gate.

`TrustedGatewayGiteaReadEvidencePublisher` accepts exactly a successful
GiteaExecutor read, an already-consumed Gateway prepared request, a positive
OPA decision and a native-verifier result belonging to the **currently
enrolled Child DC**. A separate Gateway owner-private projection revalidates
signed Engineer authority/root, the exact Task/epoch/agent DID, the registered
R293 durable flight marker, canonical permission, prepared fingerprint and
Child lifetime. The publisher writes the R294-compatible HMAC receipt with
`O_EXCL | O_NOFOLLOW`, file 0600, parent directory 0700 and two fsyncs.
The receipt never contains source bytes or private keys. Duplicate publication
fails and must be reconciled, not silently retried.

The normal Gateway `executeAuthorization()` now has a typed owner-only
post-provider-success publication hook. **It is unreachable for authority-only
requests today**, since the R288/R289/R291 terminal gate still throws before
all provider effects. There is **no opt-in bypass, runtime switch, legacy
fallback or model-issued evidence route**. Any later change that enables a
provider effect must be separately reviewed, and must preserve this hook
before treating a Task as completed.

## Tests

Two added Fast CI tests cover (1) a simulated authentic GiteaClient read
through the real GiteaExecutor class, publisher, actual on-disk R295 receipt,
R294 independent authenticated Gitea reread, and R293 Task completion;
plus negative publisher scenarios (wrong Child, denied OPA, forged provider
return object, duplicate receipt); (2) configured publisher cannot bypass
the authority-only terminal Gateway denial and provider call count remains
zero.

The positive test uses offline fake Gitea HTTP, offline simulated Rust/OPA
results and manually sets a consumed Prepare to exercise a future trusted
post-provider seam. It **does not prove** that production authority-only
Gateway performed a provider operation or issued a real receipt. The R292
real Rust/EVM+OPA validation is separate and stayed provider-deny-only.

## Remaining work

R296 should integrate a genuine live read-only Gitea/Runner execution
behind an explicitly reviewed, narrowed authority-only admission mode, verify
native VP + real OPA, and prove that the receipt comes only from the actual
post-provider-success Gateway call path. Task-level completion with multiple
legitimate tool calls requires a separate per-effect sequence fence and
corroborated mutation/Runner evidence. Do not loosen the current single-flight
R293 journal to achieve this.

No paid Gemini/OpenAI runs, no `main` edit or merge.
