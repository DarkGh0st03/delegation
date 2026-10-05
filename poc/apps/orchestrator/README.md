# Orchestrator application

Phase 9A adds the Software Engineer bootstrap entrypoint for the thesis PoC.

`npm --prefix poc run orchestrator:bootstrap` authenticates to the Delegation Adapter as the Engineer caller and issues exactly one root Delegation Credential to the Orchestrator.

The CLI accepts no permission list. Root authority is loaded only from the frozen `ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY` template in `@thesis/orchestrator-runtime`.

Phase 9B will extend this application with deterministic A2A workflow coordination. No merge operation is exposed.
