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
