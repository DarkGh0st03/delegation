# N5 — one-shot Gemini D0 + optional D1: controlled experiment packet
Date: 3 November 2026. Repository: `DarkGh0st03/delegation`.
Development branch: `refactor/post-prof-plan-contracts-20261021`.

## Freeze and gate
The candidate is the HEAD commit containing THIS packet and the updated
`.github/ci-checkpoints/full-ci-request.json`. Record its full SHA from GitHub;
do **not** reuse the parent `f70f11a20b8f45b919b5bdf389bb466a91063f85` or any earlier green SHA.
Before any paid workflow dispatch: verify independently that **all three**
Cumulative Offline, Shared MCP Real Docker and Functional Signed DAG
completed SUCCESS on that identical final SHA; Fast CI must be SUCCESS too.
Never interpret SKIPPED, CANCELLED or in-progress as a successful gate.
After the gate, **freeze the branch** during the paid run. A later commit
requires a fresh same-SHA check.

## Scope frozen from observed baseline
- Single `Account Suspension` scenario; actual signed **Engineer test
  fixture**, NOT interactive human engineering approval.
- Preserve current Planner, preflight, A2A/MCP/Gateway/Rust/OPA/Gitea,
  Docker acceptance and the existing D1 control plane. No extra grant,
  exporter read or Test Agent source-write escalation.
- Gemini Planning-only SUCCESS:
  https://github.com/DarkGh0st03/delegation/actions/runs/41590370678
  (earlier framework SHA, NOT a substitute for the new CI gate).
- Earlier billed full D0 FAILURE:
  https://github.com/DarkGh0st03/delegation/actions/runs/41592663593
  (Planner and agents reached real Docker; TS2724 failed).
- Scripted, zero-billing actual Gitea/Docker signed Backend D1 SUCCESS:
  https://github.com/DarkGh0st03/delegation/actions/runs/41618869640
- N1 passes the private TS compiler message to the real ADK model-input
  boundary, filtered by old and new read grants and failed SHA.
- N2 confirms that a signed Backend Task's readable-file set cannot grow
  from root-only or update-only permissions. Current bounded D1 proposer
  admits only one Backend read/update pair plus a run-only Test Task.
- N3 demonstrates that changing a verified compiler message changes the
  deterministic Backend ADK editor's behavior on the same read source.
  This is a contract test, **not generative recovery proof**.

## Manual GitHub Actions inputs — never auto-dispatch
Workflow: `.github/workflows/gemini-paid-shared-mcp-final.yml`
on the development branch above. Select:
- `execution_mode = full-d0` (not `planning-only`)
- `model = gemini-3.8-flash`
- `thinking_level = LOW`
- `pinned_commit_sha = <the final, independently 3/3 validated 40-hex SHA>`
- `authorization = I AUTHORIZE GEMINI API CHARGES`
- `billing_cap_acknowledgement = I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES`
- Optional single D1, **only with fresh user consent for this paid run**:
  `repair_authorization = I AUTHORIZE ONE ADDITIONAL GEMINI REPAIR EPOCH`.
  Otherwise leave `NO ADDITIONAL REPAIR AUTHORIZED`.
Do not dispatch until the user explicitly authorizes both the D0 charges
and, if selected, the separate D1 charges, and checks the real Google project
spend cap and any possible overages. These GitHub consent strings are
execution inputs, **not** financial approval supplied by this document.
Provider prices, input token cost, SDK retries and final invoice cannot be
derived from the configured turn/output maxima.

## Actual bounded runtime settings
`poc/scripts/signed-gemini-pilot-consent.mjs` pins:
- Per Task maximum generation turns: Planner 24, Backend 20,
  Frontend 14, Test 10 (additional signed Tasks have independent budgets).
- Per call: 180,000 ms; planning 600,000 ms; A2A Task 1,800,000 ms.
- Default output ceiling 12,288 tokens per call;
  Backend/Frontend 20,480; Test 12,288. They are **not dollar caps**.
- GitHub job timeout 120 min; no automatic rerun (workflow requires
  `github.run_attempt == 1`); maximum ONE admitted D1 epoch under
  existing authority and separately consented repair selection.
- No paid workflow is run by Fast/Full CI or this document.

## Stop/continue rules
1. Planner contract rejection: stop; inspect sanitized rejection categories,
   do not silently alter the frozen Planner.
2. D0 PASS on exact tested SHA, tests, acceptance and revocation confirmed:
   stop. D1 is unnecessary; do not inject a failure.
3. Tool schema/permission denial before Docker: stop; no grant escalation.
4. D0 FAIL on TypeScript: classify verified phase, source and SHA. Only if
   original root + signed D1 Task cover the target, the failure context was
   delivered, new child admission and independent Engineer test approval
   are valid, may the **separately authorized** D1 run.
5. Evidence insufficient or exporter needs a read not in the new signed
   Task: stop and report missing scope, no guessed import and no automatic
   read-grant change. TS2724 does not prove Backend responsibility.
6. D1 editor returns prose/no write or a stale/same SHA: stop, no claim
   of repaired artifact or Docker PASS.
7. D1 writes a new Gitea SHA: retest that **new** SHA; require typecheck,
   project tests, researcher acceptance, review-only PR and root
   revocation evidence. A subsequent write invalidates an older PASS.

## Preserve proof and report
Use the workflow's public sanitized success/failure artifact (14 days) and
encrypted private Runner evidence (7 days) under controlled access.
Keep raw prompts, full source, secrets, compiler private log and signed
credentials out of public artifacts. The private Runner evidence key must
already exist and is only checked for presence/format before generation.
The report must separately identify:
- diagnostic produced (Runner tested SHA and phase);
- diagnostic delivered to the permitted Backend D1 Task/model;
- repair write independently attested (path/signed epoch/new Gitea SHA);
- fresh Runner typecheck, tests and acceptance verified on that SHA;
- PR review-only and actual root revocation, not inferred from job color.
Record role calls, input/output tokens if observed, timeouts and provider
billing amount **only after checking provider console**. Public artifact
may state invoice cost unknown.
Separate `D0 success without D1`, `D1 attempted without confirmed edit`,
`D1 new edit but still FAIL`, and `D1 verified success`. Do not turn a
single successful scripted recovery into a general Gemini reliability claim.

## Exit
No further speculative source hardening or additional Full CI loops.
If all exact-SHA gates pass, the remaining decision is **explicit one-time
user authorization for the paid D0(+optional D1) experiment**.
