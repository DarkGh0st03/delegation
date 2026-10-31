/**
 * R151.41 — authenticated private Orchestrator -> Backend Task bind.
 *
 * Separate-process control of the one-use Backend discovery signer slot.
 * Only exact source-free Task pins cross this Unix HMAC channel. NEVER
 * put this endpoint in the ADK/A2A/MCP tool set or expose an HTTP port.
 * The Gateway independently admits Task scope and re-verifies each
 * signed VP/OPA before any Gitea access.
 */
import {createServer,request as httpRequest,type Server} from "node:http";
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {lstat,chmod,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {loadTrustedPlanIpcSecret} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedBackendDiscoveryTaskSlot} from "./trusted-backend-discovery-task-slot.ts";
import type {TrustedBackendDiscoveryTaskBindingPort} from
 "../../../packages/orchestrator-runtime/src/trusted-remote-discovery-a2a-handoff.ts";

const ROUTE="/v1/private-backend-discovery-task-binding";
const AGE=30_000,BODY_MAX=4096,RESPONSE_MAX=4096,MAX_NONCES=2048;
const WIRE_NONCE=/^[A-Za-z0-9_-]{22}$/u;
const MAC=/^[a-f0-9]{64}$/u;
const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const deny=(what:string):never=>{
 throw Error("Private Backend discovery binding NO-GO: "+what);
};
function socketPath(p:string){
 if(typeof p!=="string"||!p.startsWith("/")||p.length>95||
    p.includes("\0"))deny("short absolute Unix socket required");
 return resolve(p);
}
async function privateDir(p:string){
 const s=await lstat(p);
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||
    (typeof process.getuid==="function"&&s.uid!==process.getuid()))
  deny("private owner-owned socket directory required");
}
function signature(secret:Buffer,t:string,nonce:string,body:Buffer){
 const hash=createHash("sha256").update(body).digest("hex");
 return createHmac("sha256",secret).update([
  "delegation.backend.discovery.taskbinding.ipc.v1",
  "POST",ROUTE,t,nonce,hash
 ].join("\n")).digest("hex");
}
function answer(res:import("node:http").ServerResponse,status:number,body:object){
 res.writeHead(status,{
  "content-type":"application/json","cache-control":"no-store"
 });
 res.end(JSON.stringify(body));
}
type Prepare=Parameters<TrustedBackendDiscoveryTaskBindingPort["prepare"]>[0];
function validPrepare(x:unknown):x is Prepare{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
   "audience,branch,credential_id,path,plan_task_id,presenter_id,resource,runtime_task_id"&&
   typeof v.runtime_task_id==="string"&&DISPATCH.test(v.runtime_task_id)&&
   typeof v.plan_task_id==="string"&&ID.test(v.plan_task_id)&&
   typeof v.credential_id==="string"&&ID.test(v.credential_id)&&
   typeof v.presenter_id==="string"&&/^did:[A-Za-z0-9:._-]{6,240}$/u.test(v.presenter_id)&&
   typeof v.branch==="string"&&v.branch.length<=200&&
   typeof v.path==="string"&&v.path.length<=240&&
   typeof v.resource==="string"&&v.resource.length<=2048&&
   v.audience==="cloud-access-gateway";
}
type Wire={action:"prepare";pins:Prepare}|{action:"fence";runtime_task_id:string};
function parseWire(x:unknown):Wire{
 if(!x||typeof x!=="object"||Array.isArray(x))deny("invalid message");
 const obj=x as Record<string,unknown>,keys=Object.keys(obj).sort().join(",");
 if(obj.action==="prepare"&&keys==="action,pins"&&validPrepare(obj.pins))
  return {action:"prepare",pins:obj.pins};
 if(obj.action==="fence"&&keys==="action,runtime_task_id"&&
    typeof obj.runtime_task_id==="string"&&DISPATCH.test(obj.runtime_task_id))
  return {action:"fence",runtime_task_id:obj.runtime_task_id};
 deny("invalid authenticated Task operation or resource");
}
export async function createTrustedBackendDiscoveryTaskBindingServer(config:{
 socketPath:string;secretFile:string;slot:TrustedBackendDiscoveryTaskSlot;
}):Promise<{server:Server;start():Promise<void>;close():Promise<void>}>{
 const socket=socketPath(config.socketPath);
 await privateDir(dirname(socket));
 const secret=await loadTrustedPlanIpcSecret(config.secretFile);
 if(!(config.slot instanceof TrustedBackendDiscoveryTaskSlot))
  deny("private Backend holder slot required");
 let running=false,closed=false;
 const seen=new Map<string,number>();
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=="POST"||req.url!==ROUTE){
    answer(res,404,{error:"not_found"});return;
   }
   const t=req.headers["x-backend-bind-time"];
   const nonce=req.headers["x-backend-bind-nonce"];
   const mac=req.headers["x-backend-bind-mac"];
   if(typeof t!=="string"||!/^\d{13}$/u.test(t)||
      Math.abs(Date.now()-Number(t))>AGE||
      typeof nonce!=="string"||!WIRE_NONCE.test(nonce)||
      typeof mac!=="string"||!MAC.test(mac)){
    answer(res,403,{error:"not_authenticated"});return;
   }
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req){
    const part=Buffer.from(chunk);size+=part.length;
    if(size>BODY_MAX){answer(res,413,{error:"oversized"});return;}
    chunks.push(part);
   }
   const body=Buffer.concat(chunks);
   if(!body.length){answer(res,400,{error:"empty"});return;}
   const expected=signature(secret,t,nonce,body);
   if(!timingSafeEqual(Buffer.from(mac,"hex"),Buffer.from(expected,"hex"))){
    answer(res,403,{error:"not_authenticated"});return;
   }
   const now=Date.now();
   for(const [k,expires] of seen)if(expires<=now)seen.delete(k);
   if(seen.has(nonce)||seen.size>=MAX_NONCES||closed){
    answer(res,409,{error:"replayed_or_closed"});return;
   }
   seen.set(nonce,now+AGE); // reserve before any signer state mutation
   const wire=parseWire(JSON.parse(body.toString("utf8")));
   if(wire.action==="prepare"){
    const receipt=await config.slot.prepare(wire.pins);
    // Private source-free ACK cannot substitute for Gateway authorization.
    answer(res,200,{ok:true,receipt});
   }else{
    await config.slot.fence(wire.runtime_task_id);
    answer(res,200,{ok:true,fenced:true});
   }
  }catch{
   if(!res.headersSent)answer(res,403,{error:"backend_binding_denied"});
  }
 });
 return {
  server,
  async start(){
   if(running||closed)deny("socket already started/closed");
   await privateDir(dirname(socket));
   try{await lstat(socket);deny("preexisting socket cannot be replaced");}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   await new Promise<void>((ok,bad)=>{
    const onError=(e:Error)=>{server.off("listening",onReady);bad(e);};
    const onReady=()=>{server.off("error",onError);ok();};
    server.once("error",onError);server.once("listening",onReady);
    server.listen(socket);
   });
   try{await chmod(socket,0o600);}
   catch(e){server.close();throw e;}
   running=true;
  },
  async close(){
   closed=true;
   config.slot.retireAll();
   if(!running)return;
   await new Promise<void>((ok,bad)=>{
    server.close(e=>e?bad(e):ok());
    server.closeAllConnections();
   });
   running=false;
   try{const s=await lstat(socket);if(s.isSocket())await unlink(socket);}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
 };
}
/** Trusted Orchestrator client only; no presenter or bearer is sent. */
export class TrustedBackendDiscoveryTaskBindingSocketClient
 implements TrustedBackendDiscoveryTaskBindingPort{
 readonly #socket:string;
 readonly #secret:Buffer;
 private constructor(socket:string,secret:Buffer){
  this.#socket=socket;this.#secret=secret;
 }
 static async connect(config:{socketPath:string;secretFile:string}){
  return new TrustedBackendDiscoveryTaskBindingSocketClient(
   socketPath(config.socketPath),await loadTrustedPlanIpcSecret(config.secretFile)
  );
 }
 async #send(wire:Wire):Promise<Record<string,unknown>>{
  const body=Buffer.from(JSON.stringify(wire));
  if(body.length>BODY_MAX)deny("oversized private Task request");
  const t=String(Date.now()),nonce=randomBytes(16).toString("base64url");
  const mac=signature(this.#secret,t,nonce,body);
  return new Promise((ok,bad)=>{
   const req=httpRequest({
    socketPath:this.#socket,path:ROUTE,method:"POST",timeout:5000,
    headers:{
     "content-type":"application/json","content-length":body.length,
     "x-backend-bind-time":t,"x-backend-bind-nonce":nonce,
     "x-backend-bind-mac":mac
    }
   },res=>{
    let response="",count=0;
    res.on("data",(chunk:Buffer)=>{
     count+=chunk.length;
     if(count>RESPONSE_MAX){
      req.destroy(Error("oversized private binding response"));return;
     }
     response+=chunk.toString("utf8");
    });
    res.once("end",()=>{
     if(res.statusCode!==200){
      bad(Error("Backend private Task binding denied"));return;
     }
     try{
      const value=JSON.parse(response);
      if(!value||value.ok!==true||typeof value!=="object"||
         Array.isArray(value))throw Error("not_ok");
      ok(value);
     }catch{bad(Error("Malformed private Backend binding response"));}
    });
   });
   req.once("timeout",()=>req.destroy(Error("Backend binding IPC timeout")));
   req.once("error",bad);req.end(body);
  });
 }
 async prepare(input:Prepare){
  if(!validPrepare(input))deny("malformed source-free Task bind request");
  const response=await this.#send({action:"prepare",pins:input});
  if(Object.keys(response).sort().join(",")!=="ok,receipt")deny("invalid prebind ACK");
  const v=response.receipt;
  if(!v||typeof v!=="object"||Array.isArray(v))deny("missing prebind ACK");
  const r=v as Record<string,unknown>;
  if(Object.keys(r).sort().join(",")!==
      "credential_id,execution_authorized,plan_task_id,presenter_id,resource,runtime_task_id,source_read,status"||
     r.status!=="backend_discovery_read_prebound_not_executed"||
     r.runtime_task_id!==input.runtime_task_id||
     r.plan_task_id!==input.plan_task_id||
     r.credential_id!==input.credential_id||
     r.presenter_id!==input.presenter_id||
     r.resource!==input.resource||
     r.execution_authorized!==false||r.source_read!==false)
   deny("Backend prebind ACK differs from original signed Task");
  return Object.freeze({
   status:"backend_discovery_read_prebound_not_executed" as const,
   runtime_task_id:input.runtime_task_id,plan_task_id:input.plan_task_id,
   credential_id:input.credential_id,presenter_id:input.presenter_id,
   resource:input.resource,execution_authorized:false as const,
   source_read:false as const
  });
 }
 async fence(runtimeTaskId:string){
  if(!DISPATCH.test(runtimeTaskId))deny("invalid Backend retirement Task ID");
  const r=await this.#send({action:"fence",runtime_task_id:runtimeTaskId});
  if(Object.keys(r).sort().join(",")!=="fenced,ok"||r.fenced!==true)
   deny("missing authenticated Backend retirement ACK");
 }
}
