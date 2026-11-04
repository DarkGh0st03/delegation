/**
 * RETIRED standalone Shared MCP HTTP launcher.
 *
 * The canonical architecture is:
 * - ADK FunctionTools -> Gateway for repository and Runner effects;
 * - task-local in-process MCP SDK for approved cryptographic VP requests;
 * - one native Rust CryptoRuntime for Engineer root, Orchestrator child
 *   and delegated VP issuance, with Gateway/Core Rust verification.
 *
 * No Shared MCP HTTP service or private HTTP worker may be started from
 * this production package entrypoint. Historical compatibility modules
 * remain importable only by explicitly isolated migration tests.
 *
 * Keep this fail-closed stub instead of silently removing the npm script:
 * stale deployment commands must fail immediately and visibly.
 */
throw new Error("standalone_shared_mcp_launcher_retired");
