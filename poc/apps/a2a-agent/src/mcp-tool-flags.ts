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
export function resolveMcpToolFlags(
  env:Record<string,string|undefined>,
  role:SpecializedAgentRole,
  engine:Engine,
  sharedMcpUrl:string|undefined
):McpToolFlags{
  const update=enabled(env,"ADK_MCP_UPDATE_FILE");
  const create=enabled(env,"ADK_MCP_CREATE_FILE");
  const runTests=enabled(env,"ADK_MCP_RUN_TESTS");
  if((update||create||runTests) && (engine!=="adk"||!sharedMcpUrl)){
    throw new Error("MCP write/test tools require ADK_MCP_SHARED_URL and the ADK engine");
  }
  if((create||runTests)&&role!=="test"){
    throw new Error("Only Test Agent can enable MCP create_file or run_tests");
  }
  return {
    ...(update?{mcpUpdateFile:true as const}:{}),
    ...(create?{mcpCreateFile:true as const}:{}),
    ...(runTests?{mcpRunTests:true as const}:{})
  };
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
