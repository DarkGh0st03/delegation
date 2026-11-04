import type {SpecializedAgentRole} from "@thesis/agent-runtime";

/** Production launcher: no write/test MCP tools are enabled by default. */
export interface McpToolFlags{
  mcpUpdateFile?: true;
  mcpCreateFile?: true;
  mcpRunTests?: true;
}
type Engine="deterministic"|"adk";
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
 * R180 deployment boundary: the model-visible repository MCP route is
 * no longer a supported A2A production configuration. This does NOT disable
 * ADK FunctionTools -> Gateway or the trusted crypto-only MCP bridge.
 * Archived test harnesses may still call resolveMcpToolFlags directly.
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
