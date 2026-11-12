# R351.0 — First ADK-selected authority-only Task in the original Engineer owner

The reviewed-native R350.15 E2E passed on run #42211609958 with real
Rust/EVM/OPA, authenticated Engineer, Gitea CAS and Docker acceptance.
That test still prepared all role/Task choices in the harness and the
completed application came from the owner-only disposable fixture.

R351.0 introduces a **model-driven Task choice** bound directly to the
same R349→R350 execution handle. The owner-private method
`proposeAndStageTask({model,runtimeTaskId,childParameters})` provides a
strictly sanitized ADK prompt: requirement, signed branch, approved
permission ceiling, registered agent names/capabilities, previously
registered Task identifiers and the owner-calculated next epoch.
**It never sends the Rust root/Child credential, signing keys, DID,
authentication token, repository source or private adapter path.**

The `TrustedAuthorityOnlyAdkDecisionProposer` uses a real ADK LlmAgent
and Runner with **no tools** and **one bounded model call**. Its output
is a strict JSON candidate for task_id, agent_id, dependencies,
permissions and instruction. The candidate may not provide an epoch,
session pin or root. Pre-screening enforces only known agents,
existing dependencies and original grant containment; the original
Coordinator still performs its own complete durable validation.

For the positive test, the actual ADK Runner consumes a scripted model
which decides the Backend Task dynamically. The trusted owner derives
the epoch and session binding, registers the Task with the original
Coordinator, binds the original Gateway, issues a Child through the
native-port fixture and independently enrolls the Child. A negative
model request outside the signed branch is rejected *before* any
native Child issue, journal mutation or provider write.

**Boundaries:** the R351 unit uses scripted inference and a fixture
Rust Child port. No real Gemini, no autonomous D1, no final PR creation.
It is the first direct model decision path, not a full multi-step
autonomous execution. The R350 native run independently covers real
providers but uses scripted role selection. The next gate connects
this model choice to the original live native owner A2A dispatch and
independent completion; then the loop can select subsequent Task/retest
from verified evidence. No paid calls or changes to main.
