# R305 — scripted native Backend → Frontend → Test, one permission-only approval

## Status

This milestone adds an isolated **scripted architectural test** and a
dedicated disposable GitHub Actions workflow. It must not be reported as
SUCCESS until the native Rust/EVM + OPA + Gitea + real Docker workflow
passes on the same SHA as Fast CI. There are **no Gemini model calls**.

## Trust sequence

1. The trusted CI owner imports the exact unsolved baseline and, before
   approval, stages a completed reference implementation strictly to test
   the real acceptance pipeline. It additionally creates two harmless
   proof files (Backend and Frontend) that are deliberately **not**
   functional Account Suspension implementation.
2. The Engineer signs **one immutable permission-only grant** covering
   Backend `update_file` under `apps/backend`, Frontend `update_file`
   under `apps/frontend`, and Test `run_tests` on the feature branch.
   No agent assignments, DAG or Task signatures enter the grant.
3. The Coordinator registers the following Task dependencies:
   Backend epoch 1 → Frontend epoch 2 → Test epoch 3.
   The Gateway binds each Task to an independently issued native
   Child DC, with a separate credential ID and immutable permission.
4. Backend performs a real old-HEAD/old-blob Gitea atomic CAS. The
   independent authenticated receipt must attest the exact commit
   before the Frontend Task can proceed.
5. Frontend explicitly **rejects the old Engineer base revision**,
   pins Backend's newly attested HEAD, then performs its *own*
   `update_file` CAS on the frontend proof file. The second Child VP,
   EVM status/revocation, real OPA decision, durable mutation intent,
   one-shot attempt, independent Gitea commit verification, HMAC
   receipt and Task completion are all required.
6. Test then pins the **Frontend** commit (not the base or Backend
   commit), verifies its independent Child VP and OPA, launches
   the real protected Docker Runner only once and independently
   attests all project tests and researcher acceptance PASS.
7. Wrong scope, wrong challenge, replay, foreign Child, revoked
   Engineer root and legacy provider fallback are denied. Gitea
   `main` must remain unchanged and the published audit event must
   report `provider_calls:2`, `legacy_writes:0`,
   `runner_posts:1`, `dependent_tasks:3` and
   `paid_model_calls:0`.

## Critical scope limitation

The full functional Account Suspension code is **owner-supplied as a
reference before approval**. The two real delegated Gitea CAS effects
are nonfunctional proof files. This is a strong integration
demonstration of the **three-agent authority and dependency framework**,
NOT yet proof of autonomous Gemini Backend/Frontend code generation,
dynamic LLM task planning, recovery from genuine functional errors or
a review-only PR. The final pilot must start from an UNSOLVED baseline,
make substantive functional edits *through* the delegated agent Tasks,
pass independent acceptance, and open (not merge) a protected PR.

## Execution policy

Fast CI checks the script syntax and offline contracts. The isolated
R305 workflow is triggered only by a deliberate change to
`.github/ci-checkpoints/r305-docker-request.json` or manual dispatch,
avoiding repeated expensive native Rust/Docker builds on every commit.
No paid LLM is permitted.
