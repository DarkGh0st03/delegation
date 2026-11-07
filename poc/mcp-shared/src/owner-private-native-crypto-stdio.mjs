/**
 * R381.3 — real, owner-private MCP stdio -> SINGLE native Rust CryptoRuntime.
 *
 * Unlike the R381.0 acknowledgement-only broker, the isolated MCP process
 * performs the authenticated native Rust socket call and returns its result.
 * No second signer, HTTP listener, A2A route, model FunctionTool or fallback.
 * The owner supplies a role-scoped Rust socket bearer only across its private
 * stdio channel, NEVER via process argv/env or an agent/model prompt.
 *
 * Root issuance/revocation remain exclusively direct Engineer -> Rust.
 */
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport}
 from "@modelcontextprotocol/sdk/client/stdio.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport}
 from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import {OWNER_PRIVATE_CRYPTO_OPERATIONS as OPERATIONS}
 from "./owner-private-crypto-catalog.mjs";

const MODES=Object.freeze({
 child_issue:Object.freeze({operation:"issue_child",tool:OPERATIONS.child_issue.tool,
  error:OPERATIONS.child_issue.error}),
 presentation_create:Object.freeze({operation:"create_presentation",
  tool:OPERATIONS.presentation_create.tool,
  error:OPERATIONS.presentation_create.error})
});
const SELF=fileURLToPath(import.meta.url);
const REF=/^owner_crypto_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const validSocket=value=>typeof value==="string"&&value.startsWith("/")&&
  value.length<=100&&value.trim()===value&&value.length>1;
const validToken=value=>typeof value==="string"&&
  value.length>0&&value.length<=8192;
const validTimeout=value=>Number.isSafeInteger(value)&&value>=1&&value<=120000;
const validSignal=value=>value===undefined||
  (value!==null&&typeof value==="object"&&
   typeof value.aborted==="boolean"&&
   typeof value.addEventListener==="function"&&
   typeof value.removeEventListener==="function");

/**
 * Trusted OWNER ONLY. The operation cannot be chosen by an MCP client or
 * model; the worker's catalog is bound before the SDK connection opens.
 * Result (signed DC or VP) travels back only in this private MCP pipe.
 */
export function createOwnerPrivateNativeCryptoMcpSession(
 operation,config,body
){
 const mode=Object.hasOwn(MODES,operation)?MODES[operation]:undefined;
 if(!mode||!config||!validSocket(config.socketPath)||
    !validToken(config.bearerToken)||
    !validTimeout(config.timeoutMs??10000)||
    !validSignal(config.signal)||
    !object(body))throw Error("Owner-private native MCP configuration unavailable");
 const request=structuredClone(body);
 if(Buffer.byteLength(JSON.stringify(request))>110000)
  throw Error(mode.error);
 const ref="owner_crypto_"+randomUUID();
 let started=false,closed=false,client,transport,closing;
 const close=()=>{
  if(closing)return closing;
  closed=true;
  closing=(async()=>{
   try{await client?.close();}catch{/* no retry */}
   try{await transport?.close();}catch{/* broken wire */}
  })();
  return closing;
 };
 return Object.freeze({
  async invokeOnce(){
   if(started||closed||config.signal?.aborted)throw Error(mode.error);
   started=true;
   // Native IPC's own timeout does not bound a dead MCP handshake or
   // tool-discovery request. Bound the TOTAL lifetime (startup + request),
   // retaining 5 seconds for Node/SDK startup and shutdown overhead.
   const sessionBudgetMs=(config.timeoutMs??10000)+5000;
   let interrupt;
   const interrupted=new Promise((_,reject)=>{interrupt=reject;});
   // The first abort can race with the first MCP connect await.
   // Register a handler immediately so no rejected promise is unobserved.
   void interrupted.catch(()=>undefined);
   const onAbort=()=>{
    interrupt(Error(mode.error));
    void close();
   };
   let deadline;
   try{
    config.signal?.addEventListener("abort",onAbort,{once:true});
    deadline=setTimeout(onAbort,sessionBudgetMs);
    deadline.unref?.();
    if(closed||config.signal?.aborted)throw Error(mode.error);
    // No bearer, signed credential, source, API key or inherited secret
    // appears in the child environment or command line.
    transport=new StdioClientTransport({
     command:process.execPath,
     args:["--experimental-strip-types",SELF],
     env:{
      OWNER_PRIVATE_NATIVE_MCP_WORKER:"1",
      OWNER_PRIVATE_MCP_OPERATION:operation,
      OWNER_PRIVATE_MCP_REF:ref,
      PATH:process.env.PATH??"/usr/bin:/bin"
     },stderr:"pipe"
    });
    client=new Client({name:"trusted-owner-native-crypto-client",
      version:"0.1.0"},{capabilities:{}});
    await Promise.race([client.connect(transport),interrupted]);
    if(closed||config.signal?.aborted)throw Error(mode.error);
    const catalog=await Promise.race([client.listTools(),interrupted]);
    if(catalog.tools.length!==1||catalog.tools[0]?.name!==mode.tool||
       closed||config.signal?.aborted)
     throw Error(mode.error);
    // A Task cancelled during MCP discovery must never dispatch a
    // cryptographic native Rust call afterwards.
    const response=await Promise.race([client.callTool({
     name:mode.tool,
     arguments:{
      request_ref:ref,
      socket_path:config.socketPath,
      bearer_token:config.bearerToken,
      timeout_ms:config.timeoutMs??10000,
      native_body:request
     }
    }),interrupted]);
    const data=response.structuredContent;
    if(closed||response.isError===true||!object(data)||
       Object.keys(data).sort().join(",")!==
        "native_result,ok,request_ref,worker_pid"||
       data.ok!==true||data.request_ref!==ref||
       !Number.isSafeInteger(data.worker_pid)||data.worker_pid<=0||
       data.worker_pid===process.pid||!object(data.native_result))
     throw Error(mode.error);
    return structuredClone(data.native_result);
   }catch{
    // Never pass raw MCP stdout/stderr, Rust denial or credential bytes to
    // an untrusted caller or diagnostic record.
    throw Error(mode.error);
   }finally{
    clearTimeout(deadline);
    config.signal?.removeEventListener("abort",onAbort);
    await close();
   }
  },
  close
 });
}

async function runWorker(){
 const op=process.env.OWNER_PRIVATE_MCP_OPERATION;
 const ref=process.env.OWNER_PRIVATE_MCP_REF;
 const mode=Object.hasOwn(MODES,op??"")?MODES[op]:undefined;
 if(!mode||!REF.test(ref??"")){process.exitCode=1;return;}
 // Loaded ONLY in the child process. The original Engineer's native Rust
 // addon remains the sole signing service, accessible by authenticated IPC.
 const {invokeNativeCryptoWire}=await import(
  "./native-rust-transport.mjs");
 let consumed=false;
 const server=new McpServer({
  name:"owner-private-native-rust-mcp",version:"0.1.0"
 });
 server.registerTool(mode.tool,{
  description:"Trusted one-shot Rust IPC; no public client or model access",
  inputSchema:{
   request_ref:z.literal(ref),
   socket_path:z.string().min(2).max(100),
   bearer_token:z.string().min(1).max(8192),
   timeout_ms:z.number().int().min(1).max(120000),
   native_body:z.record(z.string(),z.unknown())
  }
 },async({request_ref,socket_path,bearer_token,timeout_ms,native_body})=>{
  if(consumed||request_ref!==ref||!validSocket(socket_path)||
     !validToken(bearer_token)||!validTimeout(timeout_ms))
   return {isError:true,content:[{type:"text",text:"request_denied"}]};
  consumed=true; // no retry even if native Rust response is ambiguous
  try{
   const result=await invokeNativeCryptoWire({
    socketPath:socket_path,token:bearer_token,timeoutMs:timeout_ms
   },mode.operation,native_body);
   if(!object(result))throw Error("denied");
   const ack={ok:true,request_ref:ref,worker_pid:process.pid,
    native_result:result};
   return {structuredContent:ack,
    content:[{type:"text",text:"private_native_rust_result_ready"}]};
  }catch{
   return {isError:true,content:[{type:"text",text:"request_denied"}]};
  }
 });
 await server.connect(new StdioServerTransport());
}
// No arbitrary caller can start a signer by importing this module.
if(process.env.OWNER_PRIVATE_NATIVE_MCP_WORKER==="1")await runWorker();
