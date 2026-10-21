import {createSharedMcpHttpServer} from "./http-server.ts";
import {TaskRouter} from "./task-router.ts";
import type {AgentRole, VerificationKeys} from "./task-token.ts";
function required(name:string) {
  const v=process.env[name]?.trim();
  if (!v) throw new Error("Missing shared MCP configuration: "+name);
  return v.replaceAll("\\n","\n");
}
const roles=["backend","frontend","test"] as const satisfies readonly AgentRole[];
const verificationKeys=Object.fromEntries(roles.map(r=>[r,required("MCP_"+r.toUpperCase()+"_PUBLIC_KEY")])) as VerificationKeys;
const workers=Object.fromEntries(roles.map(r=>[r,{baseUrl:required("MCP_"+r.toUpperCase()+"_WORKER_URL")}])) as ConstructorParameters<typeof TaskRouter>[0];
const host=process.env.MCP_BIND_HOST??"127.0.0.1";
const port=Number(process.env.MCP_BIND_PORT??"8097");
if (!Number.isInteger(port)||port<1||port>65535) throw new Error("Invalid MCP port");
const toolProfile=process.env.MCP_TOOL_PROFILE??"legacy";
if(toolProfile!=="legacy"&&toolProfile!=="crypto"){
  throw new Error("MCP_TOOL_PROFILE must be legacy or crypto");
}
const server=createSharedMcpHttpServer({
  verificationKeys,router:new TaskRouter(workers),profile:toolProfile
});
server.listen(port,host,()=>{
  process.stdout.write(JSON.stringify({event:"mcp_shared_started",host,port})+"\n");
});
