# R7 — Dynamic Planning / Execution contract audit (28 October 2026)

**Branch:** `refactor/post-prof-plan-contracts-20261021` (never merge this report into `main` automatically).  
**Purpose:** Distinguish security/architectural invariants from the specific Account Suspension experimental acceptance profile. This report is a source-code audit and work plan, **not** proof of complete real-Gemini E2E success.

## Intended trust and task model

1. Trusted Software Engineer supplies the requirement and authorizes the proposed plan. The Planner's proposal is **not** an approval.
2. ADK Planner incrementally explores an authorized, pinned Gitea snapshot. Its output proposes **task identities, agent roles, resources, operations and dependencies together**, and is compiled into the plan contract.
3. The Engineer's signed decision binds a versioned plan digest and approved permission subset. The Executor **cannot** invent additional Task IDs, roles, resources or permissions afterwards. Substantive repartitioning requires reapproval, rather than treating generic resource rights as authority to invent tasks.
4. Executor walks the approved DAG, executing infrastructure tasks itself through the trusted Gateway; specialized Tasks use protected A2A and individual scoped child credentials. The traversal is sequential in the current implementation, even for independent DAG nodes; that is an implementation performance constraint, not a required dependency.
5. Effective authorization is exact **Resource URI + Operation**, with operations from Core Rust. Gateway/Core Rust/OPA checks, provider observation and root revocation remain mandatory independently of model text or the A2A task state.

## Non-negotiable invariants (model/scenario independent)

| Area | Invariant | Existing ownership |
| --- | --- | --- |
| Plan structure | Registered agent/task identity, valid operation, resource bound to a task, acyclic dependencies, approved plan digest | `poc/packages/plan-contracts/src/plan.mjs` |
| Planning | No self-granted permissions, no write access through the preliminary read-only discovery channel | `poc/packages/orchestrator-runtime/src/trusted-adk-planner.ts`; trusted authority |
| Approval | Signed Engineer decision and unmodified approved plan; permission subset must not expand during Execution | Trusted review gate, signed approval store, Gateway |
| Delegation | Each specialized Task receives scoped child authority and unique protected A2A dispatch; denial, stale root or wrong role fail closed | Trusted approved A2A dispatcher, Adapter, Core Rust |
| Provider | Exact resource+operation enforced on every real Gitea/Docker request, with OPA and verifier results | Gateway, Core Rust, OPA |
| Completion | Agent's A2A `completed` does not itself prove provider operations; corroborate with trusted Gateway records | `poc/apps/gateway/src/trusted-task-observation.ts` |
| Tests and merge | No fabricated passing Docker status or automatic merge; independently verify acceptance against the tested SHA when the scenario requires that acceptance | Runner, approval gate and experimental fixture |

## Behaviors that must remain dynamic

- Task **count**, file count, task titles and decomposition, and the distribution of multiple Tasks across the available roles.
- Order among independent DAG nodes, including read-only analysis or test preparation before implementation where dependencies and permissions allow.
- Read-only, write, and mixed Tasks: a legitimate read-only Task needs actual Gateway read evidence, **not** a fabricated commit.
- Test edits may be zero, one or many. A general Planner contract cannot insist on exactly one new test file or on one Task per agent.
- Repeated sequential edits to a resource are legal when individually granted and dependency-ordered; unordered competing writes must be diagnosed rather than assumed to be safe.

## Experiment-specific constraints — do not elevate to universal architecture policy

The `native-approved-planner-dag-positive.mjs` runner is **bounded Account Suspension acceptance**, not the generic Executor. It currently checks the presence of Backend/Frontend/Test roles, an approved branch creation and PR Task, one exact-SHA Docker acceptance, immutable `main`, and functional Account Suspension acceptance. It also uses scenario fixtures and a fixed set of supported provider actions.

Those are meaningful experimental constraints **when explicitly part of the experimental objective**, but an otherwise legal Plan for a different requirement must not fail the *general* contract merely because it lacks those exact roles, file changes, a PR or this Docker profile. All reported failures must distinguish **general contract rejection**, **unsupported bounded pilot profile**, **provider/security denial**, and **functional acceptance failure**.

`poc/apps/gateway/native-test/approved-dag-preflight.mjs` is **pilot-only**. Its role requirements, task-count limit and Runner/PR ordering are not the definition of a valid universal DAG. Its generated test matrix is a robustness sample, not a predictor of Gemini's choices.

## Code corrections during this review

- `poc/packages/agent-runtime/src/adk-a2a-handler.ts`: read-only specialized Tasks can report an actual Gateway-returned, consistent snapshot SHA without creating a commit. No controlled read and no revision still fail closed.
- `poc/apps/gateway/src/trusted-task-observation.ts`: accepts a read-only completion only when **every** recorded provider effect is a real Gitea `read_file` for the reported branch and SHA; mock effects, forged SHAs and unobserved writes fail.
- `approved-dag-preflight.mjs`: removes the arbitrary requirement that every specialized Task must mutate a file or run Docker.
- Adds dedicated Gateway and real ADK/A2A test cases; see the corresponding `*.test.ts` files. A passing offline test alone must not be reported as a real-model success.

## Remaining technical debt / next checkpoints

1. Finish offline CI for these changes (including negative read-only cases and real A2A transport), resolve code-level regressions without weakening evidence.
2. Audit all generic handlers and the bounded native fixture for residual `exactly one task/file`, role-order, and test-mode assumptions. Each should have either a **documented architectural basis** or be scoped to the explicit experiment.
3. Expand the no-billing full-stack replay with distinct valid Plans, not just the same Account Suspension fixture. Test malformed permission URI, unapproved role/Task, reordering, revocation, and provider denial separately.
4. Preserve safe **replayable plan shapes** from real pilots without model prose, source contents, secrets, DCs or VPs. A sanitized shape alone is not authorization or an Engineer signature.
5. Review and version scenario-specific functional acceptance criteria independently of plan shape. A valid but ineffective Plan can legitimately fail functionality; that must not be mislabeled a delegation-contract violation.
6. Only after offline gates are green, consider a newly authorized billed Gemini pilot. Do not reuse authorization from a preceding run. The current four-Gemini pilot uses **signed Engineer TEST fixture**, not live human approval.

## Explicit limitations

The current runtime recognizes the available specialized roles (`backend`, `frontend`, `test`) and a finite Rust/Provider operation catalog. This is dynamic **within that registered role/tool universe**, not the ability to execute arbitrary agents or shell commands. The current dispatcher is sequential and approval-bound; it does not dynamically rewrite the signed plan after activation.

Historical `docs/ARCHITECTURE_DECISIONS.md` and `docs/CURRENT_CHECKPOINT.md` also document the earlier deterministic PoC. Do not mistake old sequential templates for the branch's new trusted approved-DAG path.
