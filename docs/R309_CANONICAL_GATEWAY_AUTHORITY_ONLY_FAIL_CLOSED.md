# R309 — fail-closed canonical Gateway authority-only constructor

## Scope

The authority-only operational path now requires an explicit `core-rust` verifier
mode and a mutable authenticated `gitea` provider mode. If a trusted owner
injects an implementation, the GatewayRuntime constructor rejects arbitrary
verifier ports and non-Gitea provider executors when native authority-only
admissions are enabled. This prevents an accidental test-only verifier or
mock provider from being installed in the canonical operational runtime.

The regression tests exercise only constructor denial paths, with deliberately
uninitialized admission instances. They never access Gitea, Rust, OPA, Docker,
GitHub secrets or paid models. The R305/R308 native integration fixture uses
the actual native Rust loader and a concrete GiteaExecutor subclass and is
the separate positive proof required after this guard.

## Limits and next stages

A TypeScript `instanceof` check does not authenticate a native binding or a
provider process. The trusted deployment owner must construct the actual
native Rust binding, verify the live chain/status and OPA, and securely
wire the owner-only CAS/Runner journals. The deployed `main.ts` still
installs the legacy signed-DAG plan when the old configuration is used;
it is **not** automatically migrated by this guard. No new public
authority-only enrollment HTTP route, automatic approval, or fallback
is introduced.

Before claiming a complete migration: validate R308 native Docker on
its exact commit, connect trusted owner startup, move Orchestrator/ADK/A2A
to the authority-only Task contract, verify negative cases and D1 recovery,
reconcile the divergent review branch and obtain human security sign-off.
