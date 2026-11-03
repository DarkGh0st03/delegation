/**
 * R162: ephemeral OWNER-PRIVATE MCP cryptographic service.
 *
 * This is an in-process MCP SDK transport, NOT the public Agent MCP
 * listener, A2A server, HTTP endpoint or an ADK tool. Only a trusted owner
 * who already holds the callable may establish a session. A single opaque,
 * randomly generated ref is the entire MCP tool input; neither approval,
 * permissions, credential bytes, signing keys nor bearer are MCP arguments.
 * A Rust Adapter-backed signer callback remains the ONLY issuer of DCs.
 */
import {randomUUID} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {z} from "zod";

const TOOL="delegation_issue_child_owner_private";
const ERROR="Owner-private MCP child issuance unavailable";
export function createOwnerPrivateChildMcpSession<T>(
 issueTrustedChild:()=>Promise<T>
):Readonly<{invokeOnce():Promise<T>;close():Promise<void>}>{
 if(typeof issueTrustedChild!=="function")throw Error(ERROR);
 const requestRef="owner_issue_"+randomUUID();
 let issued=false,started=false,closed=false,completed=false;
 let credential:T|undefined;
 const server=new McpServer({
  name:"owner-private-delegation-issuance",version:"0.1.0"
 });
 server.registerTool(TOOL,{
  description:"Owner-internal single-use cryptographic request. No delegated Agent access.",
  inputSchema:{request_ref:z.literal(requestRef)}
 },async({request_ref})=>{
  if(issued||closed||request_ref!==requestRef)
   return {isError:true,content:[{type:"text" as const,text:"request_denied"}]};
  issued=true; // reserve BEFORE invoking possibly irreversible Rust signer
  try{
   credential=await issueTrustedChild();
   completed=true;
   // The signed credential remains in this private process only.
   // The MCP protocol contains an opaque ACK, never the credential.
   const ack={ok:true,request_ref:requestRef};
   return {structuredContent:ack,
    content:[{type:"text" as const,text:JSON.stringify(ack)}]};
  }catch{
   return {isError:true,content:[{
    type:"text" as const,text:"signer_unavailable"
   }]};
  }
 });
 const [clientWire,serverWire]=InMemoryTransport.createLinkedPair();
 const client=new Client({name:"owner-private-delegation-client",
  version:"0.1.0"},{capabilities:{}});
 const close=async()=>{
  if(closed)return;
  closed=true;
  await client.close().catch(()=>undefined);
  await server.close().catch(()=>undefined);
 };
 return Object.freeze({
  async invokeOnce():Promise<T>{
   if(started||closed)throw Error(ERROR);
   started=true;
   try{
    await Promise.all([
     server.connect(serverWire),client.connect(clientWire)
    ]);
    const response=await client.callTool({
     name:TOOL,arguments:{request_ref:requestRef}
    });
    const ack=response.structuredContent as
      {ok?:unknown;request_ref?:unknown}|undefined;
    if(response.isError===true||!completed||!ack||
       ack.ok!==true||ack.request_ref!==requestRef)
      throw Error(ERROR);
    return credential as T;
   }catch{
    // Errors remain private; do not expose raw Adapter or MCP data to a
    // public diagnostic ledger, ADK or another A2A participant.
    throw Error(ERROR);
   }finally{
    await close();
   }
  },
  close
 });
}
