# N2 — sufficiency of signed Backend repair context (3 Nov 2026)

Framework parent: `613e793b39e3c2221b444793886a8fa968b5bdec`.
Scope: Account Suspension, TS2724, paid model **disabled**.

## Already verified
- N1 private compiler context is bound to the failed SHA, original read scope,
  and newly admitted repair Task, with a real Backend ADK request capture.
- [TS2724 targeted D1 #41618869640](https://github.com/DarkGh0st03/delegation/actions/runs/41618869640)
  succeeded with Gitea/Docker and a *deterministic* editor.
- Fast CI #41618869751 succeeded with Node 22.15.0.
- The real paid D0 #41592663593 reached TS2724; that failure does not reveal
  the private import/export symbol in public logs.

## Measured contract and limitation
- `TrustedAdkOperationalRepairProposer.assertBoundedBackendTestDraft` requires
  **one Backend file**, one `read_file` + one `update_file`, followed by a
  separate Test `run_tests` Task (R151.19 existing negative contract test).
- Original-root `read_file` for an imported shared module is **not copied**
  into that newly proposed D1 Task. Root scope and signed Task scope are
  separate. The model does not gain a new read via its own proposal.
- The specialist ADK worker can expose additional read-only context *if the
  actual newly signed Task explicitly contains that exact read grant*.
  The new N2 zero-billing ADK regressions contrast importer-only, exporter
  readable, exporter update-only, and a foreign resource. The positive
  case is a hypothetical prebound signed Task, NOT proof that the current
  bounded D1 proposer creates such a Task.

## Readiness decision
The private TS2724 diagnostic may be sufficient for the model to correct a
straightforward spelling error without extra source. For an unseen error that
requires inspecting an exporter, the current one-file D1 may have **insufficient
context**. In that case the editor must report missing source and stop: it
must not hallucinate a definition or widen permissions.

No expansion is implemented here. If the next real run establishes that the
exporter's contents are essential, the trusted Engineer must authorize the
additional `read_file` scope through an independently reviewed repair
contract; merely having it in the original root is not a signed Task grant.

N2 confidence: the tools and grant boundary are measured; universal
generative repair sufficiency is **not** established. No paid pilot, Full CI,
root or signature changes are triggered by this test/document checkpoint.
