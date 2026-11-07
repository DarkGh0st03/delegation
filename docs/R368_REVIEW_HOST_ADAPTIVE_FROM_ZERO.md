# R368.0 — Original Review Host: adaptive start with no pre-registered Task

This checkpoint adds an integration regression test to the **existing**
`trusted-authority-only-review-host.test.mjs` suite. Its boundary is the
original Engineer-approved Review Host, not a standalone `runAdaptiveWorkLoop`
harness.

After original operational root and protected SDK A2A are started, the test
checks both Coordinator and Gateway registered Task counts are **zero**.
A free, scripted ADK decision model chooses Backend as the *first* Task.
Only then does the trusted Review Host issue a native Child (offline
issuer fixture), bind the Gateway, dispatch real SDK A2A, and attest
authenticated Gitea mutation completion. A *second* decision chooses
Frontend, dependent on the independently completed Backend. The final
blocked response retires the original root without creating a PR.

Regressions assert two Task epochs, two independent Gateway completion
receipts, no preselected Backend model turn, sanitized model context,
no repeated private IDs, no paid inference and terminal root revocation.

This is deliberately a **non-native offline-provider** Review Host test:
the genuine native Rust/EVM/OPA/Gitea/Docker proof remains R367.2.1
(workflow #42336161315), whose model choice is scripted and whose
orchestration hooks are outside the Review Host. A later gate must
combine the two: original Review Host + free native three-agent E2E,
then permit a separately consented paid Gemini experiment.

No change to Engineer approval permissions, main or PR #38 merge status.
