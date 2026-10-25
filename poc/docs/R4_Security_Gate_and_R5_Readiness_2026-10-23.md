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

### R5 offline IPC child fixture adapted without relaxing Gitea production gate

Run [#40126135274](https://github.com/DarkGh0st03/delegation/actions/runs/40126135274)
correctly rejected a mock provider through the newly hardened
`trustedPlanDeploymentFromEnv`. Seven historical IPC tests
were still starting their child subprocess through this *production*
entrypoint while explicitly using scripted Gitea/VP/OPA fixtures.

The disposable test child now constructs the same approved plan registry,
same-instance Planning revisions and authenticated socket with explicit
offline fixture dependencies, rather than invoking the protected production
bootstrap. The production requirement for a real owner-authenticated
Gitea URL and token remains mandatory and unchanged. No paid calls.
Certify the repair on the next exact-SHA dedicated and cumulative CI.

### Native Rust EVM offline scoped-child process isolated from production bootstrap

The 4/5 cumulative CI on `b682e7f8`, run
[#40126288538](https://github.com/DarkGh0st03/delegation/actions/runs/40126288538),
passed Gateway, OIDC, Rust/Solidity and Docker/Gitea but failed the
native EVM composite at the scripted scoped-child step. That test used a
Gateway provider_mode=mock process while launching `main.ts`,
which deliberately rejects such a provider after the trusted deployment
bootstrap was hardened. Disabling the production Gitea requirement to
make this offline test pass would weaken R5.

The scoped-child script now launches an explicitly disposable
`native-scoped-mock-gateway.ts` fixture. It uses the real
`GatewayRuntime`, native Rust verifier, live OPA, authentic
signed Engineer approval store and IPC enforcement, but constructs an
owner-supplied isolated *scripted* provider/Planning revision registry
without pretending to run the authenticated production bootstrap.
It deliberately retains the mock provider's inability to corroborate
successful task completion, so the E2E still expects fail-closed root
revocation. The actual `main.ts`/real-Gitea security
requirement stays unchanged. No paid Gemini usage or main merge.

New exact-SHA cumulative offline CI must pass 5/5 before certification.

### R5 Gateway Planning retirement durable across process restarts (25 October 2026)

`TrustedPlanningRetirementStore` is a **separate**
owner-owned, mode-0700, exclusively created/fsynced journal of retired
Planning session IDs. The production trusted Gateway now requires
`TRUSTED_PLAN_PLANNING_RETIREMENT_DIR`, validates all
existing tombstones before binding either its private IPC or public HTTP,
and shares that store with the **same** Gitea-backed
`TrustedPlanningRevisions` object used in prepare/execute.

The authenticated `retire_planning` command sets an immediate
in-memory fence and waits for the file+directory fsync before acknowledging
success. A cold-restarted Gateway refuses even an otherwise valid
`begin` for a previously retired session before Gitea I/O.
Concurrent Gitea discovery is also rejected if retirement races it.
A missing/corrupt/symlinked or publicly readable retirement journal
fails closed. Tests cover cold restart, unknown session tombstone,
corrupt journal and in-flight read races.

A storage write error leaves an unconfirmed Engineer journal; it must
be reconciled rather than accepted as successful termination. This is
a single-owner filesystem durability primitive, not distributed
consensus. All concurrent Gateway replicas MUST be prevented from
issuing the same session by separate deployment controls. Further
operational tests with the Engineer/Gateway restarted together are
needed before R5 GO. The change does not call Gemini, request human
approval or alter `main`.

### Gateway durable retirement race-test synchronization (25 October 2026)

The first Gateway CI on `66e38db`, run
[#40172483645](https://github.com/DarkGh0st03/delegation/actions/runs/40172483645),
found an **offline timing error** in the new race regression. An
unconditional event-loop yield could retire a session before the
journal's asynchronous initial check reached the simulated Gitea
client. The test then correctly received the earlier fail-closed
`retired before Gitea discovery` denial, and its
late-installed rejection assertion created an unhandledRejection.

The test now waits for an explicit "inside Gitea discovery" barrier,
attaches its rejection assertion at promise creation and then retires
the session. This deterministically verifies the intended late-result
denial with no modification to runtime authority, journal or security
policy. A new exact-SHA CI is required for certification.

### R5 authenticated IPC attests *durable* Planning retirement (25 October 2026)

The private Unix IPC `lease_status` capability reply
now reports `planning_retirement_durable` separately from
the presence of a Planning revision registry. The trusted client
validates both bits; the strict
`startTrustedEngineerRecoveringHost` refuses to start
listeners when the Gateway has only in-memory retirement (even when
the Engineer provisional-root journal is currently empty). The
production deployment has already pinned a real Gitea registry with a
distinct owner-only persistent retirement store; this change checks
that the actual connected Gateway attests its presence.

Offline integration tests create real HMAC IPC sockets and independent
Engineer/Gateway owner-private journals. After an orphan provisional
credential is reconciled via IPC plus a scripted native Rust-status
receipt, the Gateway process/registry and IPC client are recreated
over the same on-disk directory. The retired session cannot begin
again, its Engineer pending intent stays retired, repeated IPC retirement
is idempotent, and a *new* session remains usable. These tests are not
a deployment of real Rust/EVM, and do not validate process-isolated
storage locking across multiple active Gateway replicas.

R5 remains NO-GO until full exact-SHA CI, authentic human review and
the paid canonical Planning/3-agent path are separately authorized.

### R5 backend-signed Planning becomes the immutable Engineer UI plan file

`TrustedReviewedPlanFile` now materializes the Engineer
console's JSON plan **directly** from the already persisted
backend-Ed25519-signed Planning checkpoint, not a separately authored
mock or operator-submitted draft. The one-shot owner Planning bootstrap
can pass an optional instance bound by object identity to the same
independently pinned checkpoint store. It compares the packet's session,
SHA, digest and exact plan structure against the verified signed envelope
before writing. The destination must be in an owner-only directory;
file creation is exclusive and no-follow with 0600 permissions; file and
directory are fsynced. Any preexisting raw/partial plan is refused and
the provisional Planning root is revoked (or left in the persistent
recovery journal if revocation cannot be confirmed).

Offline regression tests assert the actual Gateway-grounded Planning
result is materialized, that a foreign plan cannot be overwritten,
that wrong checkpoint-store identity fails before credential issuance,
and that failed model reads never produce an Engineer file.

**Still to implement:** an authenticated persistent Engineer host must
consume this newly generated file, retain the exact in-memory Planning
coordinator without treating its own live provisional root as an
orphan on startup, and cleanly cancel it if the Engineer rejects/closes
the review. This increment does not authenticate an Engineer signature
or activate Execution. R5 stays NO-GO; no paid Gemini calls or main merge.

### R5 same-process live Planning authority owned by authenticated Engineer host

`startTrustedEngineerLocalHost` now has an explicit trusted
*same-process-only* `activePlanning` option. The host
requires an actual `TrustedExecutionCoordinator`,
the **identical** owner-provisioned Planning recovery-store object bound
at root issuance, the same owner-only journal directory, the exact
one pending root ID/session/Gitea SHA, and the identical independently
pinned, backend-Ed25519 checkpoint store used by the Engineer UI.
Only after all these validations does it skip **cold-restart** cleanup
of its own still-live provisional root. An orphan from a restarted
process is NEVER restored by reconstructing only a journal or file.

During startup the operational-root recovery journal is reconciled as
before. An authenticated GitHub handoff, if later attempted, must use
this same Coordinator (not a lookalike instance). On shutdown, the
host waits for in-flight handoff closure, then calls
`coordinator.closePlanning()` if no operational handoff
was performed. Gateway Planning retirement, native Rust/Adapter root
revocation and Planning journal tombstoning must all succeed before
clean closure is reported. A failed closure remains terminal for
manual reconciliation. New offline host integration tests cover
retention through review, protected UI access, one-shot shutdown,
session tombstones and mismatched journal/coordinator denials.

**Remaining:** the strict deployed host must be invoked by an
owner-controlled process **after** calling the real Planning bootstrap
and providing its actual Coordinator reference. The separate signed
Engineer approval and admission must still precede operational root
activation; none occurs automatically. Real/native Rust/EVM full-path
test and spending authorization are outstanding. Do not claim R5 GO,
run Gemini or merge main; certify on exact-SHA 5/5 offline CI.

### R5 fail-closed strict startup wrapper for same-process live Planning

The strict `startTrustedEngineerLivePlanningHost(config)`
entrypoint now explicitly owns an already-active Coordinator at the point
where it attempts persistent Engineer/mTLS/Gateway bootstrap. If TLS,
checkpoint, Unix IPC, listener initialization or any other startup stage
fails *before a host is returned*, the wrapper calls
`closePlanning()` on that SAME Coordinator. It reports
normal startup failure only after native preliminary-root revocation,
Gateway Planning retirement and the owner journal tombstone have all
been confirmed. On cancellation uncertainty it returns a mandatory
manual-reconciliation error and does not claim a safe shutdown.

The new dedicated offline test creates a provisional root and durable
intent, intentionally misconfigures the strict mTLS admission, and
verifies one-shot retirement before either Engineer UI or OIDC startup.
This is a trusted in-process entrypoint, never an HTTP route and never
invoked from ADK/A2A/MCP. The separate cold-restart host remains
intentionally unable to reconstruct a live Coordinator from disk.

No paid model, automatic approval, or production root is issued here.
The full operational run remains R5 NO-GO until separately authorized.

### Live root fail-safe covers the existing recovering-host public API

The exported `startTrustedEngineerRecoveringHost` entrypoint
now delegates any explicit live Coordinator option to the same strict
`startTrustedEngineerLivePlanningHost` wrapper that handles
startup failure and preliminary-root revocation. Cold restart without
`activePlanning` retains its original recovery path.
The internal lower-level strict bootstrap is no longer exported, avoiding
an accidental direct bypass of the live-root shutdown guarantee. There
is no new HTTP endpoint or automatic credential issuance. R5 stays NO-GO.

### R5 actual Engineer browser approval drives the original trusted two-root Coordinator (offline)

A new integrated test in `trusted-planning-review-gate.test.ts`
uses the existing signed-plan Gateway registry and Rust credential-port
fixture with its original Coordinator. It signs the staged, Gitea-pinned
read-only Planning result with a distinct backend Ed25519 key, writes
the exact immutable Engineer UI plan through
`TrustedReviewedPlanFile`, and opens the REAL loopback
Engineer approval server with a protected Engineer private signing key.
The test verifies password login, CSRF-bound GET/POST review, denial of
an unauthorized new permission, and a valid *human UI action* selecting
a strict permission subset. Only after the independently authenticated
Ed25519 receipt is written does the SAME Coordinator revoke the
preliminary root, issue a separate operational credential with only
those selected permissions, activate the Gateway approved-plan digest
and then revoke the operational root. It asserts zero operational root
issuance from approval alone. This fixture uses explicit offline
credentials/Gateway stubs, NOT native EVM/Gitea or any Gemini model.

Also hardened `startTrustedEngineerLivePlanningHost`:
once a real same-process Coordinator object is supplied, errors checking
its journal or checkpoint provenance occur *inside* the startup cleanup
boundary rather than before it. A malformed pinned configuration must
never leave a previously issued provisional root alive by skipping the
startup-failure revocation path.

A still-missing deployment requirement is the private owner-controlled
bootstrap wiring of the genuine Gitea snapshot and Rust-issued Planning
credential to the authenticated host. The full paid R5 run remains
NO-GO without explicit separate consent and full offline CI.

### R5 single-process owner Planning -> authenticated Engineer bootstrap binding (25 October 2026)

`startOwnerControlledEngineerReviewHost` now provides one
private owner API that connects the existing real Gateway/OPA/Gitea/ADK
`startOwnerControlledPlanningReview` procedure to the
strict persistent Engineer-host bootstrap, preserving the **original**
Coordinator. It requires identity equality for the independently
configured backend checkpoint, Planning recovery journal and
operational recovery journal. It verifies the Engineer host's expected
session, repository, pinned source SHA, and precise protected
`trustedPlanFile` destination **before** issuing any
preliminary root or calling the owner-selected model.

Once the Planning result is grounded, signed and materialized to the
reviewable plan, it supplies the exact Coordinator and review gate to the
strict host. The same operational recovery-store object remains bound
both to the Coordinator and the Engineer host, preventing a previously
latent failure in which the host allocated a second in-memory journal
object, making operational handoff's identity check impossible.
Untrusted GitHub input or a remote HTTP caller cannot select these
component instances or sign on behalf of a human.

Any failed strict Engineer bootstrap after Planning must retire the live
provisional root; offline tests exercise denied foreign UI paths,
journal mismatch, foreign operational stores before issuance and
the real scripted-ADK/Gateway/VP/OPA Planning followed by mTLS bootstrap
denial and confirmed root cancellation. This owner API invokes its
owner-provided LLM when called: production usage must first obtain
independent cost authorization. NO paid Gemini inference has been
triggered here. The separate human approval/OIDC-verified Execution
and fully deployed network transport are still unproven; R5 is NO-GO.

### R5 authenticated Engineer rejection terminates the provisional root

The trusted Engineer review console now has an authenticated, same-origin,
CSRF-guarded `/api/reject` decision. It requires the literal
`REJECT <exact pinned SHA-256 digest>` confirmation and
does not accept a credential ID, DID, key, or alternative plan from HTTP.
Only a same-process active Coordinator receives a trusted host-owned
callback. If Execution has started or shutdown is underway, rejection
is denied. The original Coordinator must confirm Gateway Planning
retirement, native Rust revocation and durable journal tombstone before
the API reports success.

Rejection, approval and failed/unconfirmed retirement are all terminal
for this Engineer server; they cannot race or override an existing signed
Engineer approval receipt. The test-only local Engineer server retains
its no-rejection mode. No model call is performed by the reject route.
R5 remains NO-GO pending exact-SHA CI, UI tests and deployment proof.

### Authenticated rejection UI and offline regression coverage

The private Engineer GUI now displays a separate Reject control ONLY
when the backend's review API reports a trusted live-Planning revocation
callback. The Engineer must explicitly type `REJECT` and
the exact SHA-256 digest and then pass authentication, origin and CSRF
checks. The callback cannot be supplied by the browser.

Offline tests verify invalid digest, wrong confirmation, missing CSRF,
successful one-shot rejection, failed Rust/Gateway retirement causing
terminal unavailability, signed-approval replay rejection, and the
legacy UI's inability to claim a revocation it cannot perform.

No automated Engineer consent or Gemini call is present. R5 is NO-GO.

### R5 live-Planning phase fenced during Engineer review and signing

The trusted host now supplies a private `planningIsActive`
callback bound to its original Coordinator. The Engineer approval server
checks this at bootstrap, on every review request, just before producing
an Ed25519 signature and just before persisting its signed receipt.
Concurrent shutdown or preliminary-root rejection cannot authorize a
new signature based solely on a still-valid signed checkpoint. The host
always overrides any caller-provided callback.

This guard does not claim cross-process filesystem atomicity. Native
Gateway and Rust revocation, along with the durable journals, still
provide the independent authority fence. No paid model call is made.

### R5 live Engineer rejection verified against original Coordinator and journals

An Engineer-host integration regression now starts the actual local
password/CSRF browser service with a backend-Ed25519-signed checkpoint,
owner-private provisional-root journal, and active trusted Coordinator.
An authenticated reject request enters native revocation. The test
deliberately delays that revocation, submits a conflicting Engineer
signature while the root is being retired, and checks it is refused.
After the native revocation confirmation, the rejection returns success,
the Gateway Planning retire port has been called exactly once, the
Coordinator is closed and the durable provisional-root journal is
tombstoned. No signed approval receipt or operational root is issued.
The test uses explicit local Rust/Gateway port stubs, not real EVM.

The host still refuses any later attempted paid handoff from the
rejected session. Exact-SHA CI certification remains necessary.

### R5 durable terminal Engineer rejection intent (25 October 2026)

`TrustedEngineerRejectionStore` saves an exclusive,
owner-owned 0600 rejection-intent marker **before** requesting Gateway
Planning retirement and native Rust root revocation. It is bound to
the pinned session ID, Gitea base SHA and exact plan digest. File and
directory are fsynced. The authenticated Engineer server checks for
any existing marker, including a truncated or corrupted file, before
opening its review listener after restart and permanently refuses that
session. A complete revocation is still proven by the independent
Planning root journal; the human rejection intent is NOT a certificate
that native revocation succeeded.

The in-process rejection state is reserved synchronously before the
first async signed-approval-receipt filesystem check, closing a race
where an approval request could begin while rejection was checking
for a pre-existing signature. Failed or uncertain revocation remains
terminal; a fresh session and independent Engineering approval are
required for further work. Tests cover completed rejection, ambiguous
native revocation and partially written tombstone after simulated crash.
The marker is never cleared automatically. R5 remains NO-GO.

### R5 combined two-root crash replay and immutable operational retirement (25 October 2026)

The operational-root journal now makes terminal retirement **non-overwriting**:
`markReconciled` creates the immutable .retired
entry using exclusive hard-link creation and synchronizes the directory
BEFORE removing its pending intent. If interrupted between these durable
steps, the journal sees both entries for one session and **fails closed**
instead of incorrectly treating the record as retired or replacing a
prior tombstone. Startup also rejects non-owner-owned journal files and
uses no-follow directory sync.

Offline tests now persist BOTH provisional and operational root intents
for one signed Engineer session before simulating host loss. An
unconfirmed native Rust operational revocation leaves the operational
intent pending and prevents any second credential issuance. A later
trusted cold-start first retires the operational Gateway plan and
revokes its Rust credential, then independently retires the Planning
Gateway registry and revokes the preliminary credential. Both sessions
remain permanently non-reusable; a subsequent recovery performs zero
external calls. A separate test verifies that a forged duplicate
pending entry cannot overwrite an existing retirement tombstone.

These are deterministic offline trusted-port fixtures, not live EVM or
proof of multi-replica filesystem consistency. Single-owner deployment
remains required. R5 is still NO-GO; no paid Gemini call and no merge.

### R5 cold restart: operational authority must be revoked before preliminary authority

The persistent Engineer host now reconciles the **operational root and
Gateway execution session first**, before any preliminary Planning root.
If operational revocation is ambiguous, startup fails before it touches
the Planning journal or starts the Engineer UI / OIDC listener. Only a
confirmed Gateway operational retirement and native Rust status
revocation permit subsequent Planning registry retirement and
provisional root revocation.

The new Engineer-host offline regression simulates a previously signed
session that crashed immediately after an uncertain operational
credential issuance, with BOTH durable intents pending. A failed
operational Rust status confirmation blocks all further startup. A
subsequent verified retirement allows Planning cleanup; both
credential sessions remain non-reusable, while a distinct fresh
Engineer session can start. No new credential is issued by recovery.

This is a recovery-ordering and fail-closed proof using explicit
Gateway/Adapter mocks. It does not replace real EVM/native status proof
or constitute an R5 GO decision. No paid Gemini invocation or main merge.

### R5 operational pre-issuance reservation fails closed without leaking preliminary authority

`TrustedExecutionCoordinator.beginExecution` now explicitly
cancels its live provisional root when the durable operational-root
pre-issuance journal refuses a session **before** any new credential
can be issued. Previously the synchronous `activating`
phase fence discarded its reference to the Planning root and the
reservation error left the original provisional root potentially
live until process restart. The new path uses the original Engineer
authority to confirm Planning registry closure plus native Rust
revocation, and tombstones the provisional journal only after the
confirmation. If any revocation or journal flush fails, both the
Coordinator and persistent intent remain fail-closed, demanding manual
reconciliation. No new operational issuance may be retried.

Offline tests force an already retired operational session, prove that
operational root issuing was never invoked, and check the original
Planning root was retired exactly once. They also simulate failed
preliminary revocation and verify the durable Planning intent remains
pending, blocking further use. No paid workflow, EVM deployment,
or main merge was performed.

### R5 Planning retirement tombstone is now immutable across interrupted writes

The provisional Planning recovery journal now uses exclusive filesystem
`link()` creation and a durable directory sync before
removing its pending root intent. It no longer uses a destination-
overwriting `rename()` when finalizing retirement.
If a crash leaves both names, startup detects their duplicate session
and refuses reconciliation rather than accepting an ambiguous state.
The existing owner-only storage and native/Gateway revocation checks
are unchanged. A new offline regression explicitly forges a second
pending root beside an immutable retired record, proves fail-closed
startup and verifies the original retirement bytes cannot be replaced.

This mirrors the existing operational-root tombstone protection and
strengthens replay denial across both stages. No Gemini usage, no paid
workflow run and no main merge.

### R5 native Rust/EVM signed approval and operational-root crash-recovery fixture

The existing **offline** native scoped-child EVM test now covers a
second independent Ed25519-signed Engineer decision, with its own
session and unique Rust/EVM status indices. A real provisional root and
a separate operational root are issued by the native Rust Adapter;
the same signed approval is activated through HMAC-authenticated
Gateway IPC. Both root intents are persisted in private journals before
external issuance. The preliminary root is confirmed revoked and
retired before operational activation.

Immediately after real operational issuance, the test simulates loss
of the owning Coordinator by reconstructing the durable journal in
another object. It first simulates missing revocation acknowledgement,
ensuring the operational intent stays pending and second issuance is
blocked; a fresh recovery instance then tombstones the real Gateway
session and invokes the REAL Rust/EVM root revocation operation.
The retired session is permanently non-reusable, including on later
recovery attempts. No model API or paid workflow is invoked.

This is a **simulated crash/restart at the journal boundary**, not a
SIGKILL or a proof of distributed-replica recovery. The disposable
Gateway provider is mocked, while Rust/Adapter/EVM, signed Engineer
receipt and private IPC are real. R5 remains NO-GO until exact-SHA
native CI, real deployed recovery and separate paid-run authorization.

### Independent native Rust revocation attempt on Gateway recovery failure

Operational cold-restart reconciliation now attempts Gateway session
retirement and Rust/Adapter credential revocation independently.
Previously an unavailable Gateway prevented even attempting real EVM
revocation. An error from either side still leaves the root intent
pending; only confirmed results from BOTH sides permit writing the
terminal tombstone. The regression exercises failed Gateway retirement,
an attempted independent Rust revocation, preserved pending intent
and later full reconciliation. No second credential issue is permitted.
This is offline port testing and not a paid model execution.


### R5 — SIGKILL reale dell'Engineer e recupero con PID indipendenti (25 ottobre 2026)

Il test offline `trusted-two-root-process-crash.test.ts` crea un
server Gateway con IPC Unix autenticato HMAC, registry dei piani approvati,
retirement Planning persistente e un'approvazione Engineer verificata
con Ed25519. Un processo Engineer separato usa il
`TrustedExecutionCoordinator` originale, registra su disco
gli intenti delle due credenziali, revoca la provvisoria e attiva
l'Execution tramite IPC. Il processo viene quindi terminato
effettivamente con **SIGKILL** mentre l'Execution è attiva.

Un secondo PID riconcilia il journal ma incontra una revoca Rust
intenzionalmente senza conferma: il record operativo resta pending e
una seconda emissione è vietata. Un terzo PID ripete la chiusura,
conferma separatamente la revoca tramite porta simulata, registra il
tombstone operativo e ritira la sessione Planning nel Gateway. Un
ulteriore processo verifica che l'approvazione già firmata e la sessione
ritirata non possano essere riattivate o riemesse.

**Perimetro della prova:** arresto reale del processo Engineer, nuove
istanze Node con PID distinti, file owner-only e fsync, firma Engineer
reale e IPC Gateway HMAC autentico. Le operazioni Rust di issue/revoke
sono porte deterministiche simulate; il provider Gitea non viene
chiamato. Non è un SIGKILL del Gateway stesso né una prova con rete
EVM in questo singolo test. Le prove EVM native rimangono indipendenti,
e non si effettuano chiamate Gemini a pagamento. R5 resta NO-GO.


### R5 — Gateway operational activation and retirement journal (25 ottobre 2026)

A critical additional restart fence has been implemented for the
**Gateway itself**, not just the Engineer process. Before loading
an Ed25519-signed Engineer approval or activating its approved
Execution plan, `TrustedApprovedExecutionPlans` reserves
the session ID as an exclusive owner-only 0600 operational record and
fsyncs the record and its directory. A new Gateway instance with the
same protected journal cannot accept the old signed plan after a crash.

The authenticated HMAC IPC `retire` command now waits
for a durable operational retirement record before acknowledging
recovery to the Engineer. An early retirement also prevents activation
when it precedes first issuance. A concurrent retirement fences any
activation that is waiting on approval-file verification. A completed
activation is terminal for that session ID: after a restart, the
Gateway may ONLY continue recovery/retirement, never resume an
incomplete DAG or issue additional authority based on the old receipt.

**Deployment requirement:** the real Gateway trusted mode now requires
`TRUSTED_PLAN_OPERATIONAL_SESSION_DIR` alongside the
existing `TRUSTED_PLAN_PLANNING_RETIREMENT_DIR`. Both
owner-private durable journals are audited *before* opening the
private IPC listener and provider-facing HTTP server. Operators must
provision a separate persistent 0700 directory, owned by the Gateway
process, backed by a filesystem that honors O_EXCL and fsync. This is
intentionally fail-closed for old configurations.

A new offline test suite verifies restart denial, preactivation
retirement, concurrency fencing, and rejection of corrupt/private-mode
journal failures. These are independent Gateway restart-state tests,
not yet a live crash of the actual Gateway service process.
The Engineer operational root journal still independently governs
Rust/Adapter revocation; Gateway terminal records alone are NEVER
proof that the Rust EVM credential was revoked.

No paid Gemini test or main merge; R5 remains NO-GO until further
offline/native/restart validation and explicit owner authorization.


### Gateway SIGKILL and independent process restart regression

The separate `trusted-gateway-operational-restart.test.ts`
now validates physical **SIGKILL of the Gateway's actual Unix IPC
process** after the Engineer-signed plan was activated. A second
Gateway process boots with the same immutable operational journal
and the same valid Ed25519 receipt: it MUST deny activation. The
trusted recovery command can still retire the session and, after a
third fresh Gateway process boot, the session is still non-reusable.
The test checks new process IDs and removes a stale test socket only
AFTER the previously owning PID has exited; it does not simulate
restart by simply replacing an in-memory registry.

This test intentionally uses scripted Gitea/VP/OPA and no Rust issuance,
so it verifies Gateway persistence and authenticated IPC replay denial,
NOT real EVM revocation. Together with independent native EVM and
Engineer SIGKILL fixtures, this exercises both crash boundaries but
does not claim a combined end-to-end multi-process outage test.

### HMAC operational durability attestation

The private `lease_status` IPC response now includes
`operational_session_durable`, derived from the actual
Gateway-owned operational ledger (not a client-controlled flag).
`TrustedPlanIpcClient` validates and exposes it. The
strict deployed Engineer host refuses to open authentication listeners
if the Gateway has a lease but no durable operational session fence.
The loopback-only historical test harness may still omit the ledger
but cannot claim the strict deployment capability. The SIGKILL
regression asserts the real durable Gateway fixture advertises it.


### R5 owner-only single-invocation signed DAG execution (25 October 2026)

The authenticated Engineer host now exposes a **private in-process**
`runReviewedApprovedDag({runId, execution, ...trusted})` operation. It
uses the exact same host-pinned Planning Coordinator, signed Engineer
checkpoint, protected operational recovery store, consumed OIDC admission,
GitHub live-run verification and host-owned workflow/source pins as
`startReviewedHandoff`. It cannot be invoked via the browser, GitHub OIDC
HTTP endpoint, A2A, MCP or Gateway.

The new `createTrustedReviewedHandoffLifecycle.runApprovedDag` owns one
attempt from handoff startup to `approvedDag.executeApprovedDag` and
always awaits trusted authority shutdown, including failed dispatch,
missing approved dispatcher, concurrency with host close and ambiguous
startup. Invalid owner-provisioned A2A/Adapter/child-authority executor
arguments are rejected **before** consuming admission. No model calls
are performed by the new wrapper itself.

Offline tests:
`poc/apps/orchestrator/test/trusted-reviewed-handoff-lifecycle.test.mjs`.
The dedicated Engineer UI workflow and cumulative refactoring CI now
include the test. This proves lifecycle wiring and negative cases with
injected local test ports, **not** deployed runner-to-host transport or a
complete real-provider three-agent execution. The process owner still
has to supply genuine trusted A2A, Adapter and task authority ports and
invoke the private method. The prior split-phase operator method remains
for controlled diagnostics.

**Certification pending:** verify all cumulative offline jobs and the
Engineer-host checks on the exact new HEAD; do not infer green from a
previous SHA. R5 is **NO-GO** until persistent deployment, authentic
human review, canonical provider integration, spend limits and explicit
charge authorization have independently been demonstrated. Neither
`main` nor the historical paid Gemini workflow was modified.


### R5 GitHub run liveness rechecked before every approved Task (25 October 2026)

The owner-only `createReviewedApprovedDagExecution` bridge no longer
checks GitHub Actions liveness only before loading the approved DAG.
It also supplies a trusted, non-model-controlled `beforeTask` callback
to `TrustedApprovedA2ADispatcher.executeApprovedDag`.
The callback performs the same authenticated GitHub REST active-run and
operational-lease check **before each signed Task**, including
Orchestrator `create_branch` and Backend/Frontend/Test dispatch.
An inactive/canceled job, REST failure, or Coordinator shutdown fails
closed before dispatching the next Task, and the dispatcher closes
the operational authority on failure.

The task callback is optional only in legacy and independent offline
dispatcher tests; it is mandatory by construction for the admitted
Gemini bridge. No user-supplied model or A2A payload can substitute
that callback. Regression tests cover the four-Task healthy sequence,
cancellation between Backend and Frontend (no Frontend/Test effects),
and shutdown during the verification boundary.

**Limitations:** a check is not an atomic lock on external GitHub run
state. Already-started provider actions can finish after an independent
cancellation; bounded leases, periodic job monitoring, native revocation
and trusted Gateway controls remain necessary. The separate
self-hosted runner/Engineer deployment and a single model-scripted
real-provider canonical E2E are still unproven. This is offline-only
code; R5 stays **NO-GO** pending same-SHA CI and explicit charge consent.


### R5 — Signed owner lifecycle, Gateway-backed create_branch and offline composition (25 October 2026)

The R2 ADK scripted Planner / signed checkpoint / independently signed
Engineer review / real in-process Gateway policy / 3-role approved-DAG
fixture is now reused by **two R5 owner-lifecycle regression paths**:
success and GitHub cancellation between Backend and Frontend. Both go
through `createTrustedReviewedHandoffLifecycle.runApprovedDag` and
the existing `TrustedApprovedA2ADispatcher`; completion is acknowledged
only after the operational root is closed, and cancellation cannot
unlock dependent Frontend/Test Tasks.

A new explicitly reviewed private provider,
`poc/packages/orchestrator-runtime/src/trusted-approved-branch-gateway.ts`,
supplies the Orchestrator `create_branch` callback using the actual
`OrchestratorGatewayTransport` prepare → Adapter signed VP → Gateway
execute path, with unchanged native Rust/OPA verification. The provider:

- Loads the **authenticated Ed25519 Engineer receipt** and checks exact
  session, pinned Gitea base SHA, Engineer DID and activated root digest.
- Rejects any additional/unsupported Orchestrator Task, any permission
  other than **one exact approved repository-root create_branch**, or a
  missing permission in the already issued operational root.
- Computes the branch from the **approved signed plan**, never from a
  callback argument or an LLM response.
- Accepts only the dispatcher's preallocated Gateway Task ID, checks
  active root again, and reserves the one attempt **before** Gateway I/O.
- Checks the Gateway's reported performed operation, tool and branch;
  the independent Gateway completion attestor still gates downstream DAG
  dependencies.

The private Adapter bearer is held only by this trusted host-side
executor. The existing R6 static import audit was extended by precisely
**one reviewed caller**; the transport must not become accessible to
ADK, A2A, MCP or model-generated code.

The R5 tests use *actual in-process Gateway policy/Task binding* and
mock only external provider/VP transport. They DO NOT claim a physical
two-host deployment, real human interaction or actual three-agent Gemini
inference. The existing `startOwnerControlledEngineerReviewHost`
still requires real protected configuration and independently provisioned
private runner. No paid workflow or `main` branch was modified.

**R5 status: NO-GO** until exact-SHA CI, genuine operator deployment,
a fully integrated non-billable physical execution and explicit paid
Gemini consent are established. A previous green CI does not certify
the new branch provider.
