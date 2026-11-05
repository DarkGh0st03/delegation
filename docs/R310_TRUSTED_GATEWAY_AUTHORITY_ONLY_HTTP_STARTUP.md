# R310 — trusted authority-only Gateway HTTP startup (owner entrypoint)

## Scope

The `GatewayRuntime` already supported native-scoped CAS and Docker
Runner ports in the R308 isolated fixture. The public Gateway CLI in
`poc/apps/gateway/src/main.ts` still instantiates the legacy
`approvedPlans` / `planningRevisions` route. R310 prevents mistakenly
starting that legacy CLI as an authority-only deployment.

`poc/apps/gateway/src/trusted-authority-only-host.ts` now exports
`createTrustedAuthorityOnlyGatewayServer` and
`startTrustedAuthorityOnlyGatewayServer`. These are **actual canonical
HTTP listener entrypoints**, callable only by a separately trusted owner
assembly in-process. They require a previously authenticated and active
authority-only Gateway admission and BOTH native-scoped mutation and
Runner executors bound to that same admission instance, plus the same
`InMemoryRequestStore` the owner uses to reserve effects.

The host constructs `GatewayRuntime` itself, forcing:
- `provider_mode=gitea`, `verifier_mode=core-rust` and OPA;
- the repository's fixed native Core Rust addon loader, not injected
  test verifier/Adapter; the addon fails closed when trust/status missing;
- the canonical real Gitea provider, not injected mock;
- independent owner-staged HEAD-CAS mutation and pinned Docker PASS
  evidence; no legacy-plan enrollment or API route;
- rejection of legacy `TRUSTED_PLAN_*` configuration and incompatible
  architecture selector values.

For the old CLI, `DELEGATION_GATEWAY_ARCHITECTURE=authority-only`
explicitly fails startup rather than silently running signed-DAG.
`legacy-signed-dag` (or omission for backward compatibility) permits
that original CLI; only the explicit in-process owner host is the new
authority-only path.

## Security and evidence boundaries

The host does not create the Engineer root, instantiate privileged
signers from environment variables, authenticate a human, install an
Orchestrator/ADK/A2A dispatcher or manage credential retirement. It
**does not yet constitute an end-to-end deployment** and must not be
started by an agent or GitHub Actions input. The owner still has to
construct all concrete capabilities after authenticated Ed25519 approval,
native Rust root issuance, live EVM status and Gateway admission, and
durably stage per-Task effects before HTTP calls.

The isolated new tests cover negative startup paths without contacting
providers. The R308 Docker test remains the positive native/OPA/Gitea/
Runner fixture, and an R310 HTTP-transport E2E is a separate next gate.
No Gemini or paid API calls are required.

## Next

Wire this programmatic host to the protected Coordinator owner/bootstrap,
then route one complete three-agent Task sequence through the real HTTP
listener and ADK/A2A bindings. Add D1 recovery, revoked-root and cross-
Task denial checks before retiring legacy operational entrypoints.
