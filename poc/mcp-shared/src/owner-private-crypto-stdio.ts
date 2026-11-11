/**
 * R381.0 — experimental owner-only, INTERPROCESS MCP stdio transport.
 *
 * This intentionally implements only a one-time, opaque authorization
 * handshake across a real child-process boundary. The original trusted
 * owner keeps the Rust signer callback in its own process and invokes that
 * callback only after a valid SDK MCP response. No credential, VP, key,
 * Gateway token, provider data or permission crosses the broker channel.
 *
 * In particular this is NOT YET a standalone cryptographic MCP service:
 * native crypto still executes in the original owner. No public listener,
 * no old HTTP Adapter fallback, and no model-accessible FunctionTool.
 */
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport}
 from "@modelcontextprotocol/sdk/client/stdio.js";
import {OWNER_PRIVATE_CRYPTO_OPERATIONS as OPERATIONS}
 from "./owner-private-crypto-catalog.mjs";
import type {OwnerPrivateCryptoOperation}
 from "./owner-private-child-mcp.ts";

function denied(operation:OwnerPrivateCryptoOperation):Error{
  return Error(OPERATIONS[operation].error);
}

const BROKER=fileURLToPath(new URL(
 "./owner-private-crypto-stdio-server.mjs",import.meta.url));

function exactAck(value:unknown,ref:string):boolean{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join(",")==="ok,request_ref,worker_pid"&&
    v.ok===true&&v.request_ref===ref&&
    typeof v.worker_pid==="number"&&
    Number.isSafeInteger(v.worker_pid)&&v.worker_pid>0&&
    v.worker_pid!==process.pid;
}

export function createOwnerPrivateInterprocessMcpSession<T>(
  operation:OwnerPrivateCryptoOperation,privateEffect:()=>Promise<T>
):Readonly<{invokeOnce():Promise<T>;close():Promise<void>}>{
  if(!Object.hasOwn(OPERATIONS,operation)||typeof privateEffect!=="function")
    throw Error("Owner-private interprocess MCP operation unavailable");
  const ref="owner_crypto_"+randomUUID();
  const tool=OPERATIONS[operation].tool;
  let closed=false,started=false,client:Client|undefined;
  let transport:StdioClientTransport|undefined;
  let closing:Promise<void>|undefined;
  const close=():Promise<void>=>{
    if(closing)return closing;
    closed=true;
    closing=(async()=>{
      try{await client?.close();}catch{/* no retry after a broken wire */}
      try{await transport?.close();}catch{/* already broken */}
    })();
    return closing;
  };
  return Object.freeze({
    async invokeOnce():Promise<T>{
      if(started||closed)throw denied(operation);
      started=true;
      try{
        // Explicit minimal child environment. Parent-only private signing
        // material and any API keys MUST NOT be inherited.
        const env:Record<string,string>={
          OWNER_PRIVATE_MCP_REF:ref,
          OWNER_PRIVATE_MCP_OPERATION:operation,
          PATH:process.env.PATH??"/usr/bin:/bin"
        };
        transport=new StdioClientTransport({
          command:process.execPath,args:[BROKER],env,stderr:"pipe"
        });
        client=new Client({
          name:"trusted-owner-crypto-stdio-client",version:"0.1.0"
        },{capabilities:{}});
        await client.connect(transport);
        if(closed)throw denied(operation);
        const advertised=await client.listTools();
        if(advertised.tools.length!==1||
           advertised.tools[0]?.name!==tool)
          throw denied(operation);
        const response=await client.callTool({
          name:tool,arguments:{request_ref:ref}
        });
        if(closed||response.isError===true||
           !exactAck(response.structuredContent,ref))
          throw denied(operation);
        // The actual signer stays in this trusted owner and is consumed
        // only once. A missing ACK can never trigger the signing callback.
        return await privateEffect();
      }catch{
        // Do not leak child stderr, model payload, private signer error or
        // credential bytes to an untrusted caller.
        throw denied(operation);
      }finally{
        await close();
      }
    },
    close
  });
}
