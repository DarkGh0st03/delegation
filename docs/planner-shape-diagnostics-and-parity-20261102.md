# Planner shape diagnostics and experiment parity

Baseline inspected: a1a6f8533bfb3507f3bc31a24a6cfb4e4e8ddd8f.
Failed pilot: 41484581253. Its retained evidence reports invalid_proposal_shape;
the original offending value/field cannot be reconstructed from that category.
This change improves future diagnostics; it does not establish the historical cause.

## Diagnostic change

The four existing shape checks retain identical acceptance conditions.
Their static reason codes now distinguish fields/object/list/string and
proposal/task/permission level. No model field names, values, IDs, paths or
source contents are included. Unknown exceptions still use the generic fallback.
The same-session bounded feedback and all three diagnostic allowlists preserve
the new codes. Functional guidance, permissions and execution preflight are unchanged.
Permission-array cardinality retains invalid_permissions; task-array cardinality
retains invalid_task_count, as before.

## Current parity comparison

| Input | Isolated Account Suspension | Real pilot |
|---|---|---|
| Compiler and functional guidance | TrustedAdkReadOnlyPlanner | Same module |
| Execution validator | preflightApprovedPilotDag | Same function |
| Requirement / branch | approved scenario constants | approved scenario constants |
| Model thinking | LOW | LOW |
| Model turns | 20 | 24 |
| Output tokens per call | 12000 | 12288 |
| Session deadline ms | 180000 | 600000 |
| Call deadline ms | 120000 | 180000 |
| Proposal revisions | 2 | 2 |
| Reads | in-memory port | authenticated Gateway / Rust / OPA / disposable Gitea |
| Revision identity | synthetic fixture fingerprint | live pinned Gitea revision |
| Plan ID | isolated_account_suspension_v1 | native-planning-proposal |

Sources: poc/scripts/run-gemini-planner-fixture.mjs;
poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs;
poc/scripts/signed-gemini-pilot-consent.mjs.

The fixture contains pinned unsolved source, but equivalence of the complete
live inventory and all returned read envelopes has NOT been demonstrated.
Identical shared compiler code does not make the model inputs equivalent.

## Next bounded change

Reuse the real pilot bootstrap and authenticated preliminary-read path for a
planning-only mode. Stop before Engineer approval and operational root issuance.
Use the same configuration object for both modes and compare normalized input
manifests (requirement, inventories, source hashes, budgets, validator identity).
Do not claim parity until an offline real-Gitea comparison passes. No new paid
run is authorized by this diagnostic change.

F2-F5 remain scripted validations. F3 still uses OfflineIntegrationReviewModel
and attested metadata, not a generative semantic diff review.

## Validation

Planner unit suite and fixture/failure-observation regressions executed locally.
Local Node: 24.22.1 (CI remains pinned to 22.15.0); CI validation remains required.

## Shared configuration follow-up

`account-suspension-planning-config.mjs` is now consumed by both existing
entrypoints. It preserves their previous budgets exactly. The reserved
`real-planning-only` profile equals the pilot profile field for field.
This profile does not enable execution or authorize billing.

23 focused config/fixture/consent tests pass locally. The parity tests are
included in Planner Feasibility CI. The real-Gitea stop-before-approval mode
and its end-to-end proof are still pending; configuration equality alone is
not input or transport equivalence.
