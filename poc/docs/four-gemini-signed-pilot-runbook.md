# Four-Gemini signed-DAG pilot — operator checklist (NO model calls in this document)

**Goal:** On the development branch, demonstrate that **genuine Gemini** Planner,
Backend, Frontend and Test Agents complete one account-suspension scenario
through signed task delegation, Gitea and real isolated Docker acceptance.

**Scope warning:** This *paid* GitHub Actions pilot uses an independently
identified **signed Engineer TEST fixture**, not a real human Engineer login.
The owner-only Engineer service/recovery tested in R49 is a separate route;
a pilot PASS does **not** mean that the private production Engineer system
has been exercised end-to-end. No automatic merge to `main`.

## 1. Before authorizing any billed run

1. Open the branch
   `refactor/post-prof-plan-contracts-20261021`. Copy its full **40-character
   HEAD SHA**, not a short commit prefix. Do not push further changes after
   checking the three CIs; any new commit requires new checks.
2. In GitHub Actions, verify **SUCCESS** on *that exact SHA* for **all three**:
   - `Cumulative Offline Refactoring Validation`
     (`.github/workflows/cumulative-refactoring-offline.yml`)
   - `Shared MCP Real Docker Acceptance E2E (Scripted, No AI Billing)`
     (`.github/workflows/shared-mcp-real-positive-e2e.yml`)
   - `Functional Signed DAG - Account Suspension (No AI Billing)`
     (`.github/workflows/functional-signed-dag-e2e.yml`).
   Missing/pending/cancelled runs are **NO-GO**, even if the other two pass.
   The third workflow now triggers automatically for relevant live source
   and test paths; it also supports a **manual, non-billable** dispatch.
3. Verify the repository Actions secret named
   `Delegation_Thesis_Gemini` is configured (do not reveal its value).
   Confirm that **your actual Gemini API project** has the spending/billing
   limits you accept. The workflow checks **an attestation, not a guaranteed
   monetary cap**; input tokens, retries and overages may still be billed.
4. Inspect the current `gemini-paid-shared-mcp-final.yml` at the **same SHA**.
   In particular, ensure that `APPROVED_RUNNER_SIGNED_DAG_RECOVERY` and
   `APPROVED_RUNNER_SIGNED_DAG_MULTI_TEST_TASKS` have **not** been enabled
   for the paid pilot. The additional R31-R49 recovery path is not a
   permissionless automatic fallback for a failed Test Agent.

## 2. Run exactly once, ONLY when ready to pay

In GitHub **Actions**, choose
**Gemini Real - Refactor Signed DAG Account Suspension Pilot (Manual Only)**,
choose **Run workflow**, select the development branch above, and enter:

| Field | Required value |
| --- | --- |
| `authorization` | `I AUTHORIZE GEMINI API CHARGES` |
| `model` | `gemini-3.8-flash` |
| `pinned_commit_sha` | Exact 40-character SHA from step 1 |
| `billing_cap_acknowledgement` | `I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES` |
| `thinking_level` | `LOW` |

The workflow first performs source, consent, 3-CI and model-access checks
**without generation**. Only a later step actually invokes the four paid
Gemini roles. This document/commit does **not** dispatch any workflow.

## 3. Determine success and what to do on failure

- **PASS** requires the workflow's sanitized success evidence in
  `four-gemini-signed-account-suspension-<run_id>`, including
  `four_real_models=true`, `docker_acceptance=pass`,
  `approval=signed_test_fixture_not_human` and valid nonzero per-role
  model-delegate observations. All four roles must run; a green offline
  scripted run is **not** enough.
- **FAIL**: inspect the **sanitized** JSON `four-gemini-pilot-failure.json`
  (stage, failure category, planning rejection, limited usage diagnostics,
  Docker/typecheck evidence). Do not paste Gemini keys, raw prompts, source
  logs, signed presentations or credentials into chat or public issues.
  Do not rerun immediately or increase turns until the concrete cause is
  identified and old authority is verifiably retired.
- In particular, the previous paid R28 trial reached Backend + Frontend,
  but Test could not fix a TypeScript typecheck failure within its approved
  budget. The present offline signed-DAG CI proves the **scripted**
  baseline/authorized repair, **not** that a paid Test Agent will certainly
  succeed on the next try. Expect the next real run to be an experiment, not
  a guaranteed green result.

**Stop condition tonight:** only edit code, complete all three zero-billing
CIs and record a frozen SHA. The user will authorize/launch the real paid
test separately.
