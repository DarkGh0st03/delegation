# R367.2 — Free native adaptive three-role checkpoint

Goal: prove that the R355 `runTrustedAuthorityOnlyAdaptiveWorkLoop` can
drive the same native SDK A2A/Rust/OPA/Gitea/Docker provider path previously
proved in R365.3, but **without** preregistering a Backend/Frontend/Test DAG.

A free scripted ADK model proposes one specialist Task on each turn:
Backend (read + CAS), Frontend (read + CAS), Test (Docker and acceptance).
After each proposal the original Coordinator registers only that Task;
the original native issuer derives the Child from unchanged signed grants.
The next proposal may happen only after original SDK A2A transport and
independent Gateway evidence confirm completion. Gitea HEAD is read from
the independent authenticated client on each turn.

The fourth scripted decision requests `ready_for_pr`; only reopening the
original independent Runner receipt and confirming project/acceptance PASS
at the current tested HEAD allows it. No PR is actually created.

The validation workflow boots disposable Gitea, Anvil, OPA, native Rust,
real Docker, and separate agent Unix role bindings. It rejects paid API
credentials. The application fixture and ADK outputs are scripted;
this is NOT a generative Gemini pilot, and native R367 proof is not a
substitute for proof of original Review Host integration. PR #38 remains
Draft. No merge.
