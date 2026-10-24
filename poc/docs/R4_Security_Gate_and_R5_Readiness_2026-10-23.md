# R4 security checkpoint and R5 readiness (23 October 2026)

**Scope:** branch `refactor/post-prof-plan-contracts-20261021`, NOT `main`.
**Decision:** **R5 is NO-GO at this checkpoint.** Do not invoke paid Gemini
Developer API or merge a branch on the strength of an offline CI result.
This is a controlled evidence ledger, not a claim of human approval.

## What the current offline system really tests

| Boundary / threat | Canonical evidence | Meaning and limit |
|---|---|---|
| Model proposes extra permission | `poc/apps/gateway/test/approved-execution-plans.test.ts`; `poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts` | Unapproved operation and Engineer-signed permission subset fail closed; a signed digest alone is not Engineer authentication |
| Changed plan, task, agent, resource or DID | `approved-execution-plans.test.ts`; `trusted-reviewed-adk-dag.test.ts` | Bound Task and authenticated plan digest are checked independently of DC/VP/OPA |
| Source scope, unsafe path, unordered conflicting edits | `trusted-adk-planner.test.ts`; `offline-planning-dag.test.ts` | Compile unapproved proposals from a pinned repository inventory; production model source reads remain bounded |
| Main/branch tampering | Gateway provider, MCP and OPA tests; `poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs` | Approved work goes to its own feature branch; `main` is checked immutable in the disposable real Gitea scenario |
| Replayed, revoked or stale authority | Gateway execution tests and native Rust/EVM Planning-to-Execution test | One-shot Gateway request, VP verification, Planning root revocation and active lease are separately enforced |
| Task result spoofing | `poc/apps/gateway/src/approved-execution-plans.ts` and attestor regressions | A2A/model claims cannot independently mark a Task complete; trusted provider evidence and attestation are required |
| Unverified PR | `poc/apps/gateway/test/approved-execution-plans.test.ts`, `gitea-client.test.ts` | An Engineer-approved PR operation alone is insufficient: trusted completed Runner acceptance must pin the exact feature SHA; subsequent source edits invalidate it |
| Native end-to-end | `.github/workflows/cumulative-refactoring-offline.yml` | Both Account Suspension and Department Directory are scripted on one IAM-console baseline but use actual Rust/EVM, OPA, ADK/A2A, MCP, disposable Gitea, Docker acceptance and an open PR |

**Specific R4 changes:** `96ac687` exact-SHA PR gate; `c8a7d94`
preserves legacy Task-completion fixtures without giving them verified PR
authority; `9472dfe` missing Engineer permission/incomplete Runner/racing
Gitea response negatives; `140414f` rejects PR authorization after
subsequent approved source modification.

**Evidence checkpoint:** cumulative CI `39971531148` (commit `c8a7d94`)
completed successfully. For the later commit `140414f`, separate
`approved-plan-gate` run `39972755961` and `gateway-offline` run
`39972755952` succeeded. Cumulative run `39972755955` had four successful
jobs and the EVM job still running at this writing. **Do not promote that
checkpoint to fully green without independently checking its conclusion.**
CI: https://github.com/DarkGh0st03/delegation/actions/runs/39972755955

## Remaining security / experimental limitations

1. **The models in the unified real-provider E2E are offline scripted.**
   The two reference implementations target separate requirements on the
   **same** pinned IAM Console source tree with the historical file set.
   No claim of arbitrary project support or real Gemini-generated code.
2. **The PR race is detectable, not atomically preventable.**
   `GiteaClient.createPullRequest` compares the attested SHA with the
   preflight branch HEAD and requires the matching response SHA. If the branch
   changes during POST, Gitea may create a PR before the mismatch is detected.
   Such a response is rejected as attestation; no automatic merge follows.
3. **No deployed persistent trusted Engineer host.**
   `poc/apps/orchestrator/src/trusted-engineer-host.mjs` is loopback-only;
   it does not provide an authenticated remotely reachable runner-to-host
   channel or a deployed live Planning root/session.
4. **The old billable GitHub workflow is NOT the new canonical workflow.**
   `.github/workflows/gemini-paid-shared-mcp-final.yml` invokes
   `a2a-production-coordinator-mcp-gemini-live.mjs`, which uses
   `AccountSuspensionSequentialCoordinator` and the original fixed 11-file
   scenario. It does **not** run the new OIDC-admitted, independently signed
   Planning/Engineer approval pipeline. It must not be used as R5 proof.
5. **The no-cost manual workflow validates only event inputs.**
   `.github/workflows/trusted-gemini-dispatch-preflight.yml` does not
   create a root, authenticate the Engineer, execute agents or charge API
   credits. GitHub OIDC authenticates a workflow job, not human consent.
6. **Legacy cleanup is mandatory but must be evidence-driven.** Before R6
   deletes any files, inventory static/dynamic imports, npm scripts, Rust
   crates, workflow entrypoints, Docker/env configuration and external
   runners. Remove in small batches only after equivalence tests and
   independent real-provider acceptance. Do not delete paid historical
   evidence merely because it is not on the canonical path.

## R5 technical go/no-go checklist

**NO-GO until all are demonstrated on the same immutable commit:**

- [ ] Full cumulative R4 offline CI passes (five out of five), including both
      independently accepted real-provider software requirements and an open,
      unmerged PR; include exact run URL and head SHA.
- [ ] An authenticated *persistently running* Engineer host handles a real
      Planning session, provenance checkpoint and **independent human-signed**
      permission subset (not a scripted reviewer). Its root issuance/revocation
      and crash-recovery journal survive restart/failure.
- [ ] GitHub OIDC admission reaches that host over an authenticated channel.
      The token's repository/workflow/run/attempt/subject and source SHA are
      pinned independently; replay ledger and run freshness are enforced.
- [ ] The actually billable Gemini ADK Planner and three Agent roles use the
      **same approved** Task dispatcher, private MCP signing path, normal
      Gateway/native Rust/OPA and real provider stack. Do not redirect to the
      legacy `AccountSuspensionSequentialCoordinator`.
- [ ] Exactly scoped input/model/turn/token/time budgets, no retry on billable
      failure, limited API-secret exposure, capped account spend and abort
      procedure are confirmed **before** any request.
- [ ] Explicit fresh user approval to incur API charges is obtained; it is
      distinct from technical CI green, GitHub job authentication and the
      Engineer's Ed25519 plan authorization.

**After R5:** preserve experimental receipts and perform R6 dependency-graph
cleanup; then rerun every retained offline security and real-provider check,
before any R7 baseline freeze or decision on merging `main`.

Do not auto-dispatch a paid workflow, fabricate a human review, call
`merge_pull_request`, or change `main` from this checkpoint.

## R5 non-billable Planner budget hardening — 24 October 2026

The R6-29 cleanup baseline `adb1baa4b915a811630fbb299751c8df409e5ccf` passed
[cumulative offline CI #40100508975](https://github.com/DarkGh0st03/delegation/actions/runs/40100508975)
on all five jobs, same SHA.

Before any real paid Planner request, the canonical
`TrustedAdkReadOnlyPlanner` now configures an actual ADK
`generateContentConfig.maxOutputTokens` (default 8192, range
1..32000) and accepts a bounded per-call `maxModelCallMs` (default
60000, range 1000..360000). Existing turn count and trusted read budgets
remain active. Calls receive a combined cancellation signal and late
responses after the deadline fail closed. Offline regressions reject
bad budgets, inspect the ADK model request and exercise an uncooperative
scripted response after timeout.

**Limits:** AbortSignal delivery is cooperative; a provider that ignores
cancellation may still perform/bill a remote operation. These checks do
not create an overall Planner runtime budget, ensure live API spend caps,
prove the current Gemini model API supports an exact token cap, authenticate
a remote Engineer, or complete R5. A real host-level hard deadline,
credential-scoped provider abort/cleanup and account-level spend controls
remain necessary before explicit paid authorization.

Only mark this hardening verified after 5/5 cumulative offline CI on the
changed commit. R5 remains NO-GO; neither the archived paid workflow nor
`main` is changed, and no external model request was made.

### R5 Planner timeout regression correction (24 October 2026)

The first cumulative validation of Planner budgets, CI
[#40119952815](https://github.com/DarkGh0st03/delegation/actions/runs/40119952815)
on `61b2ad2938be9b5a99c072f4455e199a059e8b83`, found a **test
expectation error** in the scripted non-cooperative timeout case. The ADK
Runner reports a model-generation failure as an event; the trusted Planner
intentionally returns the generic fail-closed
`no verified read-only grounded proposal` denial rather than
propagating internal provider exceptions. The regression incorrectly
expected the internal `model call timed out or cancelled` text.

The focused correction requires the correct public fail-closed denial and
still separately asserts that the model received an **aborted** deadline
signal. This retains the timeout and token bounds and does not weaken any
policy or permission. Do not certify this follow-up until a new exact-SHA
five-job cumulative CI succeeds. R5 remains NO-GO.

### R5 Planner full-session acceptance deadline (24 October 2026)

On the separate refactoring branch, the read-only ADK Planner now
takes a `maxPlanningMs` session limit (default 300000ms; supported
range 1000..900000ms), in addition to its per-call
`maxModelCallMs`, `maxModelTurns`, output token budget,
and pinned/read-only Gitea tools. A single session abort signal begins
before ADK initialization, is combined with each model-call timeout,
and is rechecked after actual provider reads, ADK events, and plan
compilation. Even an upstream which ignores cancellation cannot have
a *late result accepted* as an Engineer-reviewable proposal. Tests
exercise an uncooperative scripted model and a late real-provider-shaped
source response. All operations remain offline and read-only.

This is a bounded **acceptance/cancellation guard**, NOT a hard
process-wide timer or a promise that a remote Gemini request ceases
billing on cancellation. External process supervision, authenticated
persistent Engineer host, API account spend cap, secure runner channel,
and explicit economic authorization remain mandatory before R5 GO.

Certify this increment only when all five cumulative offline jobs
pass on its exact framework SHA. Do not launch the archived paid
Gemini workflow or merge `main`.


### R5 Planning cancellation propagation and one-shot session (24 October 2026)

The canonical read-only Planner now reserves its proposal attempt **before
its first await**, prohibiting concurrent or repeated ADK inference under
the same Planner object. The already bounded session signal is passed through
TrustedPlanningGatewayReadPort, OrchestratorPlanningGatewayReadClient,
and the shared Gateway prepare -> Adapter VP -> Gateway execute transport.
Each stage checks cancellation before onward HTTP work and after parsing a
provider response. A retained Planning port also re-checks the trusted root
after its round trip, rejecting reads that finish after revocation.

Offline regressions exercise pre-cancelled reads, cancellation after a valid
Gateway prepare response (zero Adapter/execute calls), successful one-shot
Planning, and concurrent replay denial. Historical branch/PR operations
retain their old call signatures and are not connected to the new signal
by default. Neither the model nor an HTTP caller can authorize scope.

**Limits:** abort is cooperative across external HTTP processes; a request
already sent might have an irreversible side effect, and no timeout
substitutes for Rust revocation or Gateway leases. This is not a persistent
Engineer deployment, a live Gemini run, or account-level spend enforcement.
Certification requires 5/5 cumulative offline jobs on this exact SHA.
R5 remains NO-GO; no manual paid workflow or main merge.

### R5 trusted Planning checkpoint durable write (24 October 2026)

The authenticated, backend-signed Planning checkpoint store now supports a
trusted host-only `persistVerified(ticket)` operation, in addition to its
existing independent read-side Ed25519 verification. Its verification uses
out-of-band pinned backend public keys, repository identity, exact Planning
session, Gitea source SHA and work branch; never data from a model or an
incoming GitHub event. Validation happens before filesystem mutation.

Persistence requires a private owner-owned directory, uses exclusive
no-follow file creation at mode 0600, checks the bounded envelope size,
synchronizes the checkpoint inode and directory, and refuses to overwrite
an existing or incomplete session record. Both writer and loader check
file/directory ownership where supported. Offline regressions exercise a
valid roundtrip, a second attempted write, a modified/forged checkpoint and
an insecure owner-only directory. A half-written record remains a
fail-closed condition requiring operator reconciliation, not an automatic
retry.

This removes a manual raw-write step in the portable checkpoint path, but
DOES NOT deploy an Engineer process, start a live Gitea Planning root,
sign on behalf of a human, connect a remote GitHub job, or authorize paid
Gemini. Certify only on an exact-SHA five-job cumulative CI; R5 remains
NO-GO, and `main` remains untouched.

### R5 active Planning to durable checkpoint bridge (24 October 2026)

A dedicated **private in-process** `TrustedActivePlanningCheckpoint` bridges
an actual `TrustedExecutionCoordinator` in active Planning phase,
its identity-bound `TrustedPlanningGatewayReadPort`, the one-shot
`TrustedAdkReadOnlyPlanner`, the independently pinned Ed25519
`SignedPlanningCheckpointFileStore`, and the existing
`TrustedPlanningReviewGate`.

Only the direct model proposal grounded by an authorized Gateway/Adapter
VP/OPA/Gitea read may be signed by the backend; it is stored exclusively and
reloaded from owner-only disk before staging the immutable review packet.
Coordinator identity, session, Gitea SHA, work branch, root ID and active
phase are rechecked after asynchronous model inference and file writes.
The bridge is one-use and denies replays. Its backend key is kept strictly
out of ADK tools, A2A and HTTP, and no Engineer signature or operational
credential is produced. Tests use the actual Gateway transport and ADK
scripted model with mocked Rust/OPA/Gitea ports and independent backend
and Engineer keys. They reject mismatched coordinator/snapshot, bad key
material and a repeated stage.

**Boundary:** this is a private integration building block, not a live
persistent Engineer service, human approval, live native EVM verification,
or remotely admitted paid workflow. The Engineer service still needs
an owner-provisioned Planning root, trusted Gitea inventory and a
private signing-key bootstrap. A crash after durable checkpoint creation
must be reconciled, never bypassed by a retry. Until these are proven in
the operational deployment, R5 remains NO-GO. This change is validated
only if the exact-SHA cumulative offline CI reaches five successful jobs.

### R5 authenticated Engineer UI pins signed backend Planning provenance

The operational Engineer service loader now **requires** an operator-owned
`approval.checkpoint` configuration with independently selected
backend Ed25519 public key ID/file, owner-only checkpoint directory and
approved feature branch. It constructs
`SignedPlanningCheckpointFileStore` with session, Gitea SHA,
repository and branch pins from the *owner's* configuration, not an A2A or
GitHub request. The checkpoint directory is distinct from the separate
approval, OIDC replay/admission and recovery journals.

The loopback Engineer review console validates the verified, persisted,
backend-signed checkpoint against its immutable `plan.json` at
startup, on viewing the plan and immediately before an independent human
Ed25519 approval. A modified, expired or replaced checkpoint cannot turn
into an Engineer signature. The interactive Engineer still independently
chooses the approved permission subset; no inference, automated approval,
operational root, or paid dispatch is performed.

Standalone historical local GUI fixtures may omit the optional store for
non-operational demonstration. The **strict configured persistent service**
rejects a missing checkpoint trust configuration. Existing deployed
service configurations therefore need owner-provisioned checkpoint pins
before startup; this is deliberate fail-closed behavior.

Offline tests cover valid signed provenance through human UI approval,
mutated checkpoint rejection, raw-plan disagreement and strict
configuration rejection. This does not establish persistent live Planning,
private-network routing, real Engineer review or R5 GO.
Certify only when exact-SHA cumulative offline CI reaches 5/5 success.

### Strict Engineer-host offline fixture now uses actual signed Planning provenance

The first dedicated Engineer CI for `b429313` (run
[#40123094408](https://github.com/DarkGh0st03/delegation/actions/runs/40123094408))
found one stale integration fixture. The strict on-disk bootstrap was
still configured with a raw plan but without the newly required owner-pinned
backend-signed Planning checkpoint, so it failed at configuration load
*before* reaching its intended crash-recovery assertions.

The fixture now creates independent Ed25519 backend keys, signs a structurally
valid unapproved Planning checkpoint for the pinned Gitea repository, source
SHA, session and work branch, stores it through the owner-only exclusive
`SignedPlanningCheckpointFileStore`, and includes its public-key
pin in the protected operator configuration. Its original Gateway IPC and
Rust Adapter orphan-root revocation assertions remain unchanged; no
production requirement is relaxed, and no mocked Engineer approval is added.

This correction is certified only by a fresh exact-SHA offline CI. The
user has not authorized a paid Gemini call or a merge onto `main`.

### R5 strict recovering host rejects direct checkpoint-provenance bypass (24 October 2026)

Review of the persistent Engineer bootstrap found a second operational
entrypoint, `startTrustedEngineerRecoveringHost`, which was
callable directly from a trusted process with an in-memory configuration.
The strict owner-file service loader already required the pinned,
backend-signed Planning checkpoint, but this direct bootstrap previously
relied on the optional local approval UI check. A caller could therefore
start a recovering host on the test/demo raw-plan fallback without the
independent checkpoint.

Before connecting to the Gateway IPC, the strict recovering bootstrap now
requires an actual `SignedPlanningCheckpointFileStore`, verifies
the persisted Ed25519 checkpoint using the store's independently pinned
key/branch/repository/SHA, and separately matches the verified session,
source SHA and repository against the host's pinned Engineer configuration.
Missing/expired/tampered/mismatched checkpoints fail before any remote
reconciliation or HTTP listener. The local test-only host retains its
explicit mock mode; no authority is granted to that fixture.

The real IPC/Adapter crash-recovery test now passes its own valid signed
backend ticket when exercising the direct strict bootstrap; it also checks
that a missing store and a session mismatch fail closed while preserving
the independent tombstone replay guard. No paid model calls, automatic
Engineer signatures or main-branch changes. Certify only after both the
dedicated Engineer CI and all five cumulative offline jobs succeed on the
same new SHA.

### R5 owner-controlled Planning root issuance, signed checkpoint and failure cancellation

A new **trusted in-process** `startOwnerControlledPlanningReview` primitive
performs a genuine preliminary `TrustedExecutionCoordinator.beginPlanning`
root request, binds the resulting verified root to the Gateway read-only
port, invokes the real Google ADK `TrustedAdkReadOnlyPlanner` object
with a model supplied exclusively by the trusted owner process, signs its
grounded unsigned result with an independently configured backend Ed25519
key, writes the immutable provenance to the already-pinned checkpoint
store, and stages it for a separate Engineer signature. The source Gitea
SHA must be verified through the coordinator's Planning revision port
before issuing the provisional root. No paid model or delegated Execution
is started by this helper.

An aborted inference, rejected read, invalid signing key or failed
checkpoint persistence now invokes `TrustedExecutionCoordinator.closePlanning`,
which synchronously fences further Planning reads. The lower-level
`TrustedEngineerAuthoritySession.cancelPlanning` attempts both
Gateway revision retirement and actual Rust/Adapter root revocation,
requires both confirmations before closing, and returns the same result
to concurrent/repeated callers. A failed revocation is terminal and
requires manual reconciliation; do not silently retry the same root.
Offline tests prove a successful real Gateway/VP/OPA read and checkpoint,
a failed read with confirmed revocation and a failed revocation with
fail-closed status.

The successful case deliberately retains the **short-lived Planning
root** for subsequent independent Engineer review/approval, and exposes
a trusted-only `closePlanning()` for cancellation. This is NOT
the deployed host bootstrap: owner-side local key/status-list provisioning,
durable *preliminary* root intent across process crashes and handoff of the
same in-memory Coordinator to the authenticated host are still missing.
Do not claim R5 GO, call paid Gemini or merge to `main` based
on offline tests alone. A new exact-SHA cumulative CI is required.

### R5 provisional Planning root: distinct durable pre-issuance journal

The owner-controlled read-only Planning bootstrap now requires an
independently owner-provisioned `TrustedPlanningRecoveryStore`
bound to the same Coordinator instance. It records a one-use provisional
root ID, exact pinned Gitea SHA and session before initiating Gateway
Planning registration or native Rust/Adapter issuance. The record is
exclusive, owner-only, fsynced and contains no credential payload,
private key, token or model data. Ambiguous issuance/crash retains the
pending intent. Following confirmed cancellation, or confirmed
preliminary-root revocation during signed operational handoff, a
non-replayable tombstone is persisted.

A separate `reconcileOrphanedPlanningRoots` primitive accepts
only a trusted Gateway **Planning** registry retirement port plus Rust
revocation; both must be independently confirmed before it tombstones the
root. Tests cover pre-issuance reservation, recovery from a fresh store
instance, failures on either side, file-integrity denial and successful
Coordinator cleanup.

**Remaining deployment gap:** the existing authenticated private IPC
supports operational-plan retirement but does not yet expose a *separate
Planning registry retirement* command. Therefore the persistent Engineer
host does NOT yet automatically reconcile the preliminary journal at
startup, and cannot claim full crash recovery or R5 GO. Retained pending
intents MUST block a new owner Planning attempt. No paid Gemini request
or main merge is authorized by this work.

### Planning journal offline regression: truncated vs malformed JSON

The first CI on `8d522fe` correctly rejected a truncated
Planning record at the inode size gate, before trying JSON.parse.
One new test wrongly expected the later parsing error. The regression now
asserts both fail-closed paths separately: truncated record rejection and
well-sized malformed JSON rejection. No runtime permission or journal
validation was relaxed. New exact-SHA offline CI must still pass.

### R5 private IPC Planning registry retirement (24 October 2026)

`TrustedPlanIpcClient.retirePlanning(sessionId)` now sends a
separate HMAC-authenticated, one-use `retire_planning` command
over the existing owner-only Unix socket. Unlike operational plan
`retire`, the new command acts on the exact
`TrustedPlanningRevisions` instance provided to the Gateway
IPC server. A server without that registry denies the operation. The
registry reserves an inactive terminal tombstone even for a previously
unknown session ID; an outstanding Gitea discovery cannot reactivate it
after authenticated retirement.

Offline IPC regressions cover retired-during-Gitea-discovery races,
idempotent missing-session tombstones, and denial without a real registry.
This capability DOES NOT by itself guarantee that a deploying Gateway
actually passes its live registry, nor that a restarted Gateway persisted
the tombstone, nor that the Engineer host has recovered its pending
Planning journal. Both sides must be connected and validated before
calling the process-restart path safe. No paid Gemini or main merge.

### R5 Engineer cold-start recovery of provisional Planning roots

The persistent owner-file Engineer service now requires a sixth, distinct
owner-only directory `recovery.planningDirectory`. Strict
startup validates it before connecting to the authenticated Gateway IPC.
The Engineer host independently reconciles its persisted preliminary
root journal by requiring both the Gateway
`retirePlanning(sessionId)` registry operation and the
Rust/Adapter `revokeRoot(credentialId)` receipt, before
opening either human approval or GitHub OIDC listener. A missing,
inaccessible or unconfirmed component causes a terminal boot rejection
and retains the pending root intent. A cold-restarted session with a
retired provisional root cannot silently resume an earlier review.

The local offline test exercises a failed Gateway retirement followed by
successful cold restart with the same protected journal, verifies Rust
revocation is still attempted when Gateway fails, and checks no listener
is exposed prematurely. The actual Gateway deployment must still pass
its live `TrustedPlanningRevisions` registry to the
authenticated private IPC server. This host startup path is not yet a
same-process handoff of a still-active Planning root to the authenticated
Engineer session. R5 remains NO-GO; no paid model call or merge.

### R5 hard gate: authenticated Planning retirement capability

The private Gateway IPC `lease_status` reply now attests
two separate capabilities over the authenticated Unix channel:
`enabled` for the operational lease, and
`planning_retirement_enabled` for an injected real
`TrustedPlanningRevisions` registry. The strict Engineer
recovering bootstrap refuses to expose any listener if either capability
is missing, even when the Planning journal happens to be empty. This
prevents a missing Gateway Planning registry from becoming a latent
unrecoverable provisional root during the next run.

Offline regressions cover both capabilities and ensure absent Planning
support cannot be invoked as an operational-plan retirement alias.
The Gateway deployer must still supply the **same** Planning registry
instance as its prepare/execute runtime. This handshake does not attest
instance pointer equality across process boundaries, does not persist
Gateway tombstones across a full Gateway crash, and is not proof of a
live authentic human Planning->Execution handoff. R5 stays NO-GO.

### R5 actual deployed Gateway process shares authenticated Planning registry

The production `trustedPlanDeploymentFromEnv` bootstrap
no longer provisions a private operational-plan IPC without Planning
recovery support. Whenever trusted control is enabled, it requires an
authenticated real Gitea provider and creates one
`TrustedPlanningRevisions` instance, sourced from the
owner-configured Gitea URL/token/repository. That **same object** is
injected into both `GatewayRuntime` (prepare and execute
revision checks) and `createTrustedPlanIpcServer`
(authenticated `retire_planning`).

This closes the incorrect possibility that Engineer cold-start recovery
tombstones a separate, ineffective registry while the live Gateway still
accepts provisional reads. Mock-provider deployments with trusted plan
control now fail at startup rather than advertising recoverability.

Limitations remain: the currently in-memory Gateway tombstone does not
survive restart across separate Gateway process lifetimes; the owner
and Engineer need a durable Gateway recovery protocol or guaranteed
restart sequencing. The authenticated real human, live Planning
session transfer, provider spend cap and exact-SHA full CI are
outstanding R5 prerequisites. R5 remains NO-GO, no paid Gemini call
and no merge to main.
