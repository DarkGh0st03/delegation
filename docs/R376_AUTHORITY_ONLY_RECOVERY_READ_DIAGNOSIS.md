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

## Next mandatory R376 gates

1. Provide **independently authenticated, bounded diagnostic observations**
   from an authorized Gateway source read (path, tested HEAD, content
   excerpt/digest, optional structured compiler or acceptance details).
   Do not treat A2A messages or model-generated prose as evidence or bypass
   the Gateway with unscoped owner Gitea access.
2. Prove that the adaptive proposer receives these observations as
   *untrusted task data* (not instructions or authority), rechecks the
   same original root, and can select a different permitted correction.
3. Run a free native scenario with a **model-selected read-only Task**,
   a distinct signed Child, authenticated Gateway read completion, and
   a subsequent model-selected correction and real Docker retest.
4. Only then consider the authorized paid Gemini pilot after its existing
   cost, CI and explicit-consent gates.

No paid inference, automatic merge or `main` mutation belongs to R376.
