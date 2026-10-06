# Reproducibility and Measurement Protocol

This document freezes the environment and evidence contract used for the final thesis PoC experiments.

## Reproduce a specific experimental run

A measurement bundle records the framework commit SHA and workflow run ID that produced it. To reproduce that run, check out the recorded framework SHA rather than the moving `main` branch.

The protected application always starts from:

- repository: `DarkGh0st03/iam-console-poc`;
- baseline SHA: `405748b1e77992b6bd8630a3ab6f990658d32f6b`;
- baseline branch: `baseline-before-account-suspension`.

The positive experiment creates `feature/account-suspension` from that exact baseline. `main` is not mutated and merge remains human-only.

## Frozen runtime contract

The machine-readable source of truth is:

`poc/experiments/reproducibility-manifest.json`

The validated environment pins:

- Ubuntu 24.04 CI;
- Node.js 22.15.0;
- npm 10.9.2;
- Rust 1.99.0;
- Solidity 0.8.24;
- Foundry v1.8.4;
- A2A JavaScript SDK 1.3.0;
- Gitea 28.0.0;
- OPA 1.21.1;
- Runner image `node:22.15.0-bookworm`;
- Anvil chain id 31337.

The hosted GitHub runner image build is recorded as evidence but is not treated as a stable external interface. The language/toolchain and service versions above are the reproducibility boundary.

## Dependency resolution

`Cargo.lock` and `blockchain/did-client/package-lock.json` are committed.

The PoC workspace historically did not commit an npm lockfile. Phase 12 therefore resolves a `poc/package-lock.json` during the experimental run and uploads that exact resolved tree alongside the measurement/reproducibility evidence. A reproduction of a specific run should use the lockfile attached to that run.

## Validation

Run the lightweight reproducibility check with:

```bash
npm --prefix poc run experiment:repro-check
```

The dedicated GitHub Actions workflow additionally installs the exact Rust and Foundry versions, resolves the PoC npm lockfile, validates the runtime, and uploads a `phase12b-reproducibility-evidence` artifact.

The main `PoC Baseline Validation` workflow also supports `workflow_dispatch`, allowing an explicit rerun of the complete positive E2E against the frozen protected baseline.

## Measurement evidence

The positive E2E emits Gateway JSON-line audit events. Phase 12A converts those events plus the experiment result into:

`phase12a-measurement-evidence/v1`

The bundle contains:

- framework commit SHA and GitHub run identity;
- protected baseline and exact final tested feature SHA;
- project-test and researcher-acceptance verdicts;
- effective model IDs;
- operation/provider counts;
- per-authorization `prepare_ms`, `verification_ms`, `opa_ms`, `provider_ms`, and `total_ms`;
- VP size;
- delegation chain depth;
- disclosed permission count;
- Runner exact-SHA evidence.

Summary statistics use count, minimum, maximum, arithmetic mean, p50 and nearest-rank p95. The full per-operation records remain in the bundle so alternative analysis can be performed later.

The Runner execution is intentionally visible as a high-latency provider outlier rather than removed from the raw data. Analyses comparing authorization overhead should therefore report provider-specific or operation-specific distributions in addition to the aggregate total.

## Evidence integrity and privacy

Measurement/reproducibility bundles must not include full signed VPs, bearer credentials, private keys, repository service tokens or researcher acceptance source modifications.

Researcher-owned acceptance tests remain outside specialized Agent write authority and are mounted read-only into the Controlled Runner.

## Validated Phase 12A reference

GitHub Actions run `37435049292` successfully produced and uploaded the first measurement evidence bundle while the complete regression suite and Phase 10B positive E2E remained green.


## Reference repeated campaign

The clean five-replica reference campaign is GitHub Actions run `37439708880`, framework SHA `f457f6f194497f9567f67ae72cdb465085c65ca5`.

All five replicas passed the complete positive E2E, producing 140 authorization samples. The aggregate artifact is `phase12c-aggregate-evidence` (artifact `11401146619`, SHA-256 `67d30cb54e052fad320b9155599558391004fe6072a7ca290908af232c09d150`).

See `docs/MEASUREMENT_RESULTS.md` for the interpretation and `poc/experiments/phase12c-reference-summary.json` for the compact machine-readable reference values.
