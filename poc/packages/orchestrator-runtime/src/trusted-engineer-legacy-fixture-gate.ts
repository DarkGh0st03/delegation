/**
 * R385.1: fail-closed gate for the historical Engineer MCP -> HTTP fixture.
 *
 * Never allow a direct import of this legacy fixture to bypass the owner
 * selector's native Rust requirement. Pure local validation; no secrets,
 * API keys, network I/O, model access or Rust authority are created here.
 */
export function assertLegacyEngineerHttpFixtureAllowed():void{
 if(process.env.DELEGATION_GATEWAY_ARCHITECTURE==="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP==="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE==="1"||
    process.env.ADAPTER_ENGINEER_NATIVE_SOCKET!==undefined)
  throw Error("Historical Engineer HTTP fixture unavailable in native authority-only mode");
}
