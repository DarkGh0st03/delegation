# ADK Phase 10 — Sanitized Gemini diagnostics and Backend-only validation

## Motivation
The first Gemini full E2E (GitHub Actions run 37969470115)
failed after a Gateway-authorized Backend `read_file` operation.
The previous handler collapsed all model-provider errors and turn-budget
failures into a single generic error. No evidence yet that Gemini
actually exhausted its Free Tier quota or was intrinsically incapable
of completing the task.

## New bounded, non-sensitive diagnostic
The ADK A2A task handler now categorizes runtime problems using only
static identifiers. Categories include API rate/quota, 400 invalid
request, 401 key, 403 permissions, 404 model, 5xx service, network,
tool-schema validation, SDK exception, ADK event failure and
model-turn budget. The reported audit includes only role, category,
model-turn count and successful/rejected tool counts. It does not log
the prompt, file contents, raw provider messages, credential
evidence, tokens or Gitea responses.

The existing actual security boundary is unchanged: Rust verifier,
Gateway, OPA, DC/VP checks, fixed role capabilities and artifact
revision validation. Failures remain terminal.

## Focused live Backend checkpoint
A temporary GitHub branch marker activates just one real Gemini
Backend A2A task inside the existing full trust-infrastructure
test environment, not the whole Orchestrator/Frontend/Test workflow.
A real delegated Backend child credential is minted; branch creation,
verifier, OPA, protected Gateway and Gitea are all real, while
Anvil, Gitea and the runner are ephemeral GitHub Actions services.
No main modifications or automatic merge.

Pass requires a Gateway-confirmed Backend commit on the feature branch,
nonzero modified-file count, no invocation of the Frontend/Test
agents, and no change to Gitea main. This does NOT assert project
acceptance or PR creation. Failure is a useful experimental result.

Live provider: `gemini-3.8-flash` through native Google ADK,
API key loaded only from preexisting secret
`Delegation_Thesis_Gemini`. The key belongs to the unbilled
`Default Gemini Project` Free Tier. Do not connect Paid Tier
billing or fall back to OpenAI when Gemini returns an error.

After the first role-level attempt the one-time marker is removed.
On normal branch pushes, the protected Phase 5 E2E still runs
`adk-scripted` deterministically at zero API cost.

## Related evidence
- First real model, read-only successful ADK smoke:
  https://github.com/DarkGh0st03/delegation/actions/runs/37965235920
- Previous protected, deterministic full E2E success:
  https://github.com/DarkGh0st03/delegation/actions/runs/37965635556
- First real full E2E failed safely:
  https://github.com/DarkGh0st03/delegation/actions/runs/37969470115

## Verified Backend-only live outcome

- Run: https://github.com/DarkGh0st03/delegation/actions/runs/37971388496
- Result: **FAIL / incomplete**, not an E2E or coding success.
- Before real-provider execution the agent-runtime diagnostic unit tests
  and deterministic Orchestrator regression checks both passed.
- ADK logged **10** outgoing Gemini Developer API requests over approximately
  five minutes; the experiment did not return a final confirmed Backend
  Artifact or Git revision.
- The error occurred at the A2A HTTP client boundary:
  Node/Undici `UND_ERR_HEADERS_TIMEOUT` (`HeadersTimeoutError`),
  while the client awaited a synchronous `sendMessage` response.
- No specific Gemini quota exhaustion, provider billing error, or
  model incapacity can be inferred from that transport timeout.
- A2A waiting time was a hidden experimental constraint. A robust next
  iteration should poll an asynchronous A2A task or use an explicitly
  bounded, transport-supported timeout; it should also measure LLM
  latency and tool-call count separately from delegation latency.
- The one-time Backend marker is removed after this run: subsequent
  GitHub pushes return to scripted ADK mode by default. Do not trigger
  further live requests until the transport-wait issue is addressed.
