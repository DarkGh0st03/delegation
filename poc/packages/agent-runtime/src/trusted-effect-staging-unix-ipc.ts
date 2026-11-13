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
import {assertTrustedOriginalScopedEffectDirectory,
 loadTrustedOriginalScopedEffectSecret,
 assertTrustedOriginalScopedEffectSocket,
 type TrustedOriginalScopedEffectRole}
 from "./trusted-effect-staging-scoped-linux.ts";
import {TrustedEffectStagingTaskRegistry,
 type TrustedEffectTaskOwnerPins} from "./trusted-effect-staging-task-registry.ts";
import {isProjectTestSource,MAX_TASK_READS,isTrustedProjectTestSourceProfile,IAM_CONSOLE_PROJECT_TEST_PROFILE}
 from "../../plan-contracts/src/gitea-permission-containment.mjs";
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
type Role=string;
const LEGACY_ROLES=["backend","frontend","test"] as const;
const ROLE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
/** Only the trusted host can provision this role and its separate 0600 IPC
 * socket/key. A role string alone can never grant a provider operation. */
const trustedPrivateRole=(value:unknown):value is string=>
 typeof value==="string"&&ROLE.test(value)&&!value.includes("..")&&
 value!=="orchestrator"&&value!=="constructor"&&value!=="prototype";
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
 /** Explicit role-pinned cross-UID layout; never from A2A/LLM content. */
 originalScopedEffectRole?:TrustedOriginalScopedEffectRole;
}):Promise<{start():Promise<void>;close():Promise<void>;server:Server}>{
 const socket=fileSocket(opts.socketPath);
 const scope=opts.originalScopedEffectRole;
 const side=opts.channel==="stage"?"owner" as const:"worker" as const;
 if(scope){
  await assertTrustedOriginalScopedEffectDirectory({
   channel:opts.channel,side,scope,socketPath:socket,
   secretFile:opts.secretFile
  });
 }else await privateDirectory(dirname(socket));
 const secret=scope?await loadTrustedOriginalScopedEffectSecret({
  channel:opts.channel,side,scope,socketPath:socket,
  secretFile:opts.secretFile
 }):await loadTrustedPlanIpcSecret(opts.secretFile);
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
   if(scope){
    await assertTrustedOriginalScopedEffectDirectory({
     channel:opts.channel,side,scope,socketPath:socket,
     secretFile:opts.secretFile
    });
   }else await privateDirectory(dirname(socket));
   try{await lstat(socket);deny("preexisting private socket cannot be replaced");}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   await new Promise<void>((ok,bad)=>{
    const fail=(e:Error)=>{server.off("listening",ready);bad(e);};
    const ready=()=>{server.off("error",fail);ok();};
    server.once("error",fail);server.once("listening",ready);
    server.listen(socket);
   });
   try{
    await chmod(socket,scope?0o660:0o600);
    if(scope)await assertTrustedOriginalScopedEffectSocket({
     channel:opts.channel,side,scope,socketPath:socket,
     secretFile:opts.secretFile
    });
   }catch(e){
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await unlink(socket).catch(()=>{});
    throw e;
   }
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
 static async connect(channel:Channel,config:{
  socketPath:string;secretFile:string;
  originalScopedEffectRole?:TrustedOriginalScopedEffectRole
 }){
  const socket=fileSocket(config.socketPath);
  const scope=config.originalScopedEffectRole;
  if(scope){
   const side=channel==="stage"?"worker" as const:"owner" as const;
   const secret=await loadTrustedOriginalScopedEffectSecret({
    channel,side,scope,socketPath:socket,secretFile:config.secretFile
   });
   await assertTrustedOriginalScopedEffectSocket({
    channel,side,scope,socketPath:socket,secretFile:config.secretFile
   });
   return new PrivateClient(channel,socket,secret);
  }
  return new PrivateClient(channel,socket,
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
function validPins(value:unknown,expectedRole:Role|undefined,testSources:unknown):value is PublicPins{
 const v=record(value);
 if(!v||![pinFields,noPathFields].includes(Object.keys(v).sort().join(","))||
    typeof v.runtimeTaskId!=="string"||!DISPATCH.test(v.runtimeTaskId)||
    typeof v.planTaskId!=="string"||
    typeof v.childCredentialId!=="string"||
    typeof v.presenterId!=="string"||
    typeof v.branch!=="string"||
    !trustedPrivateRole(v.role)||
     (!LEGACY_ROLES.includes(v.role as (typeof LEGACY_ROLES)[number])&&
       v.role!==expectedRole)||
    !["read_file","update_file","create_file","run_tests","read_then_update"].includes(v.operation as string)||
     (v.operation==="create_file"&&v.role==="test"&&
       (typeof v.path!=="string"||!isProjectTestSource(v.path,testSources))))
  return false;
 return v.operation==="run_tests" ? !("path" in v)
  :typeof v.path==="string";
}

/** Kept in the privileged owner process. Cannot be created by A2A payload. */
export class TrustedOwnerEffectStagingRegistry{
 readonly #entries=new Map<string,{
  port:TrustedEffectStagingPort;used:boolean;role?:Role;
  mixedPhase:"read_ready"|"read_pending"|"read_attested"|
   "update_pending"|"finished"|"failed";
  mixedRequest?:string;
  /** Signed reads (from the owner's manifest) that precede the one update. */
  plannedReads:number;attestedReads:number
 }>();
 #retired=false;
 bindTask(runtimeTaskId:string,stager:TrustedEffectStagingPort,role?:Role):void{
  if(this.#retired||typeof runtimeTaskId!=="string"||
     !DISPATCH.test(runtimeTaskId)||typeof stager?.stage!=="function"||
     (role!==undefined&&!trustedPrivateRole(role))||
     this.#entries.has(runtimeTaskId))
   deny("owner staging requires unique pre-approved Task and concrete port");
  const mixed=stager.stagedTool==="read_then_update";
  if(mixed&&(typeof stager.attest!=="function"||
     !Number.isSafeInteger(stager.plannedReads)||
     stager.plannedReads!<1||stager.plannedReads!>MAX_TASK_READS))
   deny("mixed owner Task lacks independent attestation port or read count");
  this.#entries.set(runtimeTaskId,{port:stager,used:false,
   mixedPhase:"read_ready",plannedReads:mixed?stager.plannedReads!:0,attestedReads:0,
   ...(role?{role}:{})});
 }
 async stage(runtimeTaskId:string,requestId:string,expectedRole?:Role):Promise<void>{
  const e=this.#entries.get(runtimeTaskId);
  if(this.#retired||!e||
     (e.port.stagedTool==="read_then_update"
       ? e.mixedPhase!=="read_ready"&&e.mixedPhase!=="read_attested"
       : e.used)||
     (expectedRole!==undefined
       ?(!trustedPrivateRole(expectedRole)||e.role!==expectedRole)
       :e.role!==undefined&&!LEGACY_ROLES.includes(
         e.role as (typeof LEGACY_ROLES)[number]))||
     typeof requestId!=="string"||!REQUEST.test(requestId))
   deny("unknown, consumed or malformed owner staging request (including wrong role)");
  // Reject a cross-role HMAC stage WITHOUT consuming the real Task's
  // one-shot staging slot. Only a correct role can reserve the provider.
  if(e.port.stagedTool==="read_then_update"){
   // Every signed read is attested before the single update is staged.
   e.mixedPhase=e.attestedReads<e.plannedReads?"read_pending":"update_pending";
   e.mixedRequest=requestId;
   try{await e.port.stage(requestId);}
   catch(error){e.mixedPhase="failed";throw error;}
  }else{
   e.used=true; // terminal on ambiguous network or provider outcome
   await e.port.stage(requestId);
  }
 }
 async attest(runtimeTaskId:string,requestId:string,
  tool:"read_file"|"update_file",expectedRole?:Role):Promise<void>{
  const e=this.#entries.get(runtimeTaskId);
  if(this.#retired||!e||e.port.stagedTool!=="read_then_update"||
     typeof e.port.attest!=="function"||
     (expectedRole!==undefined?e.role!==expectedRole:
      e.role!==undefined&&!LEGACY_ROLES.includes(
       e.role as (typeof LEGACY_ROLES)[number]))||
     !REQUEST.test(requestId)||e.mixedRequest!==requestId||
     (e.mixedPhase!=="read_pending"&&e.mixedPhase!=="update_pending")||
     tool!==(e.mixedPhase==="read_pending"?"read_file":"update_file"))
   deny("mixed native effect is not ready for independent attestation");
  const phase=e.mixedPhase;
  e.mixedPhase="failed"; // no repeated attestation after ambiguous outcomes
  await e.port.attest(requestId,tool);
  if(phase==="read_pending")e.attestedReads+=1;
  e.mixedPhase=phase==="read_pending"?"read_attested":"finished";
 }
 async reportNoChange(runtimeTaskId:string,requestId:string,expectedRole?:Role):Promise<void>{
  const e=this.#entries.get(runtimeTaskId);
  if(this.#retired||!e||!expectedRole||expectedRole==="test"||e.role!==expectedRole||
     e.port.stagedTool!=="read_then_update"||e.mixedPhase!=="read_attested"||
     e.mixedRequest!==requestId||typeof e.port.reportNoChange!=="function")
   deny("no-change report requires the role-authenticated original attested read");
  e.mixedPhase="failed";
  await e.port.reportNoChange(requestId);
 }
 retireFor(runtimeTaskId:string):void{
  const e=this.#entries.get(runtimeTaskId);
  if(!e)deny("unknown owner Task");
  e.used=true;e.mixedPhase="failed";
 }
 retireAll():void{
  this.#retired=true;
  for(const e of this.#entries.values()){
   e.used=true;e.mixedPhase="failed";
  }
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
 originalScopedEffectRole?:TrustedOriginalScopedEffectRole;
}){
 if(config.originalScopedEffectRole&&
    config.expectedRole!==config.originalScopedEffectRole.role)
  deny("owner staging role differs from cross-UID IPC scope");
 if(!(config.registry instanceof TrustedOwnerEffectStagingRegistry)||
    (config.expectedRole!==undefined&&!trustedPrivateRole(config.expectedRole)))
  deny("concrete owner staging registry and trusted role required");
 return createPrivateServer({
  channel:"stage",socketPath:config.socketPath,secretFile:config.secretFile,
  originalScopedEffectRole:config.originalScopedEffectRole,
  onClose:()=>config.registry.retireAll(),
  handle:async body=>{
   const v=record(body);
   if(!v||typeof v.runtime_task_id!=="string"||
      typeof v.request_id!=="string")deny("invalid owner stage request");
   if(exactKeys(v,"action,request_id,runtime_task_id")&&v.action==="stage"){
    await config.registry.stage(v.runtime_task_id,v.request_id,
     config.expectedRole);
    return {ok:true,status:"owner_intent_reserved_not_executed"};
   }
   if(exactKeys(v,"action,request_id,runtime_task_id,tool")&&
      v.action==="attest"&&(v.tool==="read_file"||v.tool==="update_file")){
    await config.registry.attest(v.runtime_task_id,v.request_id,v.tool,
     config.expectedRole);
    return {ok:true,status:"owner_native_effect_independently_attested"};
   }
   if(exactKeys(v,"action,request_id,runtime_task_id")&&v.action==="report_no_change"){
    await config.registry.reportNoChange(v.runtime_task_id,v.request_id,config.expectedRole);
    return {ok:true,status:"owner_no_change_report_fenced"};
   }
   deny("invalid private owner action or attestation operation");
  }
 });
}
export async function connectTrustedOwnerEffectStagingClient(
 config:{socketPath:string;secretFile:string;expectedRole?:Role;
  originalScopedEffectRole?:TrustedOriginalScopedEffectRole}
){
 if(config.originalScopedEffectRole&&
    config.expectedRole!==config.originalScopedEffectRole.role)
  deny("worker staging role differs from cross-UID IPC scope");
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
  },
  async reportNoChange(runtimeTaskId:string,requestId:string):Promise<void>{
   if(!DISPATCH.test(runtimeTaskId)||!REQUEST.test(requestId))
    deny("malformed agent no-change report");
   const v=await channel.send({action:"report_no_change",runtime_task_id:runtimeTaskId,
    request_id:requestId});
   if(!exactKeys(v,"ok,status")||v.status!=="owner_no_change_report_fenced")
    deny("missing authenticated no-change acknowledgement");
  },
  async attest(runtimeTaskId:string,requestId:string,
   tool:"read_file"|"update_file"):Promise<void>{
   if(!DISPATCH.test(runtimeTaskId)||!REQUEST.test(requestId)||
      !["read_file","update_file"].includes(tool))
    deny("malformed agent attestation or Gateway request ID");
   const v=await channel.send({action:"attest",runtime_task_id:runtimeTaskId,
    request_id:requestId,tool});
   if(!exactKeys(v,"ok,status")||
      v.status!=="owner_native_effect_independently_attested")
    deny("missing independent owner attestation acknowledgement");
  }
 });
}

/** Owner->Agent: register only non-secret exact Task/Child pins. */
export async function createTrustedEffectAgentBindingServer(config:{
 socketPath:string;secretFile:string;
 registry:TrustedEffectStagingTaskRegistry;
 ownerStageClient:Pick<Awaited<ReturnType<typeof connectTrustedOwnerEffectStagingClient>>,"stage"> &
  Partial<Pick<Awaited<ReturnType<typeof connectTrustedOwnerEffectStagingClient>>,"attest"|"reportNoChange">>;
 /** Production agents pin their own role before accepting owner Task binds. */
 expectedRole?:Role;
 /** Original Rust MCP signer DID, pinned by the trusted owner bootstrap,
  * never inferred from an untrusted A2A Card or request body. */
 expectedPresenterDid?:string;
 originalScopedEffectRole?:TrustedOriginalScopedEffectRole;
}){
 if(config.originalScopedEffectRole&&
    config.expectedRole!==config.originalScopedEffectRole.role)
  deny("worker bind role differs from cross-UID IPC scope");
 if(config.expectedRole!==undefined&&
    !trustedPrivateRole(config.expectedRole))
  deny("invalid locally pinned Agent role");
 if(config.expectedPresenterDid!==undefined&&(
     !config.expectedRole||
     typeof config.expectedPresenterDid!=="string"||
     !/^did:[A-Za-z0-9:._-]{6,240}$/u.test(config.expectedPresenterDid)))
  deny("invalid owner-pinned native Rust signer DID");
 if(!(config.registry instanceof TrustedEffectStagingTaskRegistry)||
    !config.ownerStageClient||
    typeof config.ownerStageClient.stage!=="function")
  deny("actual agent registry and owner stage client required");
 return createPrivateServer({
  channel:"bind",socketPath:config.socketPath,secretFile:config.secretFile,
  originalScopedEffectRole:config.originalScopedEffectRole,
  onClose:()=>config.registry.retireAll(),
  handle:async body=>{
   const v=record(body);
   if(!v)deny("invalid Task binding envelope");
   if(exactKeys(v,"action,pins")&&v.action==="bind"&&validPins(v.pins,config.expectedRole,config.registry.projectTestSourceProfile)){
    const pins=v.pins;
    if(config.expectedRole!==undefined&&pins.role!==config.expectedRole)
     deny("owner Task role differs from local Agent host role");
    // A role-correct HMAC never makes a different signed Child DID valid.
    // On the native isolated worker, bind the original signer/Card DID to
    // the original trusted Coordinator/Child presenter BEFORE any Task.
    if(config.expectedPresenterDid!==undefined&&
       pins.presenterId!==config.expectedPresenterDid)
     deny("signed Child presenter differs from original native signer DID");
    if(pins.operation==="read_then_update"&&
       typeof config.ownerStageClient.attest!=="function")
     deny("mixed Task needs original private independent attestation channel");
    config.registry.bindTask({...pins,
     effectStager:{
      ...(pins.operation==="read_then_update"
       ?{stagedTool:"read_then_update" as const,
         ...(config.ownerStageClient.reportNoChange?{
          reportNoChange:(requestId:string)=>
           config.ownerStageClient.reportNoChange!(pins.runtimeTaskId,requestId)
         }:{}),
         attest:async(requestId:string,tool:"read_file"|"update_file")=>{
          await config.ownerStageClient.attest!(pins.runtimeTaskId,requestId,tool);
         }}:{}),
      ...(pins.operation==="create_file"?{
       // The private owner may prebind exactly one CREATE. For Test, the
       // immutable owner Task pins must be a canonical project test source;
       // this discovery hint does not grant Gateway/Rust/OPA authority.
       stagedTool:"create_file" as const
      }:{}),
      stage:async requestId=>{
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
 config:{socketPath:string;secretFile:string;expectedRole?:Role;
  originalScopedEffectRole?:TrustedOriginalScopedEffectRole;
  /** Test-source rule of the project profile (default: example repository). */
  projectTestSourceProfile?:unknown}
){
 const testSources=config.projectTestSourceProfile??IAM_CONSOLE_PROJECT_TEST_PROFILE;
 if(!isTrustedProjectTestSourceProfile(testSources))
  deny("project test-source profile must come from a trusted project profile");
 if(config.originalScopedEffectRole&&
    config.expectedRole!==config.originalScopedEffectRole.role)
  deny("owner bind role differs from cross-UID IPC scope");
 if(config.expectedRole!==undefined&&!trustedPrivateRole(config.expectedRole))
  deny("invalid trusted local binding-client role");
 const channel=await PrivateClient.connect("bind",config);
 return Object.freeze({
  async bindTask(pins:PublicPins):Promise<void>{
   if(!validPins(pins,config.expectedRole,testSources))
    deny("malformed owner Task pins");
   if(config.expectedRole!==undefined&&pins.role!==config.expectedRole)
    deny("wrong-role owner Task pins");
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
