/**
 * R187 — production A2A has NO MCP repository tool flag selector.
 * Any configured shared repository MCP endpoint or active legacy tool flag
 * fails closed. The separate crypto-only VP bridge is unaffected.
 */
function enabled(env:Record<string,string|undefined>,name:string):boolean{
  const value=env[name];
  if(value===undefined || value==="" || value==="false")return false;
  if(value==="true")return true;
  throw new Error(name+" must be exactly true or false");
}
/**
 * Enforce FunctionTools -> Gateway for repository and Runner operations.
 * Never install a repository/Runner MCPToolset from the A2A launcher.
 */
export function requireProductionDirectGatewayTools(
 env:Record<string,string|undefined>
):void{
 if(env.ADK_MCP_SHARED_URL!==undefined)
  throw Error("production_agent_requires_direct_gateway_tools");
 for(const name of ["ADK_MCP_UPDATE_FILE","ADK_MCP_CREATE_FILE","ADK_MCP_RUN_TESTS"])
  if(enabled(env,name))
   throw Error("production_agent_requires_direct_gateway_tools");
}


/**
 * A production ADK launcher is a canonical signed Task participant, not a
 * legacy crypto-only HTTP compatibility fixture. Its VP must come from the
 * SAME authenticated native Rust issuer that owns root/child DC state.
 * The caller enables APPROVED_RUNNER_NATIVE_MCP only after this validation.
 */
export function requireProductionNativeCrypto(
 env:Record<string,string|undefined>,engine:"adk"|"deterministic"
):void {
 if(engine!=="adk")return;
 const path=env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 if(typeof path!=="string"||!path.startsWith("/")||
    path.length>100||path.trim()!==path)
  throw Error("production_adk_requires_native_rust_crypto");
 if(env.ADK_MCP_CRYPTO_URL!==undefined)
  throw Error("production_adk_requires_task_local_crypto_mcp");
 if(env.APPROVED_RUNNER_NATIVE_MCP!==undefined&&
    env.APPROVED_RUNNER_NATIVE_MCP!=="1")
  throw Error("production_adk_requires_native_rust_crypto");
}
