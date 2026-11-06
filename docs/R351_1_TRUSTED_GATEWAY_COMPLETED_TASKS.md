# R351.1 — Gateway-attested Task dependencies only

The R351.0 model prompt included all staged tasks as `already_registered_tasks`, even if no native Gateway completion or provider receipt existed. A model could propose a dependent Task after an A2A report but before independently verified provider completion. The Gateway would eventually reject an unfulfilled dependency, but the model must not be allowed to infer readiness or consume another inference turn on that stale basis.

The original R349→R350 owner now tracks a **private set of Gateway-attested Task IDs**. It adds an entry **only after** `attestEnrolledTaskCompletion` has checked the original protected A2A dispatch report AND received a matching successful `owner_gateway_completion_independently_observed` receipt from the original trusted Gateway completion observer. No A2A text, model field, SDK status, unvalidated provider payload or client-supplied receipt can mark completion.

R351's `proposeAndStageTask` fails before the model is invoked whenever a staged Task is still unverified, and does not run during an active dispatch or attestation. Once all previous Tasks have been independently attested, the model receives the **minimal categorical** `independently_gateway_completed_tasks` array containing only Task ID and approved agent ID, together with existing immutable scope. The model still chooses a candidate; the original Coordinator validates exact signed permissions, role, dependency IDs and epoch and reserves the Task durably.

Offline regression tests verify that the second ADK call is blocked (zero model calls) after staging but before Gateway attestation, and that the decision proposer permits a dependency only when passed an owner-trusted completed task set. These tests do not invent successful Gateway or Rust evidence.

**Still required:** add a positive, same-owner online cycle in which a real R350 Gateway completion is followed by a fresh ADK Task decision; then independently attest Backend, Frontend and Test. R350.15 native success on run #42211609958 used predetermined Task choices and prepared functional fixture. No paid Gemini, main changes or PR merge.
