# R301 — real sequential native Rust/EVM/OPA/Gitea acceptance

Stage implementation: `be324b4a52a548ea1b3f4489aad11fdadb4c6287`
and later corrections. This run builds on the **R300 real hierarchical
Gitea read SUCCESS**, but uses a second independent evidence entry.

## Disposable acceptance scenario

1. Trusted CI fixture seeds two regular files under
   `apps/backend/users/` **before** the synthetic CI Engineer signs.
2. Engineer signs one recursive directory `read_file` grant.
3. Coordinator registers one Backend Task with exactly two narrower
   file permissions; native Rust issues one Child DC for both leaves.
4. Gateway pins a **two-effect** private manifest, Child DID/root,
   Task, revision and dynamic session authority.
5. Backend signs a separate VP for each concrete file, with a distinct
   Prepare request and challenge. Independent Rust verifier proves
   the selected leaf's signed authorization, historical EVM accumulator,
   status and trust; OPA must independently allow.
6. First Gateway read succeeds and produces an HMAC receipt that is
   independently corroborated against the real Gitea HEAD/blob/content.
   *Before* that evidence, the second effect cannot acquire its
   one-time durable flight. Task completion also remains unavailable.
7. Only after the first independent result evidence is journaled can
   the second distinct Gitea read execute. Both receipts are chained,
   and Task finalization requires an additional durable final marker.
8. Attempted replay, permission escalation, sibling path, changed
   operation, other branch, foreign Child and revoked root must be
   denied. Expected provider invocation count: **2 read_file**; all
   writes/PR/Docker operations are out of scope.
9. An observed final Task count of 1 is only reported *after both*
   independent read attestations. It does not represent a full
   Account Suspension implementation.

## Gate and cost

`R301 Sequential Native Gitea Reads Rust EVM and OPA (No AI)`
runs only when `.github/ci-checkpoints/r301-native-evm-request.json`
changes or on manual workflow dispatch. Fast CI separately checks
syntax and the offline journal/Gateway tests. Reuse the same SHA for
both validations; do not start unneeded full CI suites.

No paid model requests, no external production tokens, no auto-merge to
`main`, and no trusted provider mutation via the Gateway.

## Not yet delivered

The new mode is **read-only** and the total expected effect count is
chosen by a trusted Gateway owner before executing. Extending this to
mutating Gitea effects requires fresh signed/independent mutation
evidence, branch precondition fencing and explicit uncertain-side-effect
reconciliation. The canonical GUI, dynamic autonomous Orchestrator,
Backend/Frontend/Test completion, Docker and review-only PR remain
separate milestones.
