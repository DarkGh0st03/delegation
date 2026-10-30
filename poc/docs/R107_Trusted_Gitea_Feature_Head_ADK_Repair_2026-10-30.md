# R107 — Trusted feature-branch revision and ADK repair proposal (30 October 2026)

Branch: `refactor/post-prof-plan-contracts-20261021`.
This handoff is part of the ongoing **Delegation** thesis development. The framework's main contribution is the original Rust DC/VP credential hierarchy, permission attenuation, accumulators/witnesses, revocation, DID trust, and independently enforcing Gateway/OPA; the multi-agent implementation is the application. Never replace that authority with model assertions or a parallel application-level permission system.

## Why these changes were required

The three paid Gemini runs reached Docker but typechecking failed (TS2820, TS2367, TS2339). R104/R105 introduced verified failed-Test feedback and the ability to skip only descendants of that Test in a signed Task DAG. R106 added an owner-private candidate repair Planner and durable new operational epochs under the same already-issued Rust operational root, but its Gitea feature HEAD reader was an arbitrarily injected callback. That could be replaced accidentally by a model or fake host-provided revision. The initial ADK Planner also reads `main`, not the modified feature branch, and must not be blindly reused for repair.

## Implementation

### Gateway-side feature-head observation

- `poc/apps/gateway/src/trusted-operational-feature-head.ts` implements `TrustedOperationalFeatureHeadReader`.
- It requires a server-constructed `GiteaClient`, a concrete `TrustedOperationalEpochIntake` and pinned repository identity. It is not an MCP/A2A/model tool. No Gitea token is given to Gemini.
- Before any Gitea GET, it calls `verifiedEpochHistory()`, which checks the authenticated Engineer-signed original receipt against the active Coordinator-issued Rust operational DC and the persisted epoch history. It checks requested repository/branch against that root.
- The authenticated Gitea service client reads repository metadata and the specific feature branch HEAD, checking canonical repository full name and exact 40-character commit SHA.
- After external I/O, it verifies the root and epoch history again. R106 Planner calls the reader twice: once before, and once after potentially slow model inference. The former root/base-main SHA remains the session identity; the changing feature HEAD is the candidate repair source revision.
- `TrustedOperationalRepairPlanner` now requires an instance of this reader tied to the same intake instead of an arbitrary SHA function. Rejects wrong Gitea identity, branch, malformed SHA, foreign Coordinator and revoked operational root.
- This is a **trusted metadata observation only**, not an agent-scope bypass: any future source file content given to Gemini must be separately authorized through DC/VP/Core Rust/OPA and read grants on the feature branch. Do not equate the service-side HEAD GET to a general read privilege.

### ADK proposal adapter

- `poc/packages/orchestrator-runtime/src/trusted-adk-operational-repair-proposer.ts` adds `TrustedAdkOperationalRepairProposer`, a one-use Google ADK `LlmAgent` proposal adapter.
- It receives only the structured source-free failed Runner feedback, requirement, Agent roles and already-delegated ResourceURI/Operation pairs. No source content, credentials, MCP tools or write API are exposed.
- The adapter makes at most one model delegate invocation per instance, with configured output-token and session/call time limits and only metadata observations. This is **NOT a verified monetary cap**; paid tests require separate user authorization and provider billing verification.
- It emits a strict JSON object with only `tasks`. The existing `TrustedOperationalRepairPlanner.compileDraft()` validates structure and sequencing; `TrustedOperationalEpochIntake.preflightRepairEpoch()` independently verifies every exact permission against the actual issued parent DC before durable reservation.
- ADK tests with `BaseLlm` scripted fixtures are placed in the Orchestrator runtime package, which owns `@google/adk`. Gateway tests deliberately do **not** import that dependency. A failing interim CI exposed this package-boundary issue, and it was corrected without adding ADK to Gateway.

## Tests / security cases

- Real Gateway GiteaClient class (scripted HTTP provider response) returns current feature SHA; proposal observes it twice.
- Wrong repository identity, malformed SHA, foreign root, branch mismatch or revoked root fails closed.
- Source-free one-turn ADK JSON proposal with no tools; malformed JSON, extra fields, replay, invalid feedback and output-token cap tested using an offline scripted model.
- Existing R106/Gateway tests continue to cover a scripted FAIL -> trusted repair DAG -> new Gateway Task -> Test PASS, including denial for arbitrary file scopes, stale revision, new branch, and premature PR.
- No Gemini live billing has been invoked for R107. No change to `main` or to native Rust DC verification/OPA.

## Not yet proven — do not overclaim

1. The new ADK adapter and the R106 scope-and-Gateway harness are validated in **separate package tests**. This is not yet one integrated, cross-process ADK -> signed child DC -> VP -> native Rust/OPA -> real Gitea/Docker repair loop.
2. The ADK repair proposer is source-free. Real intelligent debugging needs **authorized read-only code discovery** at the current feature SHA, using granted read permissions and the existing Gateway VP/OPA protected tool path. No root-wide file browsing or hardcoded IAM Console paths.
3. The currently issued operational root is still derived from the initial approved plan permissions; the original Engineer consent is still coupled to Task IDs. The intended final Engineer GUI approves repository, branch, maximum exact grants and optional expiration only. Remove that application coupling by migrating **through existing Rust root issuance**, not by using R99.1's parallel envelope as a new authority.
4. Child DC issuance, A2A replay/revocation, signed Task registration and exact-Git-SHA Docker acceptance must be demonstrated in ONE no-billing E2E, preserving the modified branch across validation cycles.
5. Provider cost limits must be independent of model-chosen attempts. The bounded internal three-cycle limit does not prove any paid Gemini spending cap.

## Next incremental priorities

- R108: trusted read-only source discovery through real Gateway Prepare -> challenge VP -> Core Rust -> OPA -> Gitea, constrained by the existing Engineer-root and newly delegated Agent read grants; adapt ADK tools to feature revision, not `main`.
- Then integrate signed operational child DC/VP with the admitted new-epoch A2A path, running a real disposable Gitea/Docker FAIL -> repair -> PASS -> PR without Gemini billing.
- Only after the above safety tests and independent cap verification may real Gemini pilot runs resume with explicit approval.
