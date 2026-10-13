# Reproducibility and Measurement Protocol

This document distinguishes the frozen measured PoC campaign from the current ADK/A2A/shared-MCP dependency and runtime contract.

> **Scope of the evidence.** The run IDs, artifact hashes, summary statistics and machine-readable manifest in this document describe the historical measured executable-code checkpoint `cbadb5440db408d4047d4eb870a9fb231362414a`. The later `refactor/core-cleanup` branch is a separate post-measurement code evolution. Its regression status must be established independently, and these historical measurements must not be attributed to that refactored code unless a new measurement campaign is executed.

The file `poc/experiments/reproducibility-manifest.json` is intentionally retained as the contract for the historical measured campaign; it is not silently rewritten to describe the refactored candidate.

## Current ADK/A2A/shared-MCP contract

`poc/experiments/adk-mcp-reproducibility-manifest.json` is the default contract for the current checkout. It records the reference architecture SHA and hashes of `Cargo.lock`, `blockchain/did-client/package-lock.json`, `poc/package-lock.json` and `poc/mcp-shared/package-lock.json`. The separate legacy `poc/adk-spike` workspace is not part of the canonical path. The checker also verifies that the historical measured manifest is unchanged.

This contract is **not** evidence of a successful Gemini run or a new performance campaign. It contains no copied historical run/artifact results. Reports identify the actual checked-out Git commit, label their contract scope, and leave the measurement schema null for the current contract. A lightweight local check validates files; only `PHASE12_VERIFY_RUNTIME=1` additionally certifies the installed runtime versions.

The historical manifest remains byte-for-byte unchanged. To reproduce historical results, check out the recorded historical framework revision and follow its instructions. Applying its dependency hash to today's checkout correctly fails.

## Reproduce a specific experimental run

A measurement bundle records the framework commit SHA and workflow run ID that produced it. To reproduce that run, check out the recorded framework SHA rather than the moving `main` branch.

The protected application always starts from:

- repository: `DarkGh0st03/iam-console-poc`;
- baseline SHA: `405748b1e77992b6bd8630a3ab6f990658d32f6b`;
- baseline branch: `baseline-before-account-suspension`.

The positive experiment creates `feature/account-suspension` from that exact baseline. `main` is not mutated and merge remains human-only.

## Historical frozen runtime contract

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

`Cargo.lock`, `blockchain/did-client/package-lock.json`, and `poc/package-lock.json` are committed.

Each checkout has its own committed dependency tree. CI installs the current PoC tree with `npm ci`; the current contract checks all four active lockfile hashes even when no optional lock environment variable is set. Historical evidence bundles retain their original lockfile and manifest. Dependency updates must explicitly update the current contract and pass regression; never replace the historical hashes to make a current run pass.

## Validation

Run the lightweight reproducibility check with:

```bash
npm --prefix poc run experiment:repro-check
```

The dedicated GitHub Actions workflow runs automatically on pull requests and main pushes, tests rejection of dependency/historical-manifest drift, and additionally installs the exact Rust and Foundry versions, installs the committed PoC npm tree with `npm ci`, validates the runtime and lockfile hashes, and uploads both manifests and the checked lockfiles in a `phase12b-reproducibility-evidence` artifact.

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

## Historical final validated reference

Final executable-code checkpoint:

`cbadb5440db408d4047d4eb870a9fb231362414a`

Final full regression:

- run `37448047612` — success;
- Phase 12A artifact `11405535262`;
- artifact SHA-256 `e03cdd0b391a3a1064dcd83527ec9669475c36d58e7f12f720e04560a828dc73`.

Final security suite:

- run `37448047677` — success.

Final reproducibility contract:

- run `37448047526` — success;
- artifact `11403313725`;
- artifact SHA-256 `dd9f6db184cdf96eb01f3d93a5dfb87076009289c04dbc6d51651ef16db17235`.

Final five-replica measurement campaign:

- run `37448047642` — success;
- 5/5 positive E2E replicas;
- 140 authorization samples;
- aggregate artifact `11405060742`;
- aggregate SHA-256 `94aebc164f66b7087f55b3b749d40bdabcfe70f89b909e10b6e5793ca746fe96`.

The earlier run `37439708880` remains only as a pre-hardening comparison. It is not the final thesis measurement reference because the integrated Adapter did not yet perform authenticated Status List JWT verification.

See `docs/MEASUREMENT_RESULTS.md` and `poc/experiments/phase12c-reference-summary.json`.
