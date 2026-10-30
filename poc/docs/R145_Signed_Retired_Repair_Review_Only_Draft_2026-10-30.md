# R145 — One-shot signed review-only PR after retired Rust recovery

Date: October 30, 2026, branch refactor/post-prof-plan-contracts-20261021.

R145 extends the R141/R142 trusted owner-held witness (captured while the
original Rust root is live) with `openSignedReviewOnlyDraft`. A provider
draft PR is permitted only when the ORIGINAL Engineer-signed approval
already contained an Orchestrator `create_pull_request` grant against
the exact Gitea repository, bound to an original PR Task explicitly
dependent on the original Test Task, and the same operation was in
the actual Rust-issued original root. The old PR Task is not replayed:
review publication is an independent owner-only post-closure action.

Before a single PR POST, R145 requires the R142 proof: the same
Coordinator shutdown has completed, the Gateway session is durably
retired, the new signed repair Test has an independently attested
all-phase PASS at the current exact Gitea SHA, and the original Rust
root is EVM-revoked. It also rechecks original Gitea identity and
the signed ORIGINAL main-branch SHA. The R143 Gitea client opens only
draft/unmerged PRs, validates the response, reads it back, and checks
HEAD/base again. R145 rechecks Coordinator shutdown and Gitea refs.

An in-memory witness flips a one-shot flag BEFORE all asynchronous
checks. It does not auto-retry a potentially created PR. The Gitea
publisher token is owner-private and the operation is not an A2A,
MCP, model, or agent tool. No merge endpoint is invoked.

Tests: positive mock provider draft, signed PR grant missing, moved
Gitea feature/main, nonrevoked root, and no PR replay. Gateway HMAC,
signed Engineer approval and durable epoch checks are live in-process
tests; Rust/Adapter status and Gitea are scripted in this suite.
R139/R143 independently verify the R143 draft client against REAL
disposable Gitea/Docker; R144 independently verifies the R142 native
root reader against REAL Rust/EVM.

CRITICAL: This is not the unified original-root-delegated Gitea/Docker
FAIL-to-PASS scenario. The R145 PR path is a trusted owner action
after retirement, not a delegated PR Child DC. Do not claim a combined
real EVM/Gitea recovery success from these independent tests.
