/**
 * R322 — authenticated, owner-only Unix control transport.
 * Neither route is HTTP-TCP, A2A, MCP or an ADK FunctionTool. The two
 * directions use DIFFERENT HMAC keys and domain-separated transcripts.
 */
import {createServer,request as httpRequest,type Server} from "node:http";
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {Buffer} from "node:buffer";
import {lstat,chmod,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {loadTrustedPlanIpcSecret} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedEffectStagingTaskRegistry,
 type TrustedEffectTaskOwnerPins} from "./trusted-effect-staging-task-registry.ts";
import type {TrustedEffectStagingPort} from "./gateway-tool-client.ts";

type Channel="bind"|"stage";
const SETTINGS={
 bind:{route:"/v1/private-adk-effect-bind",
  domain:"delegation.authority.only.effect.bind.v1"},
 stage:{route:"/v1/private-owner-effect-stage",
  domain:"delegation.authority.only.effect.stage.v1"}
} as const;
const TIME_WINDOW=30_000,BODY_MAX=4096,ACK_MAX=1024,MAX_NONCES=1024;
const MAC=/^[a-f0-9]{64}$/u,NONCE=/^[A-Za-z0-9_-]{22}$/u;
const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
type Role="backend"|"frontend"|"test";
const ROLES=["backend","frontend","test"] as const;
const REQUEST=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function deny(message:string):never{
 throw Error("Trusted authority-only effect IPC NO-GO: "+message);
}
function fileSocket(path:string):string{
 if(typeof path!=="string"||!path.startsWith("/")||
    path.length>95||path.includes("\0"))deny("short absolute Unix socket required");
 return resolve(path);
}
async function privateDirectory(path:string):Promise<void>{
 const s=await lstat(path);
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||
    (typeof process.getuid==="function"&&s.uid!==process.getuid()))
  deny("private owner-owned socket directory required");
}
function mac(ch:Channel,secret:Buffer,time:string,nonce:string,body:Buffer){
 const hash=createHash("sha256").update(body).digest("hex");
 return createHmac("sha256",secret).update([
  SETTINGS[ch].domain,"POST",SETTINGS[ch].route,time,nonce,hash
 ].join("\n")).digest("hex");
}
function answer(res:import("node:http").ServerResponse,status:number,value:object){
 res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
 res.end(JSON.stringify(value));
}
function record(x:unknown):Record<string,unknown>|null{
 return x!==null&&typeof x==="object"&&!Array.isArray(x)
  ?x as Record<string,unknown>:null;
}
function exactKeys(x:Record<string,unknown>,expected:string):boolean{
 return Object.keys(x).sort().join(",")===expected;
}
async function createPrivateServer(opts:{
 channel:Channel;socketPath:string;secretFile:string;
 handle:(body:unknown)=>Promise<object>|object;onClose?:()=>void;
}):Promise<{start():Promise<void>;close():Promise<void>;server:Server}>{
 const socket=fileSocket(opts.socketPath);
 await privateDirectory(dirname(socket));
 const secret=await loadTrustedPlanIpcSecret(opts.secretFile);
 let running=false,closed=false;
 const nonces=new Map<string,number>();
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=="POST"||req.url!==SETTINGS[opts.channel].route){
    answer(res,404,{error:"not_found"});return;
   }
   const time=req.headers["x-owner-effect-time"],
    nonce=req.headers["x-owner-effect-nonce"],
    signature=req.headers["x-owner-effect-mac"];
   if(typeof time!=="string"||!/^\d{13}$/u.test(time)||
      Math.abs(Date.now()-Number(time))>TIME_WINDOW||
      typeof nonce!=="string"||!NONCE.test(nonce)||
      typeof signature!=="string"||!MAC.test(signature)){
    answer(res,403,{error:"not_authenticated"});return;
   }
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req){
    const part=Buffer.from(chunk);size+=part.length;
    if(size>BODY_MAX){answer(res,413,{error:"oversized"});return;}
    chunks.push(part);
   }
   const body=Buffer.concat(chunks);
   if(body.length===0){answer(res,400,{error:"empty"});return;}
   const expected=mac(opts.channel,secret,time,nonce,body);
   if(!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex"))){
    answer(res,403,{error:"not_authenticated"});return;
   }
   const now=Date.now();
   for(const [n,expires] of nonces)if(expires<=now)nonces.delete(n);
   if(closed||nonces.has(nonce)||nonces.size>=MAX_NONCES){
    answer(res,409,{error:"replayed_or_closed"});return;
   }
   nonces.set(nonce,now+TIME_WINDOW); // before parsing or any effect
   const reply=await opts.handle(JSON.parse(body.toString("utf8")));
   if(!reply||JSON.stringify(reply).length>ACK_MAX)
    deny("noncanonical private receipt");
   answer(res,200,reply);
  }catch{
   if(!res.headersSent)answer(res,403,{error:"private_effect_denied"});
  }
 });
 return {
  server,
  async start(){
   if(running||closed)deny("socket already started or retired");
   await privateDirectory(dirname(socket));
   try{await lstat(socket);deny("preexisting private socket cannot be replaced");}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   await new Promise<void>((ok,bad)=>{
    const fail=(e:Error)=>{server.off("listening",ready);bad(e);};
    const ready=()=>{server.off("error",fail);ok();};
    server.once("error",fail);server.once("listening",ready);
    server.listen(socket);
   });
   try{await chmod(socket,0o600);}
   catch(e){server.close();throw e;}
   running=true;
  },
  async close(){
   if(closed)return;
   closed=true;
   opts.onClose?.(); // fence synchronously, before any await
   if(running){
    await new Promise<void>((ok,bad)=>{
     server.close(e=>e?bad(e):ok());
     server.closeAllConnections();
    });
    running=false;
   }
   try{const st=await lstat(socket);if(st.isSocket())await unlink(socket);}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
 };
}
class PrivateClient{
 readonly #channel:Channel;
 readonly #socket:string;
 readonly #secret:Buffer;
 private constructor(channel:Channel,socket:string,secret:Buffer){
  this.#channel=channel;this.#socket=socket;this.#secret=secret;
 }
 static async connect(channel:Channel,config:{socketPath:string;secretFile:string}){
  return new PrivateClient(channel,fileSocket(config.socketPath),
   await loadTrustedPlanIpcSecret(config.secretFile));
 }
 async send(value:object):Promise<Record<string,unknown>>{
  const body=Buffer.from(JSON.stringify(value));
  if(body.length===0||body.length>BODY_MAX)deny("invalid IPC request length");
  const time=String(Date.now()),nonce=randomBytes(16).toString("base64url");
  const signature=mac(this.#channel,this.#secret,time,nonce,body);
  return new Promise((ok,bad)=>{
   const request=httpRequest({
    socketPath:this.#socket,path:SETTINGS[this.#channel].route,
    method:"POST",timeout:5000,
    headers:{"content-type":"application/json","content-length":body.length,
     "x-owner-effect-time":time,"x-owner-effect-nonce":nonce,
     "x-owner-effect-mac":signature}
   },res=>{
    const chunks:Buffer[]=[];let size=0;
    res.on("data",(part:Buffer)=>{
     size+=part.length;
     if(size>ACK_MAX){request.destroy(Error("Oversized private receipt"));return;}
     chunks.push(part);
    });
    res.once("end",()=>{
     if(res.statusCode!==200){
      bad(Error("Authenticated private effect operation denied"));return;
     }
     try{
      const value:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const v=record(value);
      if(!v||v.ok!==true)deny("invalid private response");
      ok(v);
     }catch{bad(Error("Malformed private effect receipt"));}
    });
   });
   request.once("timeout",()=>request.destroy(Error("Private effect IPC timeout")));
   request.once("error",bad);
   request.end(body);
  });
 }
}

type PublicPins=Omit<TrustedEffectTaskOwnerPins,"effectStager">;
const pinFields="branch,childCredentialId,operation,path,planTaskId,presenterId,role,runtimeTaskId";
const noPathFields="branch,childCredentialId,operation,planTaskId,presenterId,role,runtimeTaskId";
function validPins(value:unknown):value is PublicPins{
 const v=record(value);
 if(!v||![pinFields,noPathFields].includes(Object.keys(v).sort().join(","))||
    typeof v.runtimeTaskId!=="string"||!DISPATCH.test(v.runtimeTaskId)||
    typeof v.planTaskId!=="string"||
    typeof v.childCredentialId!=="string"||
    typeof v.presenterId!=="string"||
    typeof v.branch!=="string"||
    !["backend","frontend","test"].includes(v.role as string)||
    !["update_file","run_tests"].includes(v.operation as string))
  return false;
 return v.operation==="run_tests" ? !("path" in v)
  :typeof v.path==="string";
}

/** Kept in the privileged owner process. Cannot be created by A2A payload. */
export class TrustedOwnerEffectStagingRegistry{
 readonly #entries=new Map<string,{
  port:TrustedEffectStagingPort;used:boolean;role?:Role
 }>();
 #retired=false;
 bindTask(runtimeTaskId:string,stager:TrustedEffectStagingPort,role?:Role):void{
  if(this.#retired||typeof runtimeTaskId!=="string"||
     !DISPATCH.test(runtimeTaskId)||typeof stager?.stage!=="function"||
     (role!==undefined&&!ROLES.includes(role))||
     this.#entries.has(runtimeTaskId))
   deny("owner staging requires unique pre-approved Task and concrete port");
  this.#entries.set(runtimeTaskId,{port:stager,used:false,...(role?{role}:{})});
 }
 async stage(runtimeTaskId:string,requestId:string,expectedRole?:Role):Promise<void>{
  const e=this.#entries.get(runtimeTaskId);
  if(this.#retired||!e||e.used||
     (expectedRole!==undefined&&
       (!ROLES.includes(expectedRole)||e.role!==expectedRole))||
     typeof requestId!=="string"||!REQUEST.test(requestId))
   deny("unknown, consumed or malformed owner staging request (including wrong role)");
  // Reject a cross-role HMAC stage WITHOUT consuming the real Task's
  // one-shot staging slot. Only a correct role can reserve the provider.
  e.used=true; // terminal on ambiguous network or provider outcome
  await e.port.stage(requestId); // the owner stage checks SAME prepared request store
 }
 retireFor(runtimeTaskId:string):void{
  const e=this.#entries.get(runtimeTaskId);
  if(!e)deny("unknown owner Task");
  e.used=true;
 }
 retireAll():void{
  this.#retired=true;
  for(const e of this.#entries.values())e.used=true;
 }
}

/**
 * Agent->Owner: task_id + request_id only, NEVER contents, HEAD, permission,
 * provider credentials or signer. Only the real owner stager can reserve.
 */
export async function createTrustedOwnerEffectStagingServer(config:{
 socketPath:string;secretFile:string;registry:TrustedOwnerEffectStagingRegistry;
 /** R332 owner-selected role on a role-isolated staging socket. */
 expectedRole?:Role;
}){
 if(!(config.registry instanceof TrustedOwnerEffectStagingRegistry)||
    (config.expectedRole!==undefined&&!ROLES.includes(config.expectedRole)))
  deny("concrete owner staging registry and trusted role required");
 return createPrivateServer({
  channel:"stage",socketPath:config.socketPath,secretFile:config.secretFile,
  onClose:()=>config.registry.retireAll(),
  handle:async body=>{
   const v=record(body);
   if(!v||!exactKeys(v,"action,request_id,runtime_task_id")||
      v.action!=="stage"||
      typeof v.runtime_task_id!=="string"||
      typeof v.request_id!=="string")deny("invalid owner stage request");
   await config.registry.stage(v.runtime_task_id,v.request_id,
    config.expectedRole);
   return {ok:true,status:"owner_intent_reserved_not_executed"};
  }
 });
}
export async function connectTrustedOwnerEffectStagingClient(
 config:{socketPath:string;secretFile:string}
){
 const channel=await PrivateClient.connect("stage",config);
 return Object.freeze({
  async stage(runtimeTaskId:string,requestId:string):Promise<void>{
   if(!DISPATCH.test(runtimeTaskId)||!REQUEST.test(requestId))
    deny("malformed agent Task or Gateway request ID");
   const v=await channel.send({
    action:"stage",runtime_task_id:runtimeTaskId,request_id:requestId
   });
   if(!exactKeys(v,"ok,status")||
      v.status!=="owner_intent_reserved_not_executed")
    deny("missing authenticated owner reservation acknowledgement");
  }
 });
}

/** Owner->Agent: register only non-secret exact Task/Child pins. */
export async function createTrustedEffectAgentBindingServer(config:{
 socketPath:string;secretFile:string;
 registry:TrustedEffectStagingTaskRegistry;
 ownerStageClient:Awaited<ReturnType<typeof connectTrustedOwnerEffectStagingClient>>;
 /** Production agents pin their own role before accepting owner Task binds. */
 expectedRole?:"backend"|"frontend"|"test";
}){
 if(config.expectedRole!==undefined&&
    !["backend","frontend","test"].includes(config.expectedRole))
  deny("invalid locally pinned Agent role");
 if(!(config.registry instanceof TrustedEffectStagingTaskRegistry)||
    !config.ownerStageClient||
    typeof config.ownerStageClient.stage!=="function")
  deny("actual agent registry and owner stage client required");
 return createPrivateServer({
  channel:"bind",socketPath:config.socketPath,secretFile:config.secretFile,
  onClose:()=>config.registry.retireAll(),
  handle:async body=>{
   const v=record(body);
   if(!v)deny("invalid Task binding envelope");
   if(exactKeys(v,"action,pins")&&v.action==="bind"&&validPins(v.pins)){
    const pins=v.pins;
    if(config.expectedRole!==undefined&&pins.role!==config.expectedRole)
     deny("owner Task role differs from local Agent host role");
    config.registry.bindTask({...pins,
     effectStager:{stage:async requestId=>{
      await config.ownerStageClient.stage(pins.runtimeTaskId,requestId);
      // This private ACK never claims a provider write.
      return {provider_write_authorized:false};
     }}
    });
    return {ok:true,status:"task_prebound_not_authorized"};
   }
   if(exactKeys(v,"action,runtime_task_id")&&v.action==="fence"&&
      typeof v.runtime_task_id==="string"&&DISPATCH.test(v.runtime_task_id)){
    config.registry.retireFor(v.runtime_task_id);
    return {ok:true,status:"task_fenced"};
   }
   deny("invalid exact signed Task control message");
  }
 });
}
export async function connectTrustedEffectAgentBindingClient(
 config:{socketPath:string;secretFile:string}
){
 const channel=await PrivateClient.connect("bind",config);
 return Object.freeze({
  async bindTask(pins:PublicPins):Promise<void>{
   if(!validPins(pins))deny("malformed owner Task pins");
   const v=await channel.send({action:"bind",pins});
   if(!exactKeys(v,"ok,status")||v.status!=="task_prebound_not_authorized")
    deny("missing authenticated agent prebind ACK");
  },
  async fence(runtimeTaskId:string):Promise<void>{
   if(!DISPATCH.test(runtimeTaskId))deny("malformed Task fence ID");
   const v=await channel.send({action:"fence",runtime_task_id:runtimeTaskId});
   if(!exactKeys(v,"ok,status")||v.status!=="task_fenced")
    deny("missing authenticated agent fence ACK");
  }
 });
}
