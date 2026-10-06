# Phase 12C Final Reference Measurement Results

This document records the **final hardened** repeated measurement campaign for the thesis PoC.

## Final dataset

Reference GitHub Actions run:

`37448047642`

Framework code checkpoint:

`cbadb5440db408d4047d4eb870a9fb231362414a`

This is the first five-replica campaign after the final audit hardening: authenticated Status List JWT verification, direct Solidity regression coverage, committed npm dependency lock and Gitea `main` protection are all active.

Five independent replicas of the same pinned Account Suspension positive E2E completed successfully.

Each replica executed 28 Gateway authorizations:

- 27 protected Gitea operations;
- 1 exact-SHA Controlled Runner operation.

The final reference dataset therefore contains **140 authorization executions**:

- **135 Gitea executions**;
- **5 Runner executions**.

All five replicas passed project tests and researcher-owned acceptance, created a Pull Request only after the exact-SHA test gate, left the protected application baseline unchanged and performed no automated merge.

## Ordinary protected Gitea path

| Metric | Mean | p50 | p95 |
| --- | ---: | ---: | ---: |
| Preparation | 0.186 ms | 0.132 ms | 0.391 ms |
| SSI/EVM + authenticated Status List verification | **1598.406 ms** | **1669.083 ms** | **1704.448 ms** |
| OPA evaluation | 1.800 ms | 1.562 ms | 2.945 ms |
| Gitea provider execution | 172.116 ms | 227.304 ms | 357.550 ms |
| Total authorization + execution | **1772.341 ms** | **1716.047 ms** | **1993.305 ms** |

At the arithmetic-mean level the Gitea-path total is approximately:

- **90.19%** verification;
- **0.10%** OPA;
- **9.71%** protected Gitea execution;
- the remaining fraction is request preparation/rounding.

The dominant cost is therefore the complete SSI/EVM verification path. OPA remains negligible in comparison.

## Cost of the final JWT hardening

The earlier clean pre-hardening campaign `37439708880` used the same high-level experiment but did not yet authenticate the off-chain Status List document as an EdDSA JWT in the integrated Adapter profile.

Pre-hardening Gitea-path values:

- verification mean: `623.467 ms`;
- total mean: `777.984 ms`.

Final hardened values:

- verification mean: `1598.406 ms`;
- total mean: `1772.341 ms`.

In this CI PoC, adding the complete JWT/DID authentication path increased mean verification latency by approximately **156.4% (2.56x)** and mean Gitea-path total latency by approximately **127.8%**.

This comparison is useful for the thesis because it quantifies the security-hardening cost under the same architecture. It should not be generalized as a universal cost of SSI/JWT/DID verification.

## Controlled Runner

The Runner is analyzed separately because it executes the complete isolated project validation suite.

| Metric | Mean | p50 | p95 |
| --- | ---: | ---: | ---: |
| SSI/EVM + JWT verification | 1642.933 ms | 1667.339 ms | 1693.533 ms |
| OPA evaluation | 1.644 ms | 1.587 ms | 2.017 ms |
| Isolated Runner provider | **68.677 s** | **69.045 s** | **70.589 s** |
| Total | **70.322 s** | **70.720 s** | **72.284 s** |

The Runner provider accounts for approximately **97.66%** of mean Runner duration. Even with JWT hardening, authorization remains small compared with dependency installation, build, tests and browser execution.

Runner samples must not be pooled with ordinary Gitea operations when describing interactive authorization latency.

## By operation

| Operation | n | Verification mean | Provider mean | Total mean | Total p50 | Total p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `read_file` | 70 | 1639.915 ms | 53.028 ms | **1694.686 ms** | 1697.795 ms | 1780.633 ms |
| `update_file` | 50 | 1641.348 ms | 292.867 ms | **1935.794 ms** | 1964.851 ms | 2007.980 ms |
| `create_branch` | 5 | 1087.239 ms | 262.981 ms | **1355.436 ms** | 1356.495 ms | 1381.401 ms |
| `create_file` | 5 | 1635.979 ms | 295.169 ms | **1932.623 ms** | 1937.358 ms | 1958.238 ms |
| `create_pull_request` | 5 | 1061.446 ms | 417.909 ms | **1481.618 ms** | 1380.920 ms | 1895.960 ms |
| `run_tests` | 5 | 1642.933 ms | 68.677 s | **70.322 s** | 70.720 s | 72.284 s |

The aggregate artifact preserves all 140 execution rows, so later statistical analysis is not limited to these summaries.

## Final validation set

All final runs use framework code checkpoint `cbadb5440db408d4047d4eb870a9fb231362414a`:

- full baseline/regression: `37448047612` — **success**;
- Phase 11 security experiments: `37448047677` — **success**;
- Phase 12 reproducibility contract: `37448047526` — **success**;
- Phase 12 five-replica measurement campaign: `37448047642` — **success**, 5/5 replicas.

The protected application GitHub repository remained frozen at:

`405748b1e77992b6bd8630a3ab6f990658d32f6b`

for both `main` and `baseline-before-account-suspension`.

## Evidence

Final aggregate artifact:

- name: `phase12c-aggregate-evidence`;
- artifact id: `11405060742`;
- SHA-256: `94aebc164f66b7087f55b3b749d40bdabcfe70f89b909e10b6e5793ca746fe96`;
- retention: 90 days.

The artifact contains:

- `phase12c-summary.json`;
- `phase12c-executions.csv` containing all 140 final execution rows.

The final full-regression Phase 12A artifact is `11405535262` (SHA-256 `e03cdd0b391a3a1064dcd83527ec9669475c36d58e7f12f720e04560a828dc73`).

The final reproducibility artifact is `11403313725` (SHA-256 `dd9f6db184cdf96eb01f3d93a5dfb87076009289c04dbc6d51651ef16db17235`).

## Data-quality history

Two earlier campaigns remain useful as audit history but are **not** the final thesis reference:

- `37438980717`: exploratory campaign; excluded because one replica hit an external Foundry HTTP 500 and another exposed a flaky Playwright locator;
- `37439708880`: clean pre-hardening reference; 5/5 successful and retained only to quantify the cost of adding authenticated Status List JWT verification.

The final reference is exclusively `37448047642`.

## Interpretation boundary

These measurements characterize this PoC, its pinned implementation and the GitHub-hosted/local-service CI environment. They are not universal performance claims for SSI, Ethereum, JWT or DID systems.

The defensible thesis conclusions are architectural and comparative: the implementation remains fail-closed, OPA contributes negligible positive-path latency, authenticated SSI/EVM verification dominates ordinary protected operations, and the real Controlled Runner dominates full-test execution time.
