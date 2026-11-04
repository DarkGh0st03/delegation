# Delegation — repository cleanup register (R229, 2026-11-04)

## Goal and ownership boundaries

The repository must implement the professor's *actual* architecture, not
merely rename an HTTP Adapter. The target is:

- Software Engineer (trusted Node host) -> native Rust Node-API -> **one**
  in-process `CryptoRuntime`, with no socket/HTTP/MCP intermediary for
  its own root issuance and revocation.
- Orchestrator / Backend / Frontend / Test -> one-shot task-local
  cryptographic MCP SDK -> authenticated local native Rust crypto operations
  on **that same runtime**. Repository, Gitea, PR and Runner actions go
  through Gateway FunctionTools, never Shared MCP.
- Gateway -> its existing **public-only** Rust Node-API verifier, then OPA.
  It cannot issue or modify credentials.

## Cleanup already executed

1. `poc/mcp-shared/src/main.ts` **physically removed** in R229. There
   is no longer a standalone Shared MCP executable.
2. `poc/mcp-shared/package.json` no longer has a `start` entry.
3. Canonical A2A `server.ts` no longer registers a private HTTP MCP
   worker; ADK uses only `LocalCryptoMcpBridge`.
4. The production A2A barrel does not export `TrustedCryptoMcpBridge`.
   `CryptoPresentationPort` has moved to a canonical transport-neutral
   module `crypto-presentation-port.ts`.
5. `poc/scripts/r165-mcp-factory-profile-audit.mjs`,
   `poc/scripts/test/r180-production-mcp-boundary.test.mjs` and
   `poc/mcp-shared/test/legacy-isolation.test.mjs` now REQUIRE that the
   old executable be absent.
6. `poc/scripts/r226-legacy-crypto-import-audit.mjs` inventories
   import/require/export edges to retired HTTP components and rejects
   source-level production dependencies. Fast CI runs this audit.

## Legacy candidates — do NOT blindly delete before test proof

| Candidate | Current reason to retain | Removal condition |
| --- | --- | --- |
| `poc/packages/agent-runtime/src/trusted-crypto-mcp-bridge.ts` | Isolated historical remote MCP SDK tests | Native owner CI + task-local MCP tests green; no importing production graph |
| `poc/packages/agent-runtime/src/private-mcp-worker-http.ts` | Isolated historical HTTP worker test | Runtime A2A route absence regression and replacement tests green |
| `poc/mcp-shared/src/crypto-worker-router.ts` | Isolated historical HTTP compatibility tests | Former remote bridge and router tests retired as a group |
| `poc/mcp-shared/src/http-server.ts` | Isolated MCP Streamable HTTP compatibility tests | Former listener tests retired as a group |
| `poc/packages/orchestrator-runtime/src/trusted-engineer-native-port.ts` | R224 baseline and migration fallback | Direct Engineer native EVM+signed DAG is green on one SHA |
| `poc/packages/orchestrator-runtime/src/authority-adapter-transport.ts` | Legacy adapter transport and historical fixtures | Exact import graph reviewed; no issuer/verification dependencies |
| `services/delegation-adapter/src/http.rs` and `main.rs` | Existing compatibility fixtures | Embedded Engineer owner is real EVM issuer; no HTTP service needed |

The `delegation-adapter` **Rust library** currently supplies shared
`CryptoRuntime` and caller-capability code to the direct addon. Do not
delete or duplicate this Rust crate merely because its historical HTTP
executable is to be retired. An eventual move into a more neutrally
named Rust crate is optional organization; it must preserve one issuer
instance, EVM trust/status and the signed delegated credential chain.

## Gates before declaring final migration

- [ ] `engineer-direct-native-contract.yml` **SUCCESS**: actual Rust
      Node-API compile, Engineer root, same-runtime Child and Agent VP,
      revoked root and socket role denial.
- [ ] True EVM + Gitea/Docker signed DAG and D1 with Engineer native mode
      enabled, without launching the legacy Rust Adapter HTTP process.
- [ ] Removal candidates verified by import audit and compatibility tests
      replaced with the canonical path; update every relevant CI job.
- [ ] Full free same-SHA CI green; no paid Gemini unless separately approved.

The Node-API native mode is **implemented but opt-in** while its own CI
gate is pending. A successful source edit or a green *older* R224 run
does not substitute for direct-Engineer EVM integration evidence.

## R230 — discovered blocker: Gateway still inspects issuer root via Adapter HTTP

Reviewing the actual canonical `poc/apps/gateway/native-test/
native-planning-read-core-evm-e2e.mjs` exposed an additional integration
dependency that must be migrated before deleting Rust Adapter HTTP:

- `poc/apps/gateway/src/trusted-gateway-native-root-status.ts`
  currently POSTs to the Adapter endpoints
  `/v1/credentials/root/inspect` and
  `/v1/credentials/status/inspect` to corroborate an issued
  preliminary/operational root and EVM-anchored revocation.
- The public-only `services/delegation-core-node` verifier already
  checks signed VPs directly using Core Rust, EVM/DID and status sources,
  but its exposed ABI does NOT itself replace that issuer-local root
  inventory/inspection contract.
- Therefore, merely switching the Engineer's own root issuer from
  the socket to the Node-API addon is NOT enough to run the current
  complete signed DAG without Adapter HTTP. The existing root-status
  audit and ownership must be explicitly migrated.

**Required design before removing the old HTTP process:** identify the
minimum trusted issuer-root evidence required by Planning/Owner D1;
make it available to the Gateway through a directly linked, public
Rust verification/source interface (or replace the dependency with
cryptographically verified issuer evidence), preserving live
EVM-anchored status checks and the original root identity/grants.
Never replace it with a JS boolean, a model claim, or an unauthenticated
cache. Maintain independent verifier and issuer roles.

Do **not** remove `trusted-gateway-native-root-status.ts` or its
corresponding tests until this replacement has a genuine EVM signed-DAG
test. This is a functional architecture gap, not only cosmetic cleanup.
The direct Engineer Node-API gate and all R229 deletions remain
separate, reversible changes while this boundary is resolved.

## R231 — status of R230 root-inspection blocker

The **implementation** blocker described above is now addressed in the
new native Engineer-owner mode. The one Rust runtime's socket supports
authenticated `read_issued_root` and `read_credential_status` for the
Gateway role only; `TrustedGatewayNativeRootStatusReader` selects
this source automatically with `ENGINEER_CORE_NATIVE_MODE=1`, and
fails closed on missing native transport rather than making Adapter
HTTP inspection requests.

The Gateway's native public verifier remains independent and direct;
this issuer-only inspection is separate corroboration. No
`/v1/credentials/*/inspect` HTTP service is necessary for this
read-only gate when the new mode is enabled. Existing noncanonical
compatibility fixtures still retain their HTTP path.

**Validation remains open:** Rust compilation and single-owner native
smoke, Fast CI, and *live* EVM-anchored root status / signed DAG with the
old Adapter service completely absent must all pass. Until then
`services/delegation-adapter/src/http.rs` and its legacy tests are
still retained. R231 is not a claim that the full HTTP Adapter is
physically removed from deployment.
