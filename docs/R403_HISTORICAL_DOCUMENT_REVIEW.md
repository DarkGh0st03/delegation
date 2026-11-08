# R403 — Historical milestone document review, not blind deletion

**8 November 2026**, branch `refactor/post-prof-plan-contracts-20261021`, PR #38 Draft. The latest R402 Fast CI succeeded at SHA `5a7f88cc`. No paid inference, merge or modification of `main`.

## Scope

The first documentation cleanup shortlist covers the historical increment reports **R350–R375 under `docs/`**. These are milestone narratives; they are not source, tests, workflows or private MCP crypto modules. The implementation and audit remain in Git history even after a future tree retirement.

`poc/scripts/r403-document-retirement-classifier.mjs` inspects tracked text for literal references to each report's full relative path, leaf basename and stem. It emits three **review categories**, not deletion approvals:

- `BLOCKED_EXTERNAL_TRACKED_REFERENCE`: referenced by other tracked source, workflow, configuration or a document outside this historical group.
- `REVIEW_HISTORICAL_INTERLINK`: referenced only by reports within the same historical batch. Treat as a closure group, not an independent deletion.
- `UNREFERENCED_INTERNAL_REVIEW`: no exact text reference observed inside the scanned tracked text. This is not proof of no external links, generated paths or human usage.

The protected source-of-truth documents (active roadmap, architecture decisions, implementation state, reproducibility, Human Gate and R401/R402 reports) must remain present. Any unreadable tracked text makes the strict CI classification fail closed. Binary/unsupported files are listed separately; external repositories and published links are unverified.

## Auditable checkpoint

Fast CI executes pure synthetic negative/positive classifier tests and produces the `r403-document-review` artifact for the exact SHA. The artifact includes each candidate and its incoming references. It is available for the next controlled **documentation-only** retirement batch, with all file paths reviewed as a set.

The classifier **never** deletes files or authorizes the removal of any of the five legacy runtime modules. The 4 private cryptographic MCP modules, live CI workflows, unique negative tests, GitHub PR and `main` remain unchanged.

## R403.1 — Controlled documentation retirement

**Reviewed evidence:** [Fast CI R403 #42507357533](https://github.com/DarkGh0st03/delegation/actions/runs/42507357533) SUCCESS on exact SHA `6b84c4bb`. Its read-only classifier inspected 50 historical milestone reports, with zero directly observed incoming references from tracked text, zero unreadable tracked text files, and four synthetic negative/positive tests passing.

**Action:** Retire 46 superseded incremental milestone narratives in one Git tree commit. They remain recoverable from parent commit `6b84c4bb` and the Git history. Preserve four review anchors:

- `docs/R351_0_ADK_DYNAMIC_TASK_DECISION.md`
- `docs/R355_ADAPTIVE_OWNER_WORK_LOOP.md`
- `docs/R370_CANONICAL_ORIGINAL_REVIEW_HOST_LAUNCHER.md`
- `docs/R375_ORIGINAL_PROTECTED_MAIN_FUNCTIONAL_PASS_AND_DRAFT_PR.md`

The classifier now locks these four protected anchors with `KEEP_ARCHITECTURE_EVIDENCE`. No source code, tests, active workflows, private cryptographic MCP modules or Rust authority code are removed.

**Limit:** No in-repository full-name/stem references were found, but external links, computed references and historic human usage were not verified; internal no-reference is not absolute proof. Revalidate the resulting tree with Fast CI. The signed native Security CI and real generative pilot remain separate later gates.

## Next gate

Review the generated shortlist and select a coherent documentation-only batch that has no in-repository inbound references from retained files; verify the old docs are superseded by active source-of-truth material and history remains recoverable. Then perform the removal in one Git commit, run Fast CI, and check documentation links. Do not initiate the runtime/test cleanup until the caller and coverage migration gate is ready.
