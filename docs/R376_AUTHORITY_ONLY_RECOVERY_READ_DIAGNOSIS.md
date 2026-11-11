# R376 — Authority-only recovery investigation (first bounded step)

## Verified baseline

[R375.8](https://github.com/DarkGh0st03/delegation/actions/runs/42354591410) completed a FREE native Rust/EVM, OPA, Gitea, Docker
and Draft PR scenario. Its Backend/Frontend/Test decisions and source edits
were deterministic scripted output, not autonomous Gemini code generation.
The original failed Test remained uncompleted, while the replacement Test
and root Draft PR were independently attested.

## R376.0–R376.1: allow one signed read-only diagnostic Task

Previously `TrustedAuthorityOnlyAdkDecisionProposer` required every
adaptive specialist Task to include an `update_file` or `run_tests`
effect, even after a genuine authenticated Test failure. Consequently
the model could not choose investigation before editing.

The adaptive proposer now also accepts exactly **one** `read_file`
permission when all the following hold:

- An independently verified Runner FAIL is present in the original owner
  context; ordinary A2A/LLM error text is not a substitute.
- The chosen specialist is Backend or Frontend, **not** Test or Orchestrator.
- The `read_file` resource is covered by the immutable Engineer root
  permission ceiling and the selected specialist's trusted capability.
- The new Task has no `update_file`, `run_tests`, PR operation or other
  side effect; Coordinator validates it before a new native Child is issued.
- Its read goes through original owner Task binding and a one-shot Gateway
  effect stager on the owner-pinned Gitea HEAD. Independent completion
  remains required before the next adaptive model turn.

This is *investigation*, not a repair authorization, new Engineer approval,
automatic read of arbitrary repository paths, or authenticated diagnosis
content injected by an A2A agent.

## Free validation scope

The offline ADK controller regressions cover:
1. authenticated simulated Runner FAIL → read-only inspection Task →
   corrective Task → replacement Test → verified PR-readiness;
2. deny read-only Task before authenticated FAIL;
3. deny `read_file` outside the original root;
4. deny Test-specialist diagnostic reads even if its advertised capability
   includes read.

All negative cases must retire the original root and cannot mark a failed
Test completed. Existing R375 full-stack success remains a separate
pinned baseline; no new native R376 E2E PASS or generative Gemini success
is claimed from these tests.

## R376.2: authenticated bounded source observations

The original Gateway now has an owner-only *post-completion* binding for a
one-shot read-only Task, including its exact original Child and evidence
digest. Neither source paths nor provider success are accepted from ADK/A2A.

The existing authenticated Gitea reader first validates the owner-only
receipt MAC, immutable Task/session/Child pins, independent source bytes,
blob SHA and exact branch HEAD. Only then can the private original Host
obtain a source excerpt (max 4,096 characters, control bytes neutralized),
path, revision, source hash, byte count and completion evidence hash.
The Host binds the returned path to the **same signed Engineer exact-file
read grant** and rejects absent or different HEAD, Task, MAC, source or role.

The adaptive proposer accepts at most four entries associated with
independently completed Backend/Frontend `read_file` Tasks, from the
*current* HEAD only. A mutation automatically makes the prior excerpt
ineligible for the next decision. These source bytes are explicitly
untrusted DATA, not model instructions, claims of Test PASS, or authority.
Original Rust/Gateway/OPA gates, one-shot PR and bounded signed Tasks
remain unchanged.

Offline validation includes forged completion expectations, altered MAC,
provider byte and HEAD mismatch, spoofed reader prototypes, bounded
excerpt controls, obsolete SHA, unknown Task and oversized model context.
[Fast CI #42356509424](https://github.com/DarkGh0st03/delegation/actions/runs/42356509424)
and [Engineer CI #42356509429](https://github.com/DarkGh0st03/delegation/actions/runs/42356509429)
both passed the first integration source SHA `b6d485de`.
These checks are not a native R376 end-to-end assertion.

## R376.3–R376.5: opt-in native proof — independently verified SUCCESS

Instead of copying the 1,200+ line R375 native Account Suspension harness,
the **same** original fixture has a separate, default-disabled
`R376_NATIVE_DIAGNOSIS=1` mode. Original R375 behavior remains the default.

The extra scripted ADK decision runs **after** an authenticated initial
Docker FAIL and **before** any functional repair: Backend receives one
extra signed read-only Child for the unresolved shared account-status file.
Original Gateway verifies the receipt; independent Gitea reader re-fetches
its bytes; the next ADK choice must see `source_observations`. After the
first CAS advances HEAD, that observation must disappear from the next
model turn. The remaining ten reference edits, replacement real Docker
PASS, original-root Draft PR and provider GET are preserved.

The dedicated workflow
`.github/workflows/r376-native-source-diagnostic-recovery-e2e.yml`
is trigger-scoped to a single explicit R376 checkpoint and has **zero**
Gemini/OpenAI inference. It uses the same disposable local Gitea, Anvil,
OPA, native Rust and isolated Docker as R375. The extra read raises the
bounded adaptive decision count from 15 to 16 but grants no new operation.

**Verified native gate (7 November 2026).** The dedicated workflow
[run #42358777600](https://github.com/DarkGh0st03/delegation/actions/runs/42358777600)
returned **SUCCESS** on source/checkpoint commit `3c971d2efb9b9af78ba9e82e5640c0d3bd6d17e2`.
The independent structured E2E assertion reports:

- Authentic first Docker FAIL and original Runner FAIL receipt, with the failed
  Test deliberately left incomplete.
- One new signed read-only diagnostic Task, its own original-root Child DC,
  and independently MAC/HEAD/byte-confirmed source visible in the following
  ADK decision. Stale source is excluded after the first CAS advances HEAD.
- Seven application and three project-test corrections, twelve authorized CAS
  writes; the second Docker run and researcher acceptance both **PASS**.
- Seventeen registered / sixteen Gateway-completed Tasks and fifteen distinct
  Child credentials under **one** original Engineer approval.
- Original-root Draft PR created and independently fetched as open, Draft,
  and not merged; protected original `main` unchanged.
- **Zero paid model calls.** All selected tasks and source changes in this
  native harness remain scripted, not model-generated.

This closes the **native diagnostic-read plumbing** goal; it is not proof of
autonomous Gemini code generation or general arbitrary-repository recovery.
A later diagnostics-only harness commit `cebb9bb80c80acaecea0257c118e6288164e2fd6`
passed [Fast CI #42358842761](https://github.com/DarkGh0st03/delegation/actions/runs/42358842761).
That Fast CI is a **different SHA** from the native E2E result and must not
be described as a same-SHA native pair.

After that, next objective is real bounded Gemini generation with
source-grounded diagnostic recovery, permitted only through existing
explicit cost/consent and CI gates. No paid inference, merge or GitHub
`main` mutation is authorized by these tests.
