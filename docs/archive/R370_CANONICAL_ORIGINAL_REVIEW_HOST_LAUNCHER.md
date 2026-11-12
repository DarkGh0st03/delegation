# R370.0 — Canonical original Review Host operational launch (owner-private)

## Why this exists

R369 proves a complete original Review Host native E2E ending in one
independently attested Draft PR. But the **fixture** still had to manually
choreograph SDK Owner startup, adaptive Task delegation and PR flight stages.
R370 moves those *transition rules* to a reusable owner-private module,
**without creating a second Coordinator, Gateway, Child issuer or approval**.

The new `poc/apps/orchestrator/src/trusted-authority-only-operational-launcher.mjs`
contains the execution sequence. The sole public runtime route is
`execution.runCanonicalOperationalWorkflow({sdk,adaptive,draftPullRequest?})`,
a method bound to the **original** in-process
`createTrustedAuthorityOnlyReviewHost(...).admitOperationalExecution(...)`
handle. It cannot be called over Engineer HTTP, MCP, A2A or GitHub OIDC.

## Trusted operator boundary

A trusted service owner still MUST, in the same process:

- start the original read-only Planning and obtain a genuine independently
  reviewed, signed Engineer permission-only approval;
- issue the distinct operational Rust root, admit the canonical Gateway,
  bind real native preflights/evidence, and provision three private SDK
  A2A IPC channels and agent endpoints;
- supply a bounded ADK decision model plus owner-controlled short-lived
  Child metadata; neither is allowed to change the signed permission ceiling;
- explicitly opt into a Draft PR by supplying a **separate** PR decision
  model and private native Gateway Prepare + root Rust VP/Execute callbacks.

The launcher alone **does not** configure a machine or deploy a process,
authenticate a human, approve permission pairs, choose secrets or supply
a CLI/file-based operator configuration. No connected runtime/model can
invoke it through a network surface. A production supervisor still needs
to compose the trusted service dependencies.

## Guarded execution

1. Start the protected original SDK A2A owner (which may have zero Tasks).
2. Run the original host's adaptive ADK loop, which can register and
   independently attest Backend/Frontend/Test and bounded recovery.
3. On verified latest Runner PASS, either return **readiness only**
   (default, no PR), or use the separately approved root PR capability.
4. Generate the PR Task runtime ID inside the trusted launcher.
5. Let the original Host propose and enroll a root-owned Orchestrator Task
   depending on the last authenticated Test; no Worker Child for the PR.
6. Perform a fresh original Gateway Prepare, validate exact signed
   `create_pull_request` scope, then reserve one durable original PR
   flight **before** the private native Rust VP/OPA/Gitea execution.
7. Only after independent original Gateway completion and a separately
   pinned Gitea Draft PR GET return a redacted, immutable success result.
   No raw signed VP, challenge, credential or PreparedRequestRecord escapes.

A failed or uncertain POST is not retried. Merge is never invoked.

## Evidence

The new R370 native workflow uses **this host-bound launcher** in the
R369 disposable Gitea/Anvil/EVM/OPA/Docker environment with free
scripted ADK models and an owner-seeded functional Account Suspension
fixture. It checks 3 real native Child credentials, 4 separately
completed Gateway Tasks, 2 real Gitea CAS commits, one real Docker
PASS and one independently observed open, unmerged Draft PR at the
tested HEAD. Fast tests check no-PR readiness, denied PR grants,
unexpected SDK/transport inputs, stale Task pins and execution order.

This checkpoint is **not** proof of autonomous generative Gemini,
a production-deployed launcher, real GUI human approval, or branch
creation from an initially unresolved main in the same pipeline.
R370 native validation remains unproven until CI confirms SUCCESS.
No billable inference and no mutation of production GitHub/main;
GitHub PR #38 remains Draft and unmerged.
