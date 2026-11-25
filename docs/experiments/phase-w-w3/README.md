# Phase W3: scripted real-stack smoke (no AI, no paid API)

Stack: `compose.yaml` + `scripts/compose.phase-w3.yaml`, image `delegation-app:phase-w3`
(built from the W3 working tree via `git archive`), Gitea 28.0.0, Anvil, OPA, Runner.
Repository `thesis/batch-bench`, requirement "Ledger: record each change"
(scripted planner, `DELEGATION_SCRIPTED_PLAN_FILES=15`), session driver
`docs/experiments/phase-r-e2e/scripts/run-e2e.mjs`.

| Run | `DELEGATION_BATCH_WRITES` | Outcome | Gateway decisions | Execution |
|---|---|---|---|---|
| `raw/w3-k5.json` | `1` | completed, Draft PR | 18: backend write-set Task = 4 reads (1 VP) + 4 write items (1 VP, 1 commit); test Task = 5 reads (1 VP) + 1 single update | 42.3 s |
| `raw/baseline-k5.json` | `0` | completed, Draft PR | 18: 10 reads (Phase R batch), 5 single `update_file`, no write batch | 57.3 s |

Write-set publication (run `w3-k5`):
- one `verifyMultiple` at the first item (`batch_verification: performed`, 1549 ms), three reuses;
- strict second verification before the HEAD-CAS: `reverification_ms` 1540.8, reported apart from `provider_ms` 1360.5;
- one commit `61f6b526…` with exactly the 4 signed files (one parent); no isolated staging reference left in the repository;
- one `write_files` call (`batch_size` 4, 4862 ms) in `raw/w3-k5.adk_tool_timing.jsonl`.

One run per variant: a functional smoke, **not** a measurement campaign (that is W4).
The execution times are reported only as observed values.

Defects found by the smoke and fixed before the reported runs:
1. the console did not create the `writeSetIntent`/`writeSetReceipts` directories;
2. the adaptive proposer rejected the `write_set` operation in the completed-work progress (now accepted only with the owner option `batchWrites`; test `write-set-proposer.test.mjs`).
