# R303.4 — disposable Test Agent native Rust/EVM/OPA → real Docker acceptance

Base: R303.3 `7a000707474f26b334f482ebaf11a6abc54251bb`.

## Isolated real-provider acceptance

The new workflow `R303 Native Test Agent Rust EVM OPA Real Docker Runner
(No AI)` reuses R302's known native Rust/EVM + independent OPA +
disposable Gitea infrastructure, but registers **only** a Test Agent
Task, with an Engineer-signed `run_tests` branch grant. It intentionally
does not use the old signed-DAG Runner authorization path.

1. Trusted CI owner imports the protected reference repository and
   creates `feature/account-suspension`, pins its Gitea HEAD, and
   seeds one harmless fixture file before Engineer approval.
2. The CI Engineer signs immutable permission-only Test branch scope;
   native Rust issues both root and narrower enrolled Test Child.
3. Real native VP + EVM root/status/revocation verification and actual
   OPA `allow` independently prove permission to run tests.
4. The owner-only preflight rejects another tested SHA, fsyncs the
   intended Task/Child/exact feature commit, then the Task flight
   is durably reserved.
5. The explicit `authorityOnlyRunnerEnabled` gate calls only the
   R303.3 one-shot executor; it rechecks HEAD and persists an
   irreversible attempt before **one** authenticated HTTP POST.
   The controlled Runner server runs the real Docker image
   `node:22.15.0-bookworm`, installs pinned dependencies, runs
   typechecking, Backend/Frontend tests, build, Playwright E2E and
   separate researcher acceptance.
6. A successful result requires all seven phases PASS on exact
   pinned SHA. A protected HMAC receipt is independently reopened,
   Gitea HEAD is rechecked and Task completion journaled. Wrong
   challenge, wrong operation, replay, foreign Child, revoked root
   and any legacy Gitea executor invocation must be denied.
7. Verify Gitea `main` remains unchanged and Gemini paid calls = 0.

The positive proof is specifically a **single Test Task on the
provisioned reference baseline**, NOT yet a multi-Task Backend→Frontend
→Test chain after R302's atomic update. That dependent sequence is a
subsequent R303/R304 milestone.

## Completion gate

Only report R303.4 as SUCCESS after both the Fast CI and **the real
native Rust/EVM/OPA + Docker CI** finish on exactly the same SHA,
and the integration log emits
`r303_authority_only_native_evm_real_docker_test_agent` with
`runner_calls:1`, `legacy_calls:0`,
`project_tests_pass:true`, `researcher_acceptance_pass:true` and
`completion_attested:true`.

A Runner FAIL, ambiguous result or missed log must NEVER be counted as
PASS. No retries, no paid model calls and no production writes.
