# Phase 12C Reference Measurement Results

This document records the first clean repeated measurement campaign for the thesis PoC.

## Dataset

The reference campaign is GitHub Actions run `37439708880`, executed from framework commit:

`f457f6f194497f9567f67ae72cdb465085c65ca5`

Five independent replicas of the same pinned positive Account Suspension E2E all completed successfully.

Each replica executed 28 Gateway authorizations:

- 27 protected Gitea operations;
- 1 exact-SHA Controlled Runner operation.

The final dataset therefore contains **140 authorization executions**:

- **135 Gitea executions**;
- **5 Runner executions**.

All five replicas passed project tests and researcher-owned acceptance, created the PR only after the exact-SHA test gate, left protected `main` unchanged and performed no automated merge.

## Main authorization results

For the 135 ordinary protected Gitea operations:

| Metric | Mean | p50 | p95 |
| --- | ---: | ---: | ---: |
| Preparation | 0.184 ms | 0.128 ms | 0.432 ms |
| SSI/EVM delegation verification | 623.467 ms | 674.286 ms | 702.932 ms |
| OPA evaluation | 1.771 ms | 1.620 ms | 2.844 ms |
| Gitea provider execution | 152.725 ms | 168.368 ms | 311.042 ms |
| Total authorization + execution | **777.984 ms** | **710.376 ms** | **1011.694 ms** |

At the arithmetic-mean level, the Gitea-path latency is approximately:

- **80.14% SSI/EVM delegation verification**;
- **0.23% OPA policy evaluation**;
- **19.63% protected Gitea provider execution**.

This means OPA is negligible in this PoC's positive-path latency. The dominant authorization cost is the SSI/EVM verification path.

## Controlled Runner

The Runner is intentionally analyzed separately because it executes the complete isolated project validation suite.

Across five Runner executions:

| Metric | Mean | p50 | p95 |
| --- | ---: | ---: | ---: |
| SSI/EVM verification | 632.237 ms | 676.339 ms | 707.856 ms |
| OPA evaluation | 1.420 ms | 1.489 ms | 1.553 ms |
| Isolated Runner provider | **68.537 s** | **71.162 s** | **73.689 s** |
| Total | **69.171 s** | **71.840 s** | **74.381 s** |

The Runner provider accounts for approximately **99.08%** of its mean total duration. The authorization layer is therefore small compared with full dependency/test/build/browser execution.

The Runner samples must not be pooled with ordinary Gitea operations when describing interactive authorization latency.

## By operation

| Operation | n | Verification mean | Provider mean | Total mean | Total p50 | Total p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `read_file` | 70 | 626.845 ms | 41.241 ms | **669.795 ms** | 699.718 ms | 760.630 ms |
| `update_file` | 50 | 630.708 ms | 269.823 ms | **902.111 ms** | 967.802 ms | 1015.648 ms |
| `create_branch` | 5 | 566.326 ms | 298.390 ms | **869.498 ms** | 880.605 ms | 1100.435 ms |
| `create_file` | 5 | 629.500 ms | 274.971 ms | **906.007 ms** | 946.581 ms | 1131.635 ms |
| `create_pull_request` | 5 | 554.861 ms | 274.603 ms | **831.827 ms** | 880.873 ms | 929.231 ms |
| `run_tests` | 5 | 632.237 ms | 68.537 s | **69.171 s** | 71.840 s | 74.381 s |

The measurement evidence also preserves every individual execution row, enabling later statistical analysis without relying only on the summary table.

## Data-quality decision

The earlier exploratory campaign `37438980717` is **not part of the reference dataset**.

It exposed two independent issues:

1. one replica failed before experiment execution because the Foundry installer received an external HTTP 500;
2. another replica exposed a flaky generated Playwright locator: immediately after clicking Alice Romano, the test could still observe the list route and `getByText("ACTIVE")` matched three user badges.

The Playwright test was stabilized by waiting for `/users/usr-001` and scoping lifecycle assertions to `.detail-header`. Matrix parallelism was reduced to three. The clean campaign was then rerun from a single new commit and achieved **5/5 successful replicas**.

The stabilization did not weaken the product or researcher acceptance criteria. Full regression run `37439708773`, security run `37439708739` and reproducibility run `37439708780` all completed successfully on the same stabilized commit.

## Evidence

Aggregate artifact:

- name: `phase12c-aggregate-evidence`;
- artifact id: `11401146619`;
- SHA-256: `67d30cb54e052fad320b9155599558391004fe6072a7ca290908af232c09d150`;
- retention: 90 days.

It contains:

- `phase12c-summary.json`;
- `phase12c-executions.csv` with all 140 execution rows.

A compact machine-readable reference copy of the principal results is committed at:

`poc/experiments/phase12c-reference-summary.json`

## Interpretation boundary

These numbers characterize this PoC and its pinned local/CI environment. They should not be presented as universal SSI or blockchain performance figures. The verifier currently performs the complete configured EVM-backed trust/public-material/status resolution path, while Gitea, OPA and Anvil run locally on the same hosted CI runner.

For the thesis, the strongest defensible conclusions are comparative: where time is spent inside the implemented architecture, whether enforcement remains fail-closed, and whether repeated executions preserve the same successful security/functionality outcome.
