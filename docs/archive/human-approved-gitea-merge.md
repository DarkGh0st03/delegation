# Explicit human-authorized Gitea merge (draft integration, 13 October 2026)

This document describes the **separate human action**, not a free regression test and not a Gemini workflow.

## Security boundary

The Orchestrator can propose a PR and run scoped ADK/A2A/MCP tasks. Agents, MCP tools, the Gateway and the trusted Security CI **cannot merge**. The privileged merge implementation is `poc/packages/orchestrator-runtime/src/trusted-merge.ts` and is intentionally **not exported from the agent-facing package barrel or registered as an agent tool**.

The only human-operated entrypoint is `poc/packages/orchestrator-runtime/scripts/human-merge.mjs --execute`, invoked by `.github/workflows/human-approved-gitea-merge.yml`.

The protected merge executor checks the live open PR, exact feature SHA, current `main` base SHA, branch-protection configuration, authentic latest approval from the configured Gitea reviewer on the same SHA, and the newest trusted CI success from a different service identity on the same SHA. It verifies a separate **non-admin** merge operator, repeats all readiness checks and asks Gitea for a merge with `head_commit_id`, `force_merge:false`, `merge_when_checks_succeed:false` and `delete_branch_after_merge:false`. Gitea must enforce branch protections atomically at merge time; client-side verification alone does not create an atomic lock.

There is no automatic trigger from `push`, `pull_request`, CI success or an agent artifact. No Gemini/OpenAI API key is needed.

## Deployment prerequisites (NOT configured automatically)

**Do not enable the manual merge in production until an administrator has reviewed the new workflow and granted access to the target Gitea instance.** The workflow file is present on the default GitHub branch. Availability in the Actions UI does **not** configure the required protected environment, authentic reviewer, production Gitea tokens or deployment controls. The successful real-Gemini test [run 38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436) used only **disposable Gitea**, created no genuine review and performed no persistent merge.

After code review, configure in GitHub repository settings:

1. Repository variable `THESIS_MERGE_GITHUB_OPERATOR`: the precise approved GitHub login of the human operator (a single login, not a list).
2. Environment `protected-gitea-merge` with **required reviewers**, restricted allowed deployment branches (only protected `main`), and environment secrets limited to this environment. Merely naming an environment in YAML does **not** configure environment protection.
3. Environment secrets:
   - `THESIS_MERGE_GITEA_URL` — trusted HTTPS Gitea origin; local-loopback HTTP is permitted for isolated tests only
   - `THESIS_MERGE_READ_TOKEN` — read-only Gitea repository auditor token
   - `THESIS_MERGE_PROTECTION_READ_TOKEN` — a separate read-scoped branch-protection inspector token
   - `THESIS_MERGE_WRITE_TOKEN` — distinct, least-privileged Gitea merge-operator token (non-admin account)
   - `THESIS_MERGE_REVIEWER_ID`, `THESIS_MERGE_REVIEWER_LOGIN` — real human reviewer Gitea identity
   - `THESIS_MERGE_CI_ID`, `THESIS_MERGE_CI_LOGIN` — trusted Security CI publisher Gitea identity
   - `THESIS_MERGE_OPERATOR_ID`, `THESIS_MERGE_OPERATOR_LOGIN` — separate merge account identity

The merge account must not be the reviewer, CI publisher, Gateway, Orchestrator, or an ADK/MCP service account. Do not expose any of these secrets to model prompts, user-facing agent tools, pull requests, test fixtures or application logs.

This flow **does not itself provision** Gitea, configure the GitHub environment, create a genuine human review, or deploy a CI status publisher for an external persistent Gitea. All prerequisites must be confirmed separately before live enablement.

## Operator procedure (an actual merge, NOT a test run)

Once a genuine reviewer has approved the exact Gitea PR revision and trusted CI has produced a successful attestation on that same revision, the configured GitHub operator may choose the **Human-Authorized Protected Gitea Merge** workflow from protected `main`. Enter:

- `pr_number`: exact number in `thesis/iam-console-poc`.
- `expected_head_sha`: exact, lowercase 40-character feature HEAD hash.
- `confirmation`: the exact text `MERGE PR #<number> AT <sha>`, with the literal values substituted.

A protected-environment reviewer then approves the GitHub job. That is a separate approval from the **Gitea PR review**: both are required when environment protection is configured.

The workflow rejects any event other than `workflow_dispatch`, wrong branch, wrong GitHub actor, changed triggering actor (including a rerun by someone else), wrong confirmation or malformed identifiers. It only checks the fixed Gitea repository `thesis/iam-console-poc` and branch `feature/account-suspension`. It checks the actual Gitea writer identity and denies admin or bot credentials. All other evidence is fetched afresh.

On any error, the script reports only a sanitized denial code and exits unsuccessfully; it does not print tokens, request bodies or URLs, and does not retry a rejected/ambiguous merge. Once Gitea reports a completed merge, it confirms the PR is merged and the target main revision moved.

## Verification and limitations

Existing automated free workflows exercise real Rust/Gateway/OPA/A2A/ADK, a shared MCP service and a real Docker Runner using an offline scripted model. The disposable positive-merge workflow explicitly labels the reviewer as **simulated** and uses an ephemeral local Gitea instance; this is not evidence that anyone approved a persistent PR.

Unit regressions: `manual-merge-intent.test.ts`, `trusted-merge.test.ts`, `merge-readiness.test.ts`. All free workflows can run automatically on pushes; **do not manually start each regression**. Only the eventual Gemini-billable workflow is intended to be manually launched by the user for testing. An actual production merge is a separate privileged human operation, not a test.

Future hardening before production exposure should verify repository-level Gitea protection semantics for the deployed Gitea version, ensure trusted CI and human review identities are securely operated, and audit commit provenance and exact-base concurrency around the actual merge API. **No persistent merge has been requested or performed in this development phase.**
