# Signed Gemini pilot — manual release checklist (2026-10-28)

**Scope:** One explicitly authorized, potentially billed Google Gemini API pilot of the signed-DAG Account Suspension scenario. It uses the isolated Gitea/Docker/EVM lab, a **signed Engineer TEST fixture** (not an actual human Engineer approval), and no merge to `main`. Preparation and offline workflows incur **zero Gemini inference calls**.

## 1. Preconditions — GO/NO-GO

- Work only on branch `refactor/post-prof-plan-contracts-20261021`, not `main`. From GitHub, copy the entire **40-character** commit SHA intended for the pilot, *after* the final preparation commit is complete.
- Require three independent SUCCESS runs **on that identical SHA**: `.github/workflows/functional-signed-dag-e2e.yml`, `.github/workflows/shared-mcp-real-positive-e2e.yml`, and `.github/workflows/cumulative-refactoring-offline.yml`. The manual workflow verifies these over the read-only GitHub Actions API. Any code change requires fresh CI.
- Inspect the real Google AI Studio project associated with the Gemini API key (the GitHub secret is named `Delegation_Thesis_Gemini`; the workflow cannot inspect it). Verify the requested `gemini-3.8-flash` model is available and the project's billing status is understood. The model metadata check does not generate responses.
- In [Google AI Studio](https://aistudio.google.com/), use **Spend → Monthly spend cap → Edit spend cap** for the exact billed project and choose a conservative cap appropriate to your budget (for a single research pilot, consider **US$5–10**, but this is a recommendation, **not a configured value**). If on Prepay, examine available credit and disable or constrain auto-reload as appropriate. Confirm any other active API keys and shared billing account usage. If spend-cap controls are not available, this checklist is **NO-GO** for the budget-limited pilot until you knowingly choose another acceptable protection.
- **Important:** Project caps are experimental and can be exceeded because billing processing/enforcement can lag **about 10 minutes**; long-running agent tasks may exceed the cap. This is **not** a hard per-call dollar ceiling. Our code has model-turn, output-token and per-call timeout controls, but cannot verify billing or guarantee charges. See [Google Gemini API billing](https://ai.google.dev/gemini-api/docs/billing/).
- Do not run until the user separately authorizes Gemini API charges. Typing the manual workflow consent is a fresh, deliberate user action; the assistant must not initiate it automatically.

## 2. Exact manual workflow inputs

Open GitHub **Actions → Gemini Real - Refactor Signed DAG Account Suspension Pilot (Manual Only) → Run workflow**. Select **`refactor/post-prof-plan-contracts-20261021`**. Complete the inputs:

| Input | Required value |
| --- | --- |
| `authorization` | `I AUTHORIZE GEMINI API CHARGES` |
| `model` | `gemini-3.8-flash` |
| `pinned_commit_sha` | Exact 40-character SHA of the selected, green commit |
| `billing_cap_acknowledgement` | `I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES` |
| `thinking_level` | `LOW` |

The code will **fail closed** unless the pinned SHA matches GitHub's checkout SHA, the acknowledgement matches exactly, and the three CI gates passed on that SHA. GitHub Actions alone cannot inspect your AI Studio spend-cap setting. The acknowledgement is **user attestation, not a verified Google billing configuration**.

## 3. Limits and outputs

Planner: at most **20** turns; Backend: **17**; Frontend: **11**; Test: **6**. Each delegated model call is configured for at most **8,192 output tokens** and a **120,000 ms** timeout. This configuration does **not** cap input tokens, provider retries, or monetary charges.

The workflow must produce a sanitized success or failure report containing model usage **when reported**, no prompts or secrets, and no unsupported assertion that the invoice is zero. Model-generated changes are bounded by the Engineer-signed test DAG, Gateway, OPA, VP/DC, real Gitea, Docker acceptance and final SHA checks. **Human approval is not part of this test** and must not be claimed.

## 4. After the run

Review the GitHub Actions result and sanitized artifact `four-gemini-signed-account-suspension-<run_id>`, plus the actual project **Usage/Spend** and billing records in AI Studio. If the run fails, preserve the sanitized diagnostic; do not re-run it automatically or bypass the same-SHA gate. Even if it passes, keep `main` untouched and do not merge the PR without a separate review.

**Authority references:** https://ai.google.dev/gemini-api/docs/billing/ and https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/
