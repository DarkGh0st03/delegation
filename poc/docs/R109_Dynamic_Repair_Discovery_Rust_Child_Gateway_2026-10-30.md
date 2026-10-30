# R109 — Dynamic, exact-scoped repair discovery under the existing Rust root
Date: 2026-10-30. Working branch: `refactor/post-prof-plan-contracts-20261021`.

## Research goal and architectural rule

Delegation is a multi-agent framework backed by the **existing native Rust hierarchical Delegation Credentials**, verifiable presentations, ResourceURI/Operation attenuation, accumulator-based revocation/witnesses, DIDs and OPA/Gateway enforcement. No model, Task graph, Gitea bearer token or second application envelope may create authority.

The Engineer's final user-facing consent should consist of the target repository, working branch, an exact *maximum* set of ResourceURI/Operation pairs and optionally an expiry. Agent allocation, Task DAGs and the internal three-epoch repair budget are Orchestrator/runtime decisions. The present legacy initial-plan signature still ties that maximum authority to individual initial Task IDs; that initial-consent migration remains incomplete.

R108 protected code reads after a confirmed Test FAIL, but required an already registered read Task. This caused a circular dependency: the Planner needs to inspect the failing feature-branch code to choose which repair Tasks to plan, while the prior Gateway allowed only Task IDs already present in an original or subsequent DAG. R109 establishes a distinct *read-only discovery Task* under the same existing Rust root **before** the repair plan exists.

## Concrete implementation

### 1. Root-based discovery preflight

`TrustedOperationalEpochIntake.preflightRepairDiscovery()` independently reloads the authenticated Engineer receipt and the Coordinator's *actual issued operational Rust root*, verifies the original and every persisted epoch, checks that the Task ID is new and the Agent is in the pinned trusted registry, and confirms the exact pair `(gitea://.../branches/<approved-branch>/files/<exact-file>, read_file)` is already present in the actual root. No wildcard, inferred role privilege, higher authority or permission expansion is accepted. The returned metadata explicitly says `execution_authorized:false`.

A dynamically selected Agent DID is taken from the host-pinned registry, not the model, and checked again against the real presenter DID from native VP verification.

### 2. Same Adapter and durable child issuance

`TrustedApprovedPlanChildAuthorityIssuer.createForRepairDiscovery()` is an opt-in constructor on the preexisting issuer. It requires a Gateway-confirmed terminal `validation_failed` Runner receipt, an active original Rust root, a new Task ID, exact read-only permission and the preexisting private `TrustedChildIssuanceJournal`. It reuses the same Adapter `POST /v1/credentials/child` endpoint as original Task-scoped DC issuance. It records the issuance intent on disk *before* the side-effecting request and refuses duplicate issuance; an unknown HTTP result remains uncertain, never an invitation to retry blindly. The Adapter reply is checked against the requested exact permission.

The Adapter acknowledgement is NOT by itself a native Rust chain-verification result. That trust boundary is still enforced later by the Gateway's VP/native-Core verifier.

### 3. Owner-only Gateway discovery admission

`TrustedApprovedExecutionPlans.admitRepairDiscoveryTask()` checks the exact signed root and failed-Test session/epoch, requires a matching durable Adapter response ACK for the same Task ID, role and child credential ID, and validates the read grant against the real root again. It registers only one exact `read_file` permission; no Task write, Test PASS, PR or new authority is created.

The Gateway's normal Task binding, Prepare, VP verification, OPA, Execute and provider evidence collection remain mandatory. For this special Task, the Gateway requires the VP-verified credential identifier to equal the **journalled child identifier**, and the presenter DID to equal the pinned Agent DID. This identifier propagates through the post-provider evidence recheck, not only the pre-provider check.

A maximum of four registered discovery Tasks per current epoch is an internal cost/abuse constraint. The new read Tasks do not consume one of the three implementation/Test epochs, but **must complete with independently attested Gateway read evidence before the next repair epoch may be admitted**. An incomplete discovery cannot silently survive a plan transition.

### 4. R108 reader and model

The previously built `TrustedOperationalRepairSourceReader` can now be bound to such a newly issued Task ID. It still checks an original root grant, the exact corroborated Runner failed SHA, current feature HEAD before and after the read, task-specific Gateway authorization and content budgets. The optional ADK `read_file` tool is bound to this reader only; the model never receives a VP, child DC, Gitea token or direct provider access.

## Tests and limitations

The new independent invoice-service scenario covers:
- fresh Task ID not in original DAG, permitted only by an actual root `read_file` pair;
- denial of a missing grant, foreign branch, unregistered Agent or reused Task ID;
- new read-only child request using the EXISTING Adapter interface and durable ACK/replay fence;
- no Gateway Task admission before issuance or without a matching durable ACK;
- rejection of `update_file` despite original Backend write rights;
- rejection of a VP that reveals a different child credential ID;
- successful authorized `read_file` through the R108 source reader, with Gateway Prepare/Execute, bounded branch/SHA and mock VP/OPA/Gitea;
- refusal to admit a repair DAG until the discovery read is completed and attested;
- the original child cannot be issued twice.

**These are offline integration tests with a mocked Adapter response and mocked VP verifier, OPA and Gitea.** They test the application control plane and interfaces; they DO NOT yet demonstrate a real native Rust DC/VP, current accumulator witness and live disposable Gitea/Docker in the same read-after-FAIL run. Existing native Rust and Docker CIs independently verify other scenarios.

Critical gaps before any paid Gemini test:
1. Final Engineer consent is still associated with the original plan digest and Task-bound permission rows; refactor original root issuance around maximum exact pairs, retaining the native Rust security model.
2. Prove fresh child DC -> verifiable presentation -> native Rust/accumulator/revocation -> OPA -> actual Gitea read -> subsequent real Docker FAIL -> repair -> PASS -> PR in one **no-billing** E2E, preserving exact branch SHA.
3. Confirm Gateway discovery registry behavior and issuance journal recovery/revocation across restarts and cross-process deployment. Owner-private admission in this increment is an in-process method, not a new HTTP API.
4. Integrate the newly issued read Task with the real ADK tool-calling and trusted child VP signer, including meaningful compiler diagnostic path discovery restricted to exact authorized read scopes.
5. The internal 3-epoch limit is not an independent Gemini monetary hard cap. Do not run paid experiments until user approval and provider billing protection are independently verified.

No change to `main`; no paid Gemini calls in R109.
