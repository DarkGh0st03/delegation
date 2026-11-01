# R151.85 — Original-root repair after Frontend test FAIL

## Starting point and new scope

R151.84 (7cf1be9931fd9ed245b4f466b3fffe6b0dda2cbe) demonstrated a real
Backend test failure followed by signed D1, changed source SHA, complete
Docker PASS, original-root revocation and a draft-only PR. All three required
free CIs passed on that commit. Frontend test failures were still excluded.

This checkpoint extends that same mechanism to frontend_tests. A diagnostic
receipt remains non-authoritative: no count or failure message can mint a
credential, add a resource, move a writer role, edit a test or assert PASS.
TypeScript and acceptance recovery retain their existing separate evidence.
Dependency, build, Playwright and unclassified project failures remain closed.

## Phase-bound private feedback and original source options

The real Runner already emits bounded sanitized failed Vitest file paths,
only for non-timeout Backend/Frontend failures. Gateway now constructs the
same private phase/count summary for Frontend only after installation,
typecheck and Backend PASS, Frontend FAIL and all remaining phases SKIPPED.
It requires project FAIL, acceptance SKIPPED and no compiler error codes.
Owner HMAC IPC validates the exact schema and phase/count binding. Assertions,
logs, source and failed-test paths never enter the source-free planner signal.

The original source scope collector derives its phase and role from the
actual completed Runner receipt, exact branch/SHA and ordered phases.
Backend failures select original Backend source candidates; Frontend failures
select only original Frontend source candidates. Every candidate requires
an unambiguous original Gateway writer and original same-Task read/update
pair under the existing root. Test/spec files remain excluded. Failed test
files must have original signed/root read permissions, without moving their
read rights to another role.

The bounded proposer requires matching trusted phase/count, source options,
root pairs and tested SHA before calling a model. Each selected file stays
with its original role. A new Test receives only run_tests and depends on
all editors. Existing epoch admission, fresh Child DCs, VP/Rust/OPA/Gateway
checks, source reads and write confirmation still gate actual execution.

## Independent free Frontend proof

A separate nonbillable probe changes only the condition selecting the
lifecycle action in an originally signed Frontend component: ACTIVE becomes
SUSPENDED. The code remains well-typed, and Backend behavior stays unchanged.
The original Frontend tests must reject the reversed action. Neither project
tests nor researcher acceptance assertions are edited.

After that actual failure, the new signed Frontend D1 may investigate its
bounded original source options. The scripted model reads the failed SHA,
scans authorized API/CSS/UI source and corrects only the observed UI condition.
It does not copy stored reference bytes into D1. It rejects early/wrong-role
arming, repeat arming, stale source revisions and unconfirmed provider effects.
The new Test runs the unchanged full Docker suite and independent acceptance
on the changed SHA. The existing witness must confirm native root revocation,
durable retirement and a draft-only PR with no merge.

All semantic fault probes are mutually exclusive and reject paid Gemini.
The preliminary child clears the new Frontend probe flag, preserving the
parent's separately authorized mode. Normal paid repair uses the verified
original source scope, never these fault markers or deterministic patchers.

## Validation at publication

46 focused tests passed with Node 22.15.0: 43 eligibility, source-scope,
scripted model, proposer and preliminary-environment cases plus 3 actual
Gateway ledger/feedback regressions for Frontend, Backend and acceptance.
Frontend IPC receipt regression is included in remote Gateway CI; native
Docker proof also crosses the real private HMAC boundary. Static imports:
589 files / 1784 relative imports. Type contract audit: 312 files / 476
named type imports. Runtime contract audit: 14 entrypoints / 150 symbols.

Functional CI runs the new Frontend proof first, then Backend, acceptance,
mixed TypeScript, ordinary, negative and single TypeScript recovery scenarios.
Full remote Docker results must still validate this commit. A scripted PASS
demonstrates the machinery; it does not establish Gemini's ability to repair
an unseen generated defect. No paid run has been launched by this change.
