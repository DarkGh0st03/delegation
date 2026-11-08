# R403 — Historical milestone document review, not blind deletion

**8 November 2026**, branch \`refactor/post-prof-plan-contracts-20261021\`, PR #38 Draft. The latest R402 Fast CI succeeded at SHA \`5a7f88cc\`. No paid inference, merge or modification of \`main\`.

## Scope

The first documentation cleanup shortlist covers the historical increment reports **R350–R375 under \`docs/\`**. These are milestone narratives; they are not source, tests, workflows or private MCP crypto modules. The implementation and audit remain in Git history even after a future tree retirement.

\`poc/scripts/r403-document-retirement-classifier.mjs\` inspects tracked text for literal references to each report's full relative path, leaf basename and stem. It emits three **review categories**, not deletion approvals:

- \`BLOCKED_EXTERNAL_TRACKED_REFERENCE\`: referenced by other tracked source, workflow, configuration or a document outside this historical group.
- \`REVIEW_HISTORICAL_INTERLINK\`: referenced only by reports within the same historical batch. Treat as a closure group, not an independent deletion.
- \`UNREFERENCED_INTERNAL_REVIEW\`: no exact text reference observed inside the scanned tracked text. This is not proof of no external links, generated paths or human usage.

The protected source-of-truth documents (active roadmap, architecture decisions, implementation state, reproducibility, Human Gate and R401/R402 reports) must remain present. Any unreadable tracked text makes the strict CI classification fail closed. Binary/unsupported files are listed separately; external repositories and published links are unverified.

## Auditable checkpoint

Fast CI executes pure synthetic negative/positive classifier tests and produces the \`r403-document-review\` artifact for the exact SHA. The artifact includes each candidate and its incoming references. It is available for the next controlled **documentation-only** retirement batch, with all file paths reviewed as a set.

The classifier **never** deletes files or authorizes the removal of any of the five legacy runtime modules. The 4 private cryptographic MCP modules, live CI workflows, unique negative tests, GitHub PR and \`main\` remain unchanged.

## Next gate

Review the generated shortlist and select a coherent documentation-only batch that has no in-repository inbound references from retained files; verify the old docs are superseded by active source-of-truth material and history remains recoverable. Then perform the removal in one Git commit, run Fast CI, and check documentation links. Do not initiate the runtime/test cleanup until the caller and coverage migration gate is ready.
