/**
 * R381.0 isolated MCP stdio capability broker (zero credentials).
 *
 * This subprocess receives ONLY the original owner-selected operation and
 * one opaque, randomly generated reference. The trusted parent retains the
 * native Rust signer/callback and executes it only after verifying the
 * broker's one-shot acknowledgement.
 *
 * This is NOT the final Rust-issuing interprocess MCP implementation and
 * cannot authorize itself, launch a provider effect or expose a network port.
 * stdout belongs exclusively to MCP JSON-RPC; never print there.
 */
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport}
 from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";

const TOOLS=Object.freeze({
  child_issue:"delegation_issue_child_owner_private",
  root_issue:"delegation_issue_root_owner_private",
  root_revoke:"delegation_revoke_root_owner_private",
  presentation_create:"delegation_create_presentation_owner_private"
});
const operation=process.env.OWNER_PRIVATE_MCP_OPERATION;
const requestRef=process.env.OWNER_PRIVATE_MCP_REF;
const tool=Object.hasOwn(TOOLS,operation??"")?TOOLS[operation]:undefined;
if(!tool||typeof requestRef!=="string"||
   !/^owner_crypto_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestRef))
  process.exitCode=1;
else{
  const server=new McpServer({
    name:"owner-private-interprocess-crypto-broker",version:"0.1.0"
  });
  let consumed=false;
  server.registerTool(tool,{
    description:"Opaque one-time private owner request; never issues a credential",
    inputSchema:{request_ref:z.literal(requestRef)}
  },async({request_ref})=>{
    if(consumed||request_ref!==requestRef)
      return {isError:true,content:[{type:"text",text:"request_denied"}]};
    consumed=true;
    const ack={ok:true,request_ref:requestRef,worker_pid:process.pid};
    return {structuredContent:ack,
      content:[{type:"text",text:"private_broker_acknowledged"}]};
  });
  const transport=new StdioServerTransport();
  await server.connect(transport);
}
