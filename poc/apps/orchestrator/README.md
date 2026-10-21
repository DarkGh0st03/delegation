# Orchestrator bootstrap utility

This application provides an **optional trusted Software Engineer → Orchestrator root-credential bootstrap command**. It is not the canonical three-agent Coordinator itself.

`src/bootstrap-engineer.ts` calls the Rust Delegation Adapter as the trusted Engineer identity, requests a root Delegation Credential with `ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY`, and prints a sanitized issuance summary.

```bash
npm --prefix poc run orchestrator:bootstrap
```

Required environment: `DELEGATION_ADAPTER_URL`, `ADAPTER_CALLER_ENGINEER`; optional root-credential ID/validity/status configuration appears in the source.

## Current execution path

The **actual** Account Suspension sequential workflow is implemented in `poc/packages/orchestrator-runtime/src/sequential-coordinator.ts`, started by `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`. It sends A2A tasks to Backend → Frontend → Test and uses the Gateway directly for branch and PR operations. It never performs automatic merge.

A green offline scripted test is not a paid live Gemini inference.

## Stage 9 — Trusted two-root Engineer authority (opt-in)

The reusable trusted backend contract lives in
`poc/packages/orchestrator-runtime/src/trusted-engineer-authority.ts`.
**It is not installed as a Gemini FunctionTool or exposed over A2A/MCP.**
This package's existing `bootstrap-engineer.ts` command still creates
the old IAM Console template root and is unchanged.

The new `TrustedEngineerAuthoritySession` has two explicit operations:

1. `startPlanning(root)` issues a new Rust Engineer→Orchestrator root
   credential valid for at most **900 seconds**. All privileges are
   derived by trusted code from a **pre-validated repository snapshot**
   (repository identity, pinned base SHA, directory list and file list).
   They consist only of `read_repository`, `list_directory` and
   `read_file` permissions with exact `main` resource URIs. There is
   **no write, test, branch-create or PR permission** in this root.
2. `approveAndIssueOperationalRoot(root)` first retrieves the
   **persisted authenticated** plan/approval from a `TrustedApprovalStore`
   supplied by a future Engineer backend. It verifies Engineer identity,
   repository/base revision, immutable plan version/digest, task/agent
   permission assignments, the authoritative Rust Operation catalog,
   supported Gateway tools, canonical URIs and denial of main writes.
   It then requires an acknowledged **irreversible revocation** of the
   provisional root via the Engineer-authenticated Adapter endpoint
   `/v1/credentials/status`. Only afterwards does it issue a **new
   independent** Engineer→Orchestrator root containing precisely the
   approved permissions (maximum 128). The second credential must
   have a new ID and a different revocation status entry.

On any revocation uncertainty the session fails closed. The old
provisional DC may still exist until its short TTL expires in a
failed network situation, so **no operational DC is issued** until a
trusted operator reconciles the incident. Roots are still verified
by the Rust Core and Gateway policy; a credential alone **does not**
authorize an action absent approved-plan compliance.

### Important limits of this stage

The `TrustedApprovalStore` is **an interface**; it does not yet
authenticate actual GUI logins, persist immutable approval records, or
prove real human consent. CI supplies an explicitly simulated
trusted-store fixture. Nobody may treat a user-controlled plan JSON,
a SHA digest or the current mock UI as authenticated approval.

The repository manifest is **trusted input** to the module; later
bootstrap logic must obtain it from a verified Gitea snapshot and
check the real HEAD against `base_revision`. Gateway discovery tools
currently resolve each read at a branch commit, but this stage does
not yet enforce a single *common* Git SHA across the whole Planning
session. That end-to-end revision binding must be completed before
live autonomous Planning.

The operational root permission union is derived from the approved
plan; runtime enforcement of the immutable plan and assigned Task at
**each Gateway provider effect** remains a separate mandatory
upcoming integration. No second plan engine or new trusted signing
keys have been introduced.

Offline tests:
```sh
node --test poc/packages/plan-contracts/test/*.test.mjs
npm --prefix poc run orchestrator-runtime:test
```

These tests use **no Gemini calls, no paid APIs and no real GUI approval**.

