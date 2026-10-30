/**
 * Separate-process approved-plan control over an owner-only Unix socket.
 * Never mounted on public Gateway HTTP, Gemini, MCP or A2A.
 * Signed Engineer approval and Rust/OPA provider enforcement remain mandatory.
 */
import {createServer,request as httpRequest,type Server} from "node:http";
import {createHmac,createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {lstat,open,chmod,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {constants} from "node:fs";
import type {AgentRole} from "./types.ts";
import type {TrustedCompletionObservation} from "./trusted-task-observation.ts";
import {TrustedApprovedExecutionPlans,type TrustedRunnerFailure} from "./approved-execution-plans.ts";
import {TrustedPlanningRevisions} from "./planning-revisions.ts";
import {TrustedGatewaySignedEpochInspector} from "./trusted-gateway-signed-epoch-inspector.ts";

const ROUTE="/v1/private-plan-control";
const MAX_BODY=4096,MAX_NONCES=4096,MAX_AGE=30_000;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const MAC=/^[0-9a-f]{64}$/u;
const NONCE=/^[A-Za-z0-9_-]{22}$/u;
const ROLES=new Set(["orchestrator","backend","frontend","test"]);
type Command=
  |{action:"activate";session_id:string;base_revision:string}
  |{action:"bind";session_id:string;plan_task_id:string;runtime_task_id:string;role:AgentRole}
  |{action:"close";session_id:string}
  |{action:"retire";session_id:string}
  |{action:"retire_planning";session_id:string}
  |{action:"begin_planning";session_id:string;ttl_ms:number}
  |{action:"lease_status"}
  |{action:"renew_lease";session_id:string;plan_digest:string}
  |{action:"complete";runtime_task_id:string;observation:TrustedCompletionObservation}
  |{action:"confirm_test_failure";session_id:string;
     root_plan_digest:string;runtime_task_id:string}
  |{action:"read_test_failure";session_id:string;
     root_plan_digest:string;runtime_task_id:string}
  |{action:"admit_epoch";session_id:string;root_plan_digest:string;
     plan_digest:string;epoch:number}
  |{action:"inspect_signed_epoch";session_id:string;root_plan_digest:string;
     plan_digest:string;epoch:number}
  |{action:"inspect_native_root";session_id:string;root_plan_digest:string;
     plan_digest:string;epoch:number};

function fail(message:string):never{throw Error("Trusted plan IPC: "+message);}
function exact(x:unknown,fields:string[]):boolean{
  return x!==null&&typeof x==="object"&&!Array.isArray(x)&&
    Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
}
function validate(x:unknown):Command{
  if(!x||typeof x!=="object"||Array.isArray(x))fail("invalid control body");
  const o=x as Record<string,unknown>;
  if(o.action==="complete"&&exact(o,["action","runtime_task_id","observation"])&&
     typeof o.runtime_task_id==="string"&&ID.test(o.runtime_task_id)&&
     o.observation!==null&&typeof o.observation==="object"&&
     !Array.isArray(o.observation))return o as Command;
  if(o.action==="lease_status"&&exact(o,["action"]))return o as Command;
  const sessionOk=typeof o.session_id==="string"&&ID.test(o.session_id);
  if(!sessionOk)fail("invalid session ID");
  if(o.action==="activate"&&exact(o,["action","session_id","base_revision"])&&
     typeof o.base_revision==="string"&&SHA.test(o.base_revision))return o as Command;
  if(o.action==="bind"&&exact(o,["action","session_id","plan_task_id","runtime_task_id","role"])&&
     typeof o.plan_task_id==="string"&&ID.test(o.plan_task_id)&&
     typeof o.runtime_task_id==="string"&&ID.test(o.runtime_task_id)&&
     typeof o.role==="string"&&ROLES.has(o.role))return o as Command;
  if((o.action==="close"||o.action==="retire"||
      o.action==="retire_planning")&&
     exact(o,["action","session_id"]))return o as Command;
  if(o.action==="begin_planning"&&
     exact(o,["action","session_id","ttl_ms"])&&
     Number.isSafeInteger(o.ttl_ms)&&
     (o.ttl_ms as number)>=1&&(o.ttl_ms as number)<=900_000)
    return o as Command;
  if((o.action==="confirm_test_failure"||
      o.action==="read_test_failure")&&
     exact(o,["action","session_id","root_plan_digest","runtime_task_id"])&&
     typeof o.root_plan_digest==="string"&&MAC.test(o.root_plan_digest)&&
     typeof o.runtime_task_id==="string"&&ID.test(o.runtime_task_id))
    return o as Command;
  if((o.action==="admit_epoch"||
      o.action==="inspect_signed_epoch"||
      o.action==="inspect_native_root")&&
     exact(o,["action","session_id","root_plan_digest","plan_digest","epoch"])&&
     typeof o.root_plan_digest==="string"&&MAC.test(o.root_plan_digest)&&
     typeof o.plan_digest==="string"&&MAC.test(o.plan_digest)&&
     Number.isSafeInteger(o.epoch)&&
     (o.epoch as number)>=(o.action==="admit_epoch"?2:1)&&
     (o.epoch as number)<=3)
    return o as Command;
  if(o.action==="renew_lease"&&exact(o,["action","session_id","plan_digest"])&&
     typeof o.plan_digest==="string"&&MAC.test(o.plan_digest))
    return o as Command;
  return fail("unknown or malformed command");
}

/** Gateway-issued metadata only: no stdout/stderr, source, VP, DC or permission.
 * The allowlist protects both IPC serialization and the remote host client. */
const FAILURE_PHASES=new Set([
  "typecheck","backend_tests","frontend_tests","build",
  "playwright_e2e","researcher_acceptance"
]);
const FAILURE_KEYS=[
  "status","session_id","root_plan_digest","request_id","plan_task_id",
  "runtime_task_id","epoch_version","branch","tested_commit_sha",
  "first_failed_phase","typecheck_error_codes"
];
function boundedTestFailure(
  value:unknown,pins:Readonly<{
    session_id:string;root_plan_digest:string;runtime_task_id:string;
  }>
):Readonly<TrustedRunnerFailure>{
  if(!exact(value,FAILURE_KEYS))fail("invalid Gateway Test FAIL receipt");
  const r=value as Record<string,unknown>;
  if(r.status!=="validation_failed"||
     r.session_id!==pins.session_id||
     r.root_plan_digest!==pins.root_plan_digest||
     r.runtime_task_id!==pins.runtime_task_id||
     typeof r.request_id!=="string"||!ID.test(r.request_id)||
     typeof r.plan_task_id!=="string"||!ID.test(r.plan_task_id)||
     !Number.isSafeInteger(r.epoch_version)||
     (r.epoch_version as number)<1||(r.epoch_version as number)>3||
     typeof r.branch!=="string"||r.branch.length>160||
     !/^[A-Za-z0-9][A-Za-z0-9._/%-]*$/u.test(r.branch)||
     typeof r.tested_commit_sha!=="string"||!SHA.test(r.tested_commit_sha)||
     typeof r.first_failed_phase!=="string"||
     !FAILURE_PHASES.has(r.first_failed_phase)||
     !Array.isArray(r.typecheck_error_codes)||
     r.typecheck_error_codes.length>16||
     r.typecheck_error_codes.some(
       c=>typeof c!=="string"||!/^TS[0-9]{4}$/u.test(c)))
    fail("Gateway Test FAIL receipt failed source-free identity validation");
  return Object.freeze({
    status:"validation_failed" as const,
    session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
    request_id:r.request_id as string,plan_task_id:r.plan_task_id as string,
    runtime_task_id:pins.runtime_task_id,epoch_version:r.epoch_version as number,
    branch:r.branch as string,tested_commit_sha:r.tested_commit_sha as string,
    first_failed_phase:r.first_failed_phase as string,
    typecheck_error_codes:Object.freeze(
      [...r.typecheck_error_codes] as string[])
  });
}

function sign(secret:Buffer,timestamp:string,nonce:string,body:Buffer):string{
  const digest=createHash("sha256").update(body).digest("hex");
  return createHmac("sha256",secret)
    .update(["delegation.plan.ipc.v1","POST",ROUTE,timestamp,nonce,digest].join("\n"))
    .digest("hex");
}
function socketPath(path:string):string{
  if(typeof path!=="string"||!path.startsWith("/")||path.length>95||
     path.includes("\u0000"))fail("expected short absolute Unix socket path");
  return resolve(path);
}
async function ownerDirectory(dir:string):Promise<void>{
  const meta=await lstat(dir);
  if(!meta.isDirectory()||meta.isSymbolicLink()||(meta.mode&0o077)!==0){
    fail("socket and secret must have owner-only parent directories");
  }
}
export async function loadTrustedPlanIpcSecret(file:string):Promise<Buffer>{
  const path=resolve(file);
  await ownerDirectory(dirname(path));
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  let content:string;
  try{
    const meta=await fd.stat();
    if(!meta.isFile()||(meta.mode&0o077)!==0||meta.size<64||meta.size>65){
      fail("invalid owner-only IPC secret file");
    }
    content=await fd.readFile({encoding:"utf8"});
  }finally{await fd.close();}
  if(!/^[a-f0-9]{64}\n?$/u.test(content)){
    fail("secret must be 32 random bytes encoded in lowercase hex");
  }
  return Buffer.from(content.trim(),"hex");
}
function response(res:import("node:http").ServerResponse,status:number,value:object){
  res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
  res.end(JSON.stringify(value));
}

/** Uses the same registry instance as GatewayRuntime's prepare/execute. */
export async function createTrustedPlanIpcServer(config:{
  socketPath:string;secretFile:string;plans:TrustedApprovedExecutionPlans;
  /** Must be the EXACT registry instance used by GatewayRuntime prepare and
   * execute, not a newly allocated registry or operational-plan alias. */
  planningRevisions?:TrustedPlanningRevisions;
  signedEpochInspector?:TrustedGatewaySignedEpochInspector;
}):Promise<{start():Promise<void>;close():Promise<void>;server:Server}>{
  const path=socketPath(config.socketPath);
  await ownerDirectory(dirname(path));
  const secret=await loadTrustedPlanIpcSecret(config.secretFile);
  const seen=new Map<string,number>();
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=="POST"||req.url!==ROUTE){
        response(res,404,{error:"not_found"});return;
      }
      const timestamp=req.headers["x-trusted-timestamp"];
      const nonce=req.headers["x-trusted-nonce"];
      const mac=req.headers["x-trusted-mac"];
      if(typeof timestamp!=="string"||!/^\d{13}$/u.test(timestamp)||
         Math.abs(Date.now()-Number(timestamp))>MAX_AGE||
         typeof nonce!=="string"||!NONCE.test(nonce)||
         typeof mac!=="string"||!MAC.test(mac)){
        response(res,403,{error:"untrusted_caller"});return;
      }
      const parts:Buffer[]=[];
      let size=0;
      for await(const chunk of req){
        const buffer=Buffer.from(chunk);size+=buffer.length;
        if(size>MAX_BODY){
          response(res,413,{error:"body_too_large"});return;
        }
        parts.push(buffer);
      }
      const body=Buffer.concat(parts);
      if(!body.length){response(res,400,{error:"missing_body"});return;}
      const expected=sign(secret,timestamp,nonce,body);
      if(!timingSafeEqual(Buffer.from(mac,"hex"),Buffer.from(expected,"hex"))){
        response(res,403,{error:"untrusted_caller"});return;
      }
      const now=Date.now();
      for(const [n,expiry] of seen)if(expiry<=now)seen.delete(n);
      if(seen.has(nonce)||seen.size>=MAX_NONCES){
        response(res,409,{error:"replayed_command"});return;
      }
      seen.set(nonce,now+MAX_AGE);
      const command=validate(JSON.parse(body.toString("utf8")));
      if(command.action==="lease_status"){
        response(res,200,{
          ok:true,enabled:config.plans.operationalLeaseConfigured(),
          operational_session_durable:
            config.plans.operationalSessionDurableConfigured?.()===true,
          signed_epoch_inspection:
            config.signedEpochInspector instanceof TrustedGatewaySignedEpochInspector,
          native_root_status_inspection:
            config.signedEpochInspector instanceof TrustedGatewaySignedEpochInspector&&
            config.signedEpochInspector.nativeRootStatusConfigured(),
          planning_retirement_enabled:
            config.planningRevisions instanceof TrustedPlanningRevisions,
          planning_retirement_durable:
            config.planningRevisions instanceof TrustedPlanningRevisions&&
            config.planningRevisions.durableRetirementConfigured()
        });
      }else if(command.action==="renew_lease"){
        config.plans.renewLease(command.session_id,command.plan_digest);
        response(res,200,{ok:true});
      }else if(command.action==="retire"){
        await config.plans.retireSession(command.session_id);
        response(res,200,{ok:true});
      }else if(command.action==="begin_planning"){
        // Private transport is the ONLY remote way to register read-only
        // Planning. Require durable retirement *before* querying Gitea:
        // a process crash must not resurrect a formerly authorized root.
        if(!(config.planningRevisions instanceof TrustedPlanningRevisions)||
           !config.planningRevisions.durableRetirementConfigured())
          fail("durable Gateway Planning registry required before remote begin");
        const pinned=await config.planningRevisions.begin(
          command.session_id,command.ttl_ms);
        response(res,200,{ok:true,...pinned});
      }else if(command.action==="retire_planning"){
        if(!(config.planningRevisions instanceof TrustedPlanningRevisions))
          fail("actual Gateway Planning revision registry missing");
        await config.planningRevisions.retire(command.session_id);
        response(res,200,{ok:true});
      }else if(command.action==="activate"){
        const plan_digest=await config.plans.activate(
          command.session_id,command.base_revision);
        response(res,200,{ok:true,plan_digest});
      }else if(command.action==="bind"){
        config.plans.bindTask(command.session_id,command.plan_task_id,
          command.runtime_task_id,command.role);
        response(res,200,{ok:true});
      }else if(command.action==="complete"){
        await config.plans.confirmTaskCompletion(command.runtime_task_id,command.observation);
        response(res,200,{ok:true});
      }else if(command.action==="read_test_failure"){
        // R122: this cannot finalize a mere failed A2A claim. Only the
        // actual active Gateway registry may expose already-confirmed FAIL.
        const pins={session_id:command.session_id,
          root_plan_digest:command.root_plan_digest,
          runtime_task_id:command.runtime_task_id};
        const receipt=config.plans.readVerifiedTestFailure(
          command.runtime_task_id);
        response(res,200,{ok:true,failure:boundedTestFailure(receipt,pins)});
      }else if(command.action==="inspect_native_root"){
        // NOT operational admission: real Rust Adapter must independently
        // observe the ORIGINAL ledger root ID on anchored signed EVM status.
        if(!(config.signedEpochInspector instanceof TrustedGatewaySignedEpochInspector)||
           !config.plans.operationalLeaseConfigured()||
           !config.plans.operationalSessionDurableConfigured())
          fail("R127 native root inspection requires durable trusted Gateway");
        const observation=await config.signedEpochInspector.inspectNativeRootStatus(command);
        response(res,200,{ok:true,observation});
      }else if(command.action==="inspect_signed_epoch"){
        if(!(config.signedEpochInspector instanceof TrustedGatewaySignedEpochInspector)||
           !config.plans.operationalLeaseConfigured()||
           !config.plans.operationalSessionDurableConfigured())
          fail("R126 signed ledger inspector and durable Gateway required");
        const inspection=await config.signedEpochInspector.inspect(command);
        response(res,200,{ok:true,inspection});
      }else if(command.action==="admit_epoch"){
        // R125: ONLY the real Gateway registry with durable operational
        // lease/session and original-root-bound Intake may commit a new
        // epoch. Neither IPC HMAC nor Engineer data alone authorizes work.
        if(!(config.plans instanceof TrustedApprovedExecutionPlans)||
           !config.plans.operationalLeaseConfigured()||
           !config.plans.operationalSessionDurableConfigured())
          fail("R125 authentic durable Gateway epoch registry required");
        const receipt=await config.plans.admitNextOperationalEpoch(
          command.session_id,command.epoch,{
            root_plan_digest:command.root_plan_digest,
            plan_digest:command.plan_digest
          });
        response(res,200,{ok:true,admission:receipt});
      }else if(command.action==="confirm_test_failure"){
        // Genuine Gateway state proves completed predecessors, a Test role,
        // exact Runner FAIL, no conflicting PASS and no in-flight effects.
        // The original Engineer root pins are checked BEFORE finalization.
        const pins={session_id:command.session_id,
          root_plan_digest:command.root_plan_digest,
          runtime_task_id:command.runtime_task_id};
        const receipt=config.plans.confirmTestValidationFailure(
          command.runtime_task_id,pins);
        response(res,200,{ok:true,failure:boundedTestFailure(receipt,pins)});
      }else{
        config.plans.closeSession(command.session_id);
        response(res,200,{ok:true});
      }
    }catch{
      // Do not disclose DID, signer, status, plan or private path details.
      if(!res.headersSent)response(res,403,{error:"trusted_control_denied"});
    }
  });
  let started=false;
  return {
    server,
    async start(){
      if(started)fail("server already started");
      await ownerDirectory(dirname(path));
      try{
        await lstat(path);
        fail("control socket already exists; never replace another listener");
      }catch(e){
        if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;
      }
      await new Promise<void>((resolve,reject)=>{
        const onError=(e:Error)=>{server.off("listening",onListen);reject(e);};
        const onListen=()=>{server.off("error",onError);resolve();};
        server.once("error",onError);server.once("listening",onListen);
        server.listen(path);
      });
      try{await chmod(path,0o600);}
      catch(e){server.close();throw e;}
      started=true;
    },
    async close(){
      if(!started)return;
      await new Promise<void>((resolve,reject)=>{
        server.close(error=>error?reject(error):resolve());
        server.closeAllConnections();
      });
      started=false;
      // Node unlinks bound Unix sockets; do not delete a replacement path.
      try{
        const meta=await lstat(path);
        if(meta.isSocket())await unlink(path);
      }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    }
  };
}

/** Trusted Coordinator client, intentionally inaccessible to ADK FunctionTools. */
export class TrustedPlanIpcClient{
  readonly #socket:string;
  readonly #secret:Buffer;
  #leaseEnabled=false;
  #planningRetirementEnabled=false;
  #planningRetirementDurable=false;
  #operationalSessionDurable=false;
  #signedEpochInspection=false;
  #nativeRootInspection=false;
  private constructor(path:string,secret:Buffer){
    this.#socket=path;this.#secret=secret;
  }
  static async connect(options:{socketPath:string;secretFile:string}){
    const client=new TrustedPlanIpcClient(
      socketPath(options.socketPath),
      await loadTrustedPlanIpcSecret(options.secretFile)
    );
    // The answer itself arrives over the authenticated owner-only socket:
    // never trust a client-side boolean that could disagree with Gateway.
    const capabilities=await client.#send({action:"lease_status"});
    if(typeof capabilities.enabled!=="boolean"||
       typeof capabilities.planning_retirement_enabled!=="boolean"||
       typeof capabilities.planning_retirement_durable!=="boolean"||
       typeof capabilities.operational_session_durable!=="boolean"||
       typeof capabilities.signed_epoch_inspection!=="boolean"||
       typeof capabilities.native_root_status_inspection!=="boolean"||
       (capabilities.planning_retirement_durable&&
        !capabilities.planning_retirement_enabled))
      fail("Gateway did not attest authenticated recovery capabilities");
    client.#leaseEnabled=capabilities.enabled;
    client.#planningRetirementEnabled=capabilities.planning_retirement_enabled;
    client.#planningRetirementDurable=capabilities.planning_retirement_durable;
    client.#operationalSessionDurable=capabilities.operational_session_durable;
    client.#signedEpochInspection=capabilities.signed_epoch_inspection;
    client.#nativeRootInspection=capabilities.native_root_status_inspection;
    return client;
  }
  operationalLeaseConfigured():boolean{return this.#leaseEnabled;}
  operationalSessionDurableConfigured():boolean{
    return this.#operationalSessionDurable;
  }
  planningRetirementConfigured():boolean{return this.#planningRetirementEnabled;}
  planningRetirementDurableConfigured():boolean{
    return this.#planningRetirementDurable;
  }
  async renewLease(sessionId:string,expectedDigest:string):Promise<void>{
    if(!this.#leaseEnabled)
      fail("remote Gateway has no operational lease");
    await this.#send({
      action:"renew_lease",session_id:sessionId,plan_digest:expectedDigest
    });
  }
  async #send(value:Command):Promise<any>{
    const body=Buffer.from(JSON.stringify(validate(value)));
    const timestamp=String(Date.now()),nonce=randomBytes(16).toString("base64url");
    const mac=sign(this.#secret,timestamp,nonce,body);
    return new Promise((resolve,reject)=>{
      const req=httpRequest({
        socketPath:this.#socket,method:"POST",path:ROUTE,timeout:5000,
        headers:{"content-type":"application/json","content-length":body.length,
          "x-trusted-timestamp":timestamp,"x-trusted-nonce":nonce,
          "x-trusted-mac":mac}
      },res=>{
        let text="",size=0;
        res.on("data",chunk=>{
          size+=chunk.length;
          if(size>4096){req.destroy(Error("IPC oversized response"));return;}
          text+=chunk.toString("utf8");
        });
        res.once("end",()=>{
          if(res.statusCode!==200){reject(Error("Gateway trusted control denied"));return;}
          try{
            const result=JSON.parse(text);
            if(result?.ok!==true)throw Error("invalid response");
            resolve(result);
          }catch{reject(Error("Gateway trusted control returned invalid response"));}
        });
      });
      req.once("timeout",()=>req.destroy(Error("IPC timed out")));
      req.once("error",reject);
      req.end(body);
    });
  }
  async activate(sessionId:string,baseRevision:string):Promise<string>{
    const result=await this.#send({
      action:"activate",session_id:sessionId,base_revision:baseRevision
    });
    if(typeof result.plan_digest!=="string"||
       !/^[a-f0-9]{64}$/u.test(result.plan_digest)){
      fail("Gateway returned invalid approved digest");
    }
    return result.plan_digest;
  }
  async bindTask(sessionId:string,planTaskId:string,runtimeTaskId:string,role:AgentRole){
    await this.#send({action:"bind",session_id:sessionId,plan_task_id:planTaskId,
      runtime_task_id:runtimeTaskId,role});
  }
  async retireSession(sessionId:string){
    await this.#send({action:"retire",session_id:sessionId});
  }
  /**
   * Authenticated remote Planning registration from the REAL Gateway
   * Gitea revision. No caller may supply the SHA or authorize a root.
   * The durable-retirement capability is mandatory for this remote path.
   */
  async begin(taskId:string,ttlMs:number):Promise<{
    task_id:string;base_revision:string;expires_at:string
  }>{
    if(!this.#planningRetirementEnabled||!this.#planningRetirementDurable)
      fail("remote Planning needs durable Gateway retirement");
    const result=await this.#send({
      action:"begin_planning",session_id:taskId,ttl_ms:ttlMs
    });
    if(result.task_id!==taskId||
       typeof result.base_revision!=="string"||
       !SHA.test(result.base_revision)||
       typeof result.expires_at!=="string"||
       !Number.isFinite(Date.parse(result.expires_at)))
      fail("Gateway returned invalid source-pinned Planning receipt");
    return Object.freeze({task_id:taskId,
      base_revision:result.base_revision,expires_at:result.expires_at});
  }
  /**
   * Treat end() as a durable terminal retirement, not a fire-and-forget
   * in-memory close. The Engineer must AWAIT the signed IPC ACK before
   * revoking the read-only root or issuing a write-scoped root.
   */
  async end(taskId:string):Promise<void>{
    await this.retirePlanning(taskId);
  }
  /** Private, one-use HMAC operation: never the operational plan tombstone. */
  async retirePlanning(sessionId:string):Promise<void>{
    if(!this.#planningRetirementEnabled)
      fail("Gateway has no authenticated Planning retirement");
    await this.#send({action:"retire_planning",session_id:sessionId});
  }
  async closeSession(sessionId:string){
    await this.#send({action:"close",session_id:sessionId});
  }
  /** R114: owner-only, one-use terminal confirmation of a real Runner FAIL.
   * This is evidence, never authority or an invitation to re-run a Task. */
  async confirmVerifiedTestFailure(pins:Readonly<{
    session_id:string;root_plan_digest:string;runtime_task_id:string;
  }>):Promise<Readonly<TrustedRunnerFailure>>{
    const result=await this.#send({action:"confirm_test_failure",...pins});
    return boundedTestFailure(result.failure,pins);
  }
  /**
   * R122: read-only after genuine one-use finalization in this live Gateway
   * session and epoch; never issues authority or authorizes Docker.
   */
  async readConfirmedTestFailure(pins:Readonly<{
    session_id:string;root_plan_digest:string;runtime_task_id:string;
  }>):Promise<Readonly<TrustedRunnerFailure>>{
    const result=await this.#send({action:"read_test_failure",...pins});
    return boundedTestFailure(result.failure,pins);
  }
  /**
   * R125: private trusted admission AFTER a durably reserved epoch.
   * HMAC controls access, but admission authority is exclusively the live
   * Gateway registry's OWN verified original Rust-root Intake and pending
   * failed/satisfied Task quiescence. A model cannot send this operation.
   */
  signedEpochInspectionConfigured(){return this.#signedEpochInspection;}
  nativeRootInspectionConfigured(){return this.#nativeRootInspection;}
  /** R127: anchored native Rust existence/revocation only. NOT a grant. */
  async inspectNativeRootStatus(pins:Readonly<{
    session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
  }>){
    if(!this.#nativeRootInspection)
     fail("native Rust status inspection not configured");
    const r=(await this.#send({action:"inspect_native_root",...pins})).observation;
    if(!r||typeof r!=="object"||Array.isArray(r)||
       Object.keys(r).sort().join(",")!==
        "child_credential_issued,epoch,execution_authorized,gateway_epoch_admitted,native_source,plan_digest,root_permissions_verified,root_plan_digest,session_id,status"||
       r.status!=="native_root_status_correlated_not_permission_authority"||
       r.session_id!==pins.session_id||
       r.root_plan_digest!==pins.root_plan_digest||
       r.plan_digest!==pins.plan_digest||r.epoch!==pins.epoch||
       r.native_source!=="evm_anchored_signed_jwt"||
       r.execution_authorized!==false||
       r.gateway_epoch_admitted!==false||
       r.child_credential_issued!==false||
       r.root_permissions_verified!==false)
      fail("native Rust root status receipt cannot grant authorization");
    return Object.freeze({
     status:"native_root_status_correlated_not_permission_authority" as const,
     session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
     plan_digest:pins.plan_digest,epoch:pins.epoch,
     native_source:"evm_anchored_signed_jwt" as const,
     execution_authorized:false as const,
     gateway_epoch_admitted:false as const,
     child_credential_issued:false as const,
     root_permissions_verified:false as const
    });
  }
  /** R126 read-only signed journal consistency; NO native Rust grant. */
  async inspectSignedEpoch(pins:Readonly<{
    session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
  }>){
    if(!this.#signedEpochInspection)
     fail("signed epoch inspector not configured");
    const r=(await this.#send({action:"inspect_signed_epoch",...pins})).inspection;
    if(!r||typeof r!=="object"||Array.isArray(r)||
       Object.keys(r).sort().join(",")!==
        "child_credential_issued,epoch,execution_authorized,gateway_epoch_admitted,plan_digest,root_plan_digest,session_id,status"||
       r.status!=="signed_epoch_ledger_consistent_not_native_root_verified"||
       r.session_id!==pins.session_id||
       r.root_plan_digest!==pins.root_plan_digest||
       r.plan_digest!==pins.plan_digest||r.epoch!==pins.epoch||
       r.execution_authorized!==false||r.gateway_epoch_admitted!==false||
       r.child_credential_issued!==false)
      fail("invalid non-authorizing signed epoch inspection receipt");
    return Object.freeze({
     status:"signed_epoch_ledger_consistent_not_native_root_verified" as const,
     session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
     plan_digest:pins.plan_digest,epoch:pins.epoch,
     execution_authorized:false as const,gateway_epoch_admitted:false as const,
     child_credential_issued:false as const
    });
  }
  async admitVerifiedOperationalEpoch(pins:Readonly<{
    session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
  }>):Promise<Readonly<{
    status:"gateway_epoch_admitted";epoch:number;plan_digest:string;
    blocked_descendant_task_ids:ReadonlyArray<string>;
  }>>{
    const result=await this.#send({action:"admit_epoch",...pins});
    const r=result.admission;
    if(!r||typeof r!=="object"||Array.isArray(r)||
       Object.keys(r).sort().join(",")!==
        "blocked_descendant_task_ids,epoch,plan_digest,status"||
       r.status!=="gateway_epoch_admitted"||r.epoch!==pins.epoch||
       r.plan_digest!==pins.plan_digest||
       !Array.isArray(r.blocked_descendant_task_ids)||
       r.blocked_descendant_task_ids.length>128||
       r.blocked_descendant_task_ids.some((x:unknown)=>
         typeof x!=="string"||!ID.test(x))||
       new Set(r.blocked_descendant_task_ids).size!==
        r.blocked_descendant_task_ids.length)
      fail("Gateway returned uncorroborated pinned repair-epoch admission");
    return Object.freeze({
      status:"gateway_epoch_admitted" as const,epoch:pins.epoch,
      plan_digest:pins.plan_digest,
      blocked_descendant_task_ids:Object.freeze(
        [...r.blocked_descendant_task_ids] as string[])
    });
  }
  async confirmTaskCompletion(runtimeTaskId:string,
    observation?:TrustedCompletionObservation):Promise<void>{
    if(!observation)fail("trusted task observation is required");
    await this.#send({
      action:"complete",runtime_task_id:runtimeTaskId,observation
    });
  }
}
