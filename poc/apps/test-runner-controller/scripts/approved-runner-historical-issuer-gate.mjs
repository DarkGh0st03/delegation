/**
 * R407 — fail-closed selection of the HISTORICAL native-EVM/HTTP-Adapter
 * Runner fixture. Not a canonical Engineer credential port, signer or model
 * tool; does not issue authority, read tokens, access network or start Rust.
 *
 * In the normal scripted/fixture path the old HTTP issuer is not loaded.
 * If a canonical native profile is present, a user-selected historical
 * Runner flag must NOT downgrade it to HTTP.
 */
export function assertHistoricalRunnerEvmIssuerAllowed(
 env=process.env
){
 if(!env||env.APPROVED_RUNNER_NATIVE_EVM!=="1")
  throw Error("Historical Runner HTTP issuer needs explicit EVM fixture mode");
 if(env.DELEGATION_GATEWAY_ARCHITECTURE==="authority-only"||
    env.ENGINEER_CORE_NATIVE_MODE==="1"||
    env.ADAPTER_ENGINEER_NATIVE_SOCKET!==undefined||
    env.R38513_NATIVE_STRICT_FULL_RECOVERY==="1"||
    env.R3818_CANONICAL_NATIVE_MCP==="1")
  throw Error("Historical Runner HTTP issuer forbidden in canonical native authority-only mode");
}
