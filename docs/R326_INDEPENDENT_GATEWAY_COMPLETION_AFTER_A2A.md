# R326 — independently observed Gateway completion after A2A

The R325 owner dispatch returns an A2A report with
`provider_completion_attested:false`. R326 introduces an explicitly
separate terminal method:
`attestIndependentGatewayCompletion(taskId,runtimeTaskId)`.

It is only callable after a real prior A2A report from THIS owner and
requires exactly the same owner-selected Task and runtime ID. That
report is NOT passed to the Gateway as authority or provider evidence.
Instead the owner calls the original live
`TrustedAuthorityOnlyGatewayAdmissions.attestTrustedTaskCompletion`.
The Gateway independently resolves the previously reserved Task flight,
enrolled native Child, root, dependency state and owner-controlled
`TrustedAuthorityOnlyCompletionObserver` (Gitea/Docker evidence), then
durably records its result. Only that Gateway action can unlock the
subsequent Task.

A failed or uncertain observer call is terminal and cannot be retried.
No A2A text, status, revision or self-declared Test PASS is able to
force a Gateway completion. The two-step result records are different
types by design. Cancellation/host retirement clears uncorroborated
reports.

Fast CI uses an explicitly stubbed independent Gateway callback to
test that it cannot be invoked before or without a legitimate matching
R325 report. This is a routing/control invariant, not proof that a real
Gitea/Runner receipt exists on this SHA. Production integration still
requires native EVM/status, OPA, genuine multi-process authenticated
A2A caller, and real disposable Docker Gitea E2E. No Gemini/paying
workflow, `main` update or merge is part of R326.
