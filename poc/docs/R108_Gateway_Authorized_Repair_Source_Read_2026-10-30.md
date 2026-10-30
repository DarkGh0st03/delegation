# R108 — Repair-source inspection over the existing delegated Gateway pathway

**Date:** 2026-10-30  
**Branch:** `refactor/post-prof-plan-contracts-20261021`

## Context and precise motivation

R104 introduced Gateway-corroborated failed Docker Runner evidence instead of falsely marking Test PASS. R105 allowed only transitive descendants of the failed Test to remain unexecuted, and added a bounded trusted feedback handoff. R106 compiled and durably reserved a repair DAG under the already-issued Rust operational DC. R107 pinned the feature SHA with an authenticated Gitea client and introduced a source-free ADK repair proposer.

The three real Gemini pilot runs previously produced compiler errors TS2820, TS2367, and TS2339. Real repair requires seeing the *current failed source*, not a hardcoded IAM Console file and not an outdated snapshot of `main`.

**The thesis security foundation remains the existing native Rust DC/VP chain, attenuation of ResourceURI/Operation pairs, accumulators, revocation, DIDs, Gateway and OPA.** This phase does not implement another authorization source. An Engineer's desired UI ultimately collects repo, branch, maximum exact pairs, and optional expiry; task assignments and retry budget are internal runtime concerns. The initial Engineer/plan binding in legacy activation is not yet fully migrated.

## What was implemented

- `TrustedOperationalEpochIntake.trustedRootReadGrants()` returns a host-private copy of the *actual* active Coordinator-issued Rust root grants, only after re-verifying the independently authenticated original Engineer approval and durable operational epoch history.
- `TrustedOperationalRepairSourceReader` is a host-owned, opt-in read-only port. It requires the *same* Gateway plan registry and root intake identities, the existing feature-head reader, a failed Test Task ID, an actual **separately authorized read Task** and a private mechanism to produce a signed VP for a fresh Gateway challenge. The model never sees that VP, a credential, or a Gitea token.
- A requested repository-relative file path is first canonicalized to a branch-scoped ResourceURI. It must have the exact `read_file` pair on the issued Rust root; wildcards or inferred grants are not accepted.
- The source reader also calls `prepareTrustedRepairFeedback()` to require an already **Gateway-confirmed terminal failed Docker Test** at the exact same session, root, epoch, work branch and `tested_commit_sha`. An arbitrary host-model SHA is insufficient.
- The reader obtains feature HEAD from `TrustedOperationalFeatureHeadReader`, performs normal `GatewayRuntime.prepare({tool:"read_file",...})`, requests the signed VP from the host signer callback, and invokes normal `GatewayRuntime.execute(...)`. The ordinary Gateway path independently checks task-bound scope, verified VP/native Rust verifier (when configured), OPA and Gitea provider effects. The reader rejects wrong provider/tool/path/branch/SHA, excessive size, epoch drift and branch movement during the read.
- Strict budgets: 4 attempted source reads, at most 32 KiB per file, 64 KiB cumulative, no concurrent reads. Failed attempts consume budget; read results are frozen.
- `TrustedAdkOperationalRepairProposer` now has an **optional** `read_file` FunctionTool bound to that reader. When enabled, it requires at least one successful protected source read before accepting a draft, limits ADK delegate invocations to 5, and fails the entire proposal if any unauthorized source request occurred. The old source-free mode retains 1 model call and no tools.
- `GatewayRuntime.hasExactTrustedOperationalPlanGate()` and `TrustedApprovedExecutionPlans.isBoundToOperationalEpochIntake()` prevent attaching a source reader to an unguarded or foreign Gateway session.

## Offline test coverage

- The concrete GatewayRuntime Prepare/Execute methods are used in an invoice-service fixture after a Test FAIL. The harness's verifier, OPA policy and Gitea provider are **mocks**; nevertheless the task/permission binding logic and all control-plane transitions execute.
- A root grant without an active read Task is rejected **before VP issuance and before provider I/O**.
- An authorized Task without a corroborated failed Docker Test is likewise rejected before exposing source.
- Missing root read grant, illegal file paths, revoked root, completed Task, unguarded Gateway and mismatched gate ownership fail closed.
- R107/R106 separate tests continue covering scripted ADK, one-shot proposal, verified SHA, fresh epoch under existing Rust parent and mocked Backend correction -> Test PASS.

## Explicit remaining gaps and risks

1. **Not yet a live native Rust cryptographic read test.** This increment's source-read harness supplies an offline signed-VP fixture to the mocked verifier. Native Rust/OPA/DC/VP are independently validated in existing CI, but a *single* read-after-failure chain using actual child DC and VP still needs to be exercised.
2. **Not yet general-purpose autonomous post-failure discovery.** The source reader requires an approved operational read Task already present and bound. Under the current legacy original signed DAG, an arbitrary new read Task cannot be introduced merely because the root has the pair. A dedicated trusted repair-discovery delegation phase, derived from the **existing Rust root** and admitted by Gateway, is necessary; do not bypass this by giving Gemini a Gitea token.
3. The model can now make an authorized `read_file` tool call if an active authorized source reader is supplied, but this mode has not yet run an integrated ADK tool-call + real signed VP + native Rust + actual Gitea experiment. Separate source-reader and ADK tests should not be misrepresented as that result.
4. The Rust root's grants remain tied to initial plan grants; migrating Engineer consent to maximum pair approval independent of Task IDs is still important. Do not replace the Rust root with a second application approval envelope.
5. The strict internal three-epoch limit is unrelated to model provider billing. No independent monetary hard cap has been established in this increment and no paid Gemini call was made.

## Next step

R109 should build an owner-private **repair-discovery Task/child DC admission path**, under the same already-issued Rust authority, so the Planner can inspect source before deciding which Backend/Frontend Tasks to create. Prove its authenticated exact-SHA read with a real VP, Rust Core, OPA and disposable Gitea first. Then connect the ADK bounded read tool and new Task DAG dispatcher for a no-billing Docker FAIL -> repair -> PASS -> PR in one protected end-to-end run.

No merge to `main`; no paid Gemini provider calls.
