# N0/N1: model-boundary audit, 3 November 2026

Baseline: `f8ed8cb17608acc0fe21c3379aa9d5e0b71019ac`, branch
`refactor/post-prof-plan-contracts-20261021`.
No paid calls, grant changes, Planner changes or new Full CI requested.

## Existing evidence

TS2724 scripted recovery #41598918267 passed on parent 035cb398.
Fast #41600192350, Cumulative #41600192340, Shared MCP #41600192244
and Functional #41600192345 passed on f8ed8cb1. The final commit changes
only the full-CI request manifest; it does not change the targeted recovery.
This baseline is not a generative repair success.

## Verified context flow

`loadTrustedRunnerAssertionContext` validates private Runner evidence and
original read scope, then `projectTrustedRunnerAssertionsForTask` narrows it
to the newly admitted Task. `dispatchTrustedAdmittedRepairA2A` passes the
projection to `approvedTaskInstruction`. The prior tests inspected the
proposer input and composed instruction, but did not invoke the specialist
ADK Runner at that final boundary.

The new zero-provider regression runs the real specialized ADK Test editor,
with exact signed read/update hints and Runner disabled, and captures the
actual `generateContentAsync` contents. It verifies SHA, branch, fresh Task
identity, assertion preservation, no private log/stack disclosure and no
provider effect. This tests the assertion channel, not compiler delivery
or full protected A2A/credential admission.

## Compiler gap (N1 remains OPEN)

`typecheck-diagnostics.ts` deliberately preserves only path, line, column
and code. Its parser discards compiler messages/snippets. The private
assertion loader returns null for a first failed phase of `typecheck`;
it only admits `backend_tests` and `frontend_tests`. A characterization
test records that boundary explicitly. A green assertion-channel test
must not be reported as delivery of a TS2724 compiler message to Backend.

The repair proposer receives error codes and verified role/file targets;
the editor's signed description may contain model-generated guidance.
That is not a guaranteed, independently verified compiler-message channel.
The scripted repair additionally recognizes a known marker in the source.
Neither establishes semantic recovery on an unseen import/export error.

## Next concrete implementation

Add a bounded PRIVATE compiler context from the existing retained Runner log,
verified against log reference/hash, tested revision and first failed phase.
Do not widen the public TypecheckLocation schema: it intentionally rejects
extra fields. Filter compiler text by original role read grants and then
again by the fresh Task read grants, using an owner-only provenance object
as in the assertion channel. Preserve message/position as untrusted data.
Wire it through the owner, admitted repair dispatch and instruction into the
Backend model boundary. Reject stale SHA, forged context and unreadable files.
Test actual Backend ADK input with a capture model before another paid run.
A fresh child/admitted epoch and Runner on the new SHA remain mandatory.

Local validation uses Node 24.22.1; the repository pins 22.15.0.
CI is required to establish compatibility with that pinned runtime.
