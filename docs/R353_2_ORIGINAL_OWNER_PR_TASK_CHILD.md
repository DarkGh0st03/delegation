# R353.2 — Original Engineer PR Task and Child admission

The original Engineer execution handle now offers `proposeAndStageVerifiedPullRequestTask`. It requires an existing signed `create_pull_request` root grant and a trusted Orchestrator registry identity before invoking the model. All previous work must be independently completed, except the original failed Test after a verified D1 replacement PASS.

The ADK proposer has an explicit owner-selected PR decision kind. Model output cannot choose that mode. Its candidate must contain only the exact repository PR permission, use the Orchestrator identity and depend directly on the original latest completed Test. The host reopens authenticated Runner evidence and Gitea HEAD both before and after the model turn. No Task or Child is issued when authority, dependency, evidence or HEAD is invalid.

The original Coordinator registers the PR Task and the original Child issuer and Gateway enroll a dedicated Child under the unchanged root. The tested SHA, source Test IDs, Runner receipt digest and exact model instruction are retained only in private owner state for the subsequent provider bridge. Admission is one-shot and does not create a PR or mark the Task complete.

Free SDK integration variants cover positive original-root PR admission, missing Engineer PR grant (zero model calls), incorrect Test dependency and HEAD movement during the model call (zero new Children). The positive case rejects admission before Test attestation and replay after enrollment. Native Rust signing/provider responses remain offline fixtures in these tests; no new native EVM/Docker proof is claimed.

Scope boundary: the Gateway still denies create_pull_request execution. Next connect the private PR pin to canonical Prepare, a durable one-shot effect flight, native VP/OPA validation and a Gitea POST pinned to the tested HEAD. No paid inference, merge or main-branch mutation.

## R353.3 issuer role contract

The first integrated positive test reached Coordinator registration but was rejected by the Child issuer's old three-specialist allowlist. The native Rust dispatcher already supports the authenticated Orchestrator role. The TypeScript port/issuer now admit that identity only for a single repository `create_pull_request` grant; all original root, epoch, status, scope and signed-response checks remain. A regression ensures this does not admit Orchestrator read/write Children. The original positive PR Task test must pass in Actions before this admission gate is considered validated.
