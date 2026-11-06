# R346 — ADK permission-only Planning output

TrustedAdkReadOnlyPlanner.proposeAuthority() now uses the existing real
ADK read-only tools, pinned source verification, budgets, observations and
one-shot session lifecycle with a distinct authority-only model instruction
and output compiler. It never calls validatePlan or a signed-DAG shape hook
in this mode. propose() retains its historical behavior for existing callers.

The model returns requested_permissions (operation/resource_type/path),
assumptions and uncertainties. The host derives all resource URIs, session,
repository, branch, base revision and requirement. The existing authority-only
validator checks resource kinds and duplicate pairs. Files/directories must
be grounded in the trusted snapshot; a new file needs a known parent.
Task/DID/signature/session fields supplied by the model are rejected.

The unsigned proposal directly feeds selectAuthorityOnlyGrant. Informational
notes are outside that authorization. No authority is signed or issued here.
The method shares the original model limits and bounded proposal revisions;
legacy DAG hooks/pilotFullDag cannot be combined with authority-only output.

Tests include a real ADK Runner with a free scripted model, a Gateway-shaped
pinned read result and Engineer permission selection, plus negative compiler
cases and existing Planner regressions. Provider responses are fixtures in
these offline tests, not native Gitea/EVM evidence or live Gemini inference.

This is a reachable explicit Planner API, NOT a claim that the GUI approval
server or existing paid pilot launcher has been migrated. Next: connect the
trusted Planning checkpoint and Engineer authority-only review to this output,
then activate the existing authority-only Engineer/Coordinator owner path.
