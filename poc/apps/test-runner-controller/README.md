# Controlled Docker Runner and trusted Security CI

The Runner receives only a structured, authenticated operation from the Gateway: exact `repository`, `feature/account-suspension` branch, `commit_sha`, `request_id`, `profile=poc-default`. It does **not** accept agent-defined shell commands.

## Exact-SHA validation

`src/isolated-executor.ts` checks Gitea's branch HEAD against the requested SHA, downloads that immutable archive and executes fixed steps in an isolated Docker container:

1. Dependency installation and Playwright Chromium setup.
2. TypeScript type checking.
3. Backend unit tests.
4. Frontend unit tests.
5. Application build.
6. Playwright end-to-end tests.

When researcher acceptance is enabled (as it is in the canonical full E2E), it separately runs researcher-owned acceptance from `poc/runner/acceptance/`, outside the agent-editable repository. **Both** the application test pipeline and independent acceptance must pass for a positive full-E2E verdict. The standalone Runner has a configurable acceptance flag; disabling it does not constitute a valid full-E2E acceptance result.

## Independent trusted CI

`src/trusted-security-ci.ts` posts `pending`, then `success/failure/error` for the exact Gitea feature SHA under a separate CI identity. A passing Test Agent `run_tests` result is not a human review and not a merge.

The coordinator creates a PR only after the Test Agent's checks. The merge gate requires a genuine human review on the exact SHA and independent trusted CI, as documented in `docs/human-approved-gitea-merge.md`.

## Safe offline tests

```bash
npm --prefix poc run test -w @thesis/test-runner-controller
```

The automated *scripted* real-Docker E2E is `.github/workflows/shared-mcp-real-positive-e2e.yml`. Historical paid real-Gemini evidence includes [13 October run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) and [15 October run 38761963415](https://github.com/DarkGh0st03/delegation/actions/runs/38761963415) at `02c3395b9111a63ccc9f441ea2c91c81865d6673`. These runs do not validate subsequent commits and neither proves production-grade security or performs a genuine human merge.

The privileged `security-ci:run` CLI must not run against persistent Gitea without reviewed service identities and configuration.

## Real disposable Gitea + Engineer-signed Gateway Task + Docker acceptance

The positive CI smoke `scripts/isolated-trusted-security-ci-positive-smoke.mjs`
now runs the real Docker acceptance only **once**, through an opt-in,
Engineer-approved Gateway Test Task:

1. Bootstrap a fresh no-volume Gitea and verify the immutable GitHub
   baseline SHA before creating an isolated feature reference commit;
   the original main remains unchanged and protected.
2. `approved-gateway-runner-session.mjs` prepares a short-lived
   **Ed25519 Engineer-signed approval** in an owner-only filesystem store,
   fixes the observed main/base SHA, and activates an immutable signed plan
   granting the Test Agent exactly `run_tests` for the feature branch.
3. Gateway Prepare binds the exact role, operation, branch and one-use
   challenge to the authorized Task. Attempts to substitute `main` or
   another feature branch are denied before executing a provider call.
4. After the trusted CI publishes `pending`, the real A2A SDK sends
   the Test Task to a loopback Agent. Its scripted handler invokes Gateway
   Execute, which calls the actual `GiteaExecutor` to resolve the HEAD from
   disposable Gitea. Its `RunnerClient` connects to the real controlled
   Runner HTTP service, which invokes `IsolatedDockerRunnerExecutor`
   and independent researcher acceptance in isolated Docker.
5. The trusted A2A client validates the completed Agent artifact;
   Gateway independently corroborates it with its own genuine provider
   result, bound to the exact SHA and Engineer-approved Task. Its attestor validates
   the exact tested commit, fixed profile, project tests and researcher
   acceptance before marking the Task complete and closing the session.
   The existing trusted Security CI then verifies the same result and
   publishes `success` on that immutable SHA. Reuse is denied.

This is a **positive approved-plan-to-real-Gitea-to-Docker-Runner
integration** with signed human-authority metadata and provider-effect
attestation; no model inference or PR merge occurs.

**Scope limitation:** this CI exercises a scripted Test role over a real A2A SDK exchange on an
existing reference feature commit. VP verification and policy evaluation
are **injected test stubs** at the Gateway, not the live Rust/OPA
implementations. Real Rust/EVM signed child DC, VP, OPA and revocation
are exercised in a different cumulative EVM job; a separate scoped-child test uses a real Rust DC and A2A with a mock Gitea provider. These isolated
guarantees are not yet a single end-to-end run combining *every*
component and do not assert that the dynamic ADK code-writing Agent
has produced all source files.

No API billing, persistent Gitea mutation, main write, PR merge,
user-signing key exposure or model-driven approval is required.


### Real A2A Task to real Gitea/Runner in one offline run

The positive acceptance workflow now sends the approved Test Task through
a **real A2A SDK** sendMessage/getTask sequence to a loopback Test Agent.
The Agent carries an opaque, preallocated Gateway binding and executes
the approved run_tests operation THROUGH Gateway Execute. Its output
artifact contains the observed Git SHA and real project and researcher
acceptance results. The trusted observer maps the validated A2A result
to the private Gateway Task ID; the Gateway attestor independently
correlates its exact SHA and real Runner provider effects before allowing
task completion and CI publication. An A2A success claim alone is denied.

The CI evidence includes real_a2a_sdk_task_completed=true,
gateway_signed_test_task_completed=true, and exact_provider_sha_correlated=true,
alongside pending then success on the tested Gitea commit. The original
main remains protected; no PR or merge is performed.

**Trust boundary:** this is a scripted, deterministic Test Agent on a pinned
reference implementation. A2A transport and Docker/Gitea provider execution
are real; the child DC, verifier and policy in THIS integration are test
fixtures. Native Rust-signed child DC, EVM revocation and live OPA are
independently exercised by the cumulative EVM job, not yet united with
this specific A2A + Gitea + Docker Runner run. Gemini is not called.

### Native Rust VP plus actual Runner end-to-end evidence

The cumulative EVM job now executes the **same disposable positive
acceptance script** with `APPROVED_RUNNER_NATIVE_EVM=1`, in addition to
the ordinary fixture-verifier mode tested by the separate Docker job.
Native mode fails immediately when required EVM identities or Adapter
caller credentials are absent; it never silently substitutes a fixture
verifier. It uses the compiled **native Core Rust** verifier, live
Anvil registries, genuine Adapter root/child issuance and the real
signed challenge-bound VP. Both modes retain the same Ed25519 Engineer
plan validation, real OPA, A2A SDK, Gitea and Docker acceptance.

Validated: [CI #39740530903, attempt 2](https://github.com/DarkGh0st03/delegation/actions/runs/39740530903).
The native positive step emitted
`native_rust_signed_child_and_vp=true`,
`real_opa_signed_plan_policy=true`,
`real_a2a_sdk_task_completed=true` and
`exact_provider_sha_correlated=true`. The first native attempt timed out
after 300 seconds of provider work; the unchanged-code rerun succeeded.
No paid model or source-repository merge is part of either run.

Only the **Test role** executes in this unified positive scenario.
It consumes an existing, fixed reference commit; it does not generate
Backend/Frontend source using Gemini or exercise an autonomous planner.


## 22 October 2026 — first positive native three-agent + Gitea + Docker E2E

**Code commit:** `478a987540a4c8b86e9640df5d4d94c5c41082c0`.
**Validation:** [Cumulative Offline Refactoring Validation #39748475606]
(https://github.com/DarkGh0st03/delegation/actions/runs/39748475606).
**Result:** 4/4 CI jobs **SUCCESS on attempt 1**.
The native `evm-real-credential` job now also runs the new opt-in
`APPROVED_RUNNER_THREE_AGENT_DAG=1` provider scenario.

The scenario extends the existing single-Test-only signed approval with
a genuinely signed immutable three-specialist plan:
`backend (update_file) -> frontend (update_file) -> verify (run_tests)`.
The operational Engineer root grants exactly those three scopes on the
disposable `feature/account-suspension` branch, and independent native
Rust-issued child DCs bind Backend, Frontend and Test identities to
their distinct approved Tasks. Each credential's signed VP is validated
by **native Core Rust**, with **real OPA/Rego** policy checks before the
actual provider call. The Backend and Frontend use **real Google ADK
Runners and real A2A HTTP/SDK**. Their file edits are committed through
Gateway and the real Gitea API: 2 confirmed updates, in DAG order, each
with separately verified real Git HEAD and file content. The Test Task
is only prepared after both edits have been provider-corroborated.

The exact final Gitea revision (disposable):
`bd4404d79989b5a0a82053fe1f242e511f05d54c`.
The existing A2A Test role then uses its Rust-signed scoped child and
native VP to execute the actual authenticated Runner HTTP service,
on exactly that final revision. CI evidence:
`real_backend_frontend_gitea_edits=2`,
`native_rust_signed_child_and_vp=true`,
`real_opa_signed_plan_policy=true`,
`real_a2a_sdk_task_completed=true`,
`exact_provider_sha_correlated=true`,
`exact_project_phases=6`,
`project_tests=pass`,
`researcher_acceptance=pass`, status
`pending -> success`, `merge_calls=0`,
`persistent_gitea_modified=false`.

**Limits that must not be overstated:** The agents are scripted
`BaseLlm` instances; no Gemini / paid model inference occurred.
The Task plan, reference implementation and two benign appended
TypeScript comments were constructed by trusted test code, not generated
by an autonomous language model. The feature branch was initially
populated from the existing Account Suspension reference fixture;
the three roles have now *acted through the real provider* but have
not produced the whole application from a natural-language requirement.
The Engineer signature uses an ephemeral test signing key rather than
real production interactive consent or an externally verified login.
The trusted control plane and provider are composed within the CI
process; full multi-process fault recovery and restart reconciliation
remain out of scope. The public GitHub `main` is unchanged. This
single successful run is not a latency/reliability benchmark.

Next: review boundary hardening, agent-generated code quality,
task-to-task repository context under real ADK inference (with user
authorization before paid Gemini), rollback/restart semantics, and
explicit Engineering sign-off over the exact final plan.
