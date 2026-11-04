import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {z} from "zod";
import {ControlledToolError} from "./controlled-errors.ts";
import type {PreparedGatewayAuthorization} from "./delegation-evidence-handler.ts";
import type {CryptoPresentationPort} from "./trusted-crypto-mcp-bridge.ts";
import {PrivateMcpTaskRegistry} from "./private-mcp-task-registry.ts";

/**
 * R200: ephemeral, in-process MCP crypto session bound to one active Task.
 * No Shared MCP HTTP process, CryptoWorkerRouter or private Worker endpoint.
 * The model cannot see this session or its VP; only the trusted Gateway
 * execution client receives the signed presentation.
 */
export class LocalCryptoMcpBridge implements CryptoPresentationPort {
 readonly #taskId:string;
 readonly #registry:PrivateMcpTaskRegistry;
 constructor(config:{taskId:string;registry:PrivateMcpTaskRegistry}){
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(config.taskId)||
     !(config.registry instanceof PrivateMcpTaskRegistry))
   throw Error("Trusted local MCP requires a valid Task registry");
  this.#taskId=config.taskId;this.#registry=config.registry;
 }
 async createSignedPresentation(prepared:PreparedGatewayAuthorization):Promise<string>{
  const registry=this.#registry,taskId=this.#taskId;
  registry.stageGatewayChallenge(taskId,prepared);
  let consumed=false;
  const server=new McpServer({name:"trusted-task-local-crypto",version:"0.1.0"});
  server.registerTool("delegation_create_presentation",{
   description:"Privately create a Gateway-bound VP for the active signed Task.",
   inputSchema:{request_id:z.literal(prepared.request_id)}
  },async({request_id})=>{
   if(consumed)
    return {isError:true,content:[{type:"text" as const,text:"request_denied"}]};
   consumed=true;
   try{
    const token=registry.bearerFor(taskId);
    const result=await registry.invokeCrypto("Bearer "+token,{
     tool:"delegation_create_presentation",arguments:{request_id}
    });
    return {structuredContent:{ok:true,result},
     content:[{type:"text" as const,text:"private_cryptographic_proof_ready"}]};
   }catch{
    return {isError:true,content:[{type:"text" as const,text:"request_denied"}]};
   }
  });
  const [clientWire,serverWire]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:"trusted-task-crypto-client",version:"0.1.0"},
    {capabilities:{}});
  try{
   await Promise.all([server.connect(serverWire),client.connect(clientWire)]);
   const catalog=await client.listTools();
   if(catalog.tools.length!==1||
      catalog.tools[0]?.name!=="delegation_create_presentation")
    throw Error("Unexpected MCP capabilities");
   const response=await client.callTool({
    name:"delegation_create_presentation",
    arguments:{request_id:prepared.request_id}
   });
   const raw=response.structuredContent;
   if(response.isError===true||!raw||typeof raw!=="object"||
      Array.isArray(raw)||raw.ok!==true||!raw.result||
      typeof raw.result!=="object"||Array.isArray(raw.result))
    throw Error("MCP proof unavailable");
   const value=raw.result as Record<string,unknown>;
   if(Object.keys(value).sort().join(",")!==
        "credential_id,prepared,presenter_id,proof_ref,request_id"||
      value.prepared!==true||value.request_id!==prepared.request_id||
      typeof value.proof_ref!=="string"||
      !/^proof_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.proof_ref)||
      typeof value.credential_id!=="string"||!value.credential_id||
      typeof value.presenter_id!=="string"||!value.presenter_id)
    throw Error("Invalid signed proof binding");
   return registry.takeSignedPresentation(taskId,value.proof_ref);
  }catch{
   throw new ControlledToolError("authorization_denied",
     "Trusted local cryptographic presentation unavailable");
  }finally{
   await client.close().catch(()=>undefined);
   await server.close().catch(()=>undefined);
  }
 }
}
