import {isProjectTestSource,MAX_TASK_READS,isTrustedProjectTestSourceProfile,IAM_CONSOLE_PROJECT_TEST_PROFILE}
 from "../../plan-contracts/src/gitea-permission-containment.mjs";
/**
 * R320: trusted host-only, per-Task ADK/A2A -> Gateway effect binding.
 *
 * Binding never comes from A2A metadata, an ADK FunctionTool, an MCP call
 * or an environment variable. The authenticated owner registers exact
 * Task/Child/role/branch/operation pins and an already instantiated
 * owner-private staging port BEFORE dispatch.
 *
 * A matching A2A task is only a candidate: real authorization is ALWAYS
 * performed later by Gateway Prepare, the owner stager's private shared
 * request store and preflight, native Rust Child VP, OPA and the provider.
 * This registry alone neither issues a DC nor authorizes an effect.
 */
import type {AgentTaskContext} from "./contracts.ts";
import {validatePrivateApprovedBranch} from "./approved-branch.ts";
import type {TrustedEffectStagingPort} from "./gateway-tool-client.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const DID=/^did:[A-Za-z0-9:._-]{6,240}$/u;
const PATH=/^[^\\%\x00-\x1f\x7f]{1,240}$/u;
/** A new role is accepted only as a private owner Task pin. It is NOT a
 * production A2A worker or a self-signed grant. Keep Orchestrator reserved. */
const ROLE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const trustedFileRole=(role:unknown):role is string=>
 typeof role==="string"&&ROLE.test(role)&&!role.includes("..")&&
 role!=="orchestrator"&&role!=="constructor"&&role!=="prototype";
function deny(reason:string):never{
 throw Error("Trusted ADK effect Task binding NO-GO: "+reason);
}
export interface TrustedEffectTaskOwnerPins {
  runtimeTaskId:string;
  planTaskId:string;
  role:string;
  childCredentialId:string;
  presenterId:string;
  branch:string;
  operation:"read_file"|"update_file"|"create_file"|"run_tests"|"read_then_update";
  /** Required for a pinned read or update; never model provided. */
  path?:string;
  /** Owner-side gateway stager, permanently bound to its original request store. */
  effectStager:TrustedEffectStagingPort;
}
interface Entry {
 readonly pins:Readonly<Omit<TrustedEffectTaskOwnerPins,"effectStager">>;
 readonly stager:TrustedEffectStagingPort;
 state:"ready"|"selected"|"retired";
 attempted:boolean;
 /** Private read->CAS sequencing: no agent supplied claim can skip attestation. */
 mixedPhase:"read_ready"|"read_pending"|"read_attested"|
  "update_pending"|"finished"|"failed";
 mixedRequest?:string;
 /** Reads granted by the signed Task (edited file + its context files). */
 plannedReads:number;
 attestedReads:number;
}
/** Exact read+update hints: 1..MAX_TASK_READS distinct reads that include the
 * edited file, plus ONE update of that file; nothing else. */
function readUpdateHints(hints:readonly {operation?:unknown;path?:unknown}[],
  path:string):number|null{
 const reads=hints.filter(r=>r?.operation==="read_file").map(r=>r.path);
 const updates=hints.filter(r=>r?.operation==="update_file");
 if(reads.length<1||reads.length>MAX_TASK_READS||
    reads.length+1!==hints.length||updates.length!==1||
    updates[0]?.path!==path||!reads.includes(path)||
    reads.some(x=>typeof x!=="string")||new Set(reads).size!==reads.length)
  return null;
 return reads.length;
}
export class TrustedEffectStagingTaskRegistry {
 readonly #entries=new Map<string,Entry>();
 #retired=false;
 readonly #testSources:unknown;
 /** Owner-provisioned: where the Test agent may write (project profile). */
 constructor(opts:{projectTestSourceProfile?:unknown}={}){
  const rule=opts.projectTestSourceProfile??IAM_CONSOLE_PROJECT_TEST_PROFILE;
  if(!isTrustedProjectTestSourceProfile(rule))
   deny("project test-source profile must come from a trusted project profile");
  this.#testSources=rule;
 }
 get projectTestSourceProfile():unknown{return this.#testSources;}

 /** Only callable by privileged in-process owner assembly, not A2A. */
 bindTask(input:TrustedEffectTaskOwnerPins):void{
  if(this.#retired)deny("registry is retired");
  if(!input||!DISPATCH.test(input.runtimeTaskId)||
     !ID.test(input.planTaskId)||!ID.test(input.childCredentialId)||
     !DID.test(input.presenterId)||
     !trustedFileRole(input.role)||
     !["read_file","update_file","create_file","run_tests","read_then_update"].includes(input.operation)||
      (input.operation==="create_file"&&
       (input.effectStager.stagedTool!=="create_file"||
        (input.role==="test"&&!isProjectTestSource(input.path,this.#testSources))))||
     typeof input.effectStager?.stage!=="function"||
     (input.operation==="read_then_update"&&
      (input.effectStager.stagedTool!=="read_then_update"||
       typeof input.effectStager.attest!=="function")))
   deny("exact trusted owner Task/Child and one-shot effect port required");
  try{validatePrivateApprovedBranch(input.branch);}
  catch{deny("invalid owner-pinned feature branch");}
  if(["update_file","create_file","read_file","read_then_update"].includes(input.operation)){
   if(typeof input.path!=="string"||!PATH.test(input.path)||
      input.path.startsWith("/")||input.path.includes("//")||
      input.path.split("/").some(p=>p==="."||p===".."||!p))
    deny(input.operation==="read_file"?"canonical read path required":
     "canonical update path required");
  }else if(input.role!=="test"||input.path!==undefined){
   deny("run_tests must be an exact Test Task without file path");
  }
  if(input.role==="test"&&
     (input.operation==="update_file"||
      (input.operation==="read_then_update"&&!isProjectTestSource(input.path,this.#testSources))))
   deny("Test updates require an exact project test source read/update binding");
  if(this.#entries.has(input.runtimeTaskId)||
     [...this.#entries.values()].some(b=>
       b.pins.planTaskId===input.planTaskId||
       b.pins.childCredentialId===input.childCredentialId))
   deny("repeated Task, plan or Child credential binding");
  this.#entries.set(input.runtimeTaskId,{
   pins:Object.freeze({
    runtimeTaskId:input.runtimeTaskId,planTaskId:input.planTaskId,
    role:input.role,childCredentialId:input.childCredentialId,
    presenterId:input.presenterId,branch:input.branch,
    operation:input.operation,
    ...(input.path!==undefined?{path:input.path}:{})
   }),
   stager:input.effectStager,state:"ready",attempted:false,
   mixedPhase:"read_ready",plannedReads:0,attestedReads:0
  });
 }

 /** Fail closed for EVERY A2A Task on a host configured with this registry. */
 selectFor(context:AgentTaskContext):Omit<TrustedEffectStagingPort,"reportNoChange">&{reportNoChange?():Promise<void>}{
  if(this.#retired)deny("registry is retired");
  const id=context?.trusted_gateway_task_id;
  if(typeof id!=="string")deny("missing exact prebound Gateway Task");
  const b=this.#entries.get(id);
  if(!b||b.state!=="ready")deny("Gateway Task was not prebound or was already dispatched");
  // A partially matching/forged A2A message consumes the owner slot, to
  // prevent a second attempt after an ambiguous identity mismatch.
  b.state="selected";
  const p=b.pins;
  const sub=context.subtask;
  const hints=sub?.approved_file_permissions;
  if(context.role!==p.role||
     sub?.subtask_id!==p.planTaskId||
     sub.branch!==p.branch||
     context.delegation_evidence?.credential_id!==p.childCredentialId||
     context.delegation_evidence?.presenter_id!==p.presenterId||
     !Array.isArray(hints)||
     (p.operation==="read_then_update"
       ? readUpdateHints(hints,p.path!)===null||sub.approved_run_tests!==false||
         !Array.isArray(sub.relevant_paths)||
         sub.relevant_paths.length!==readUpdateHints(hints,p.path!)||
         !hints.every(row=>sub.relevant_paths.includes(row.path))
       : p.operation==="create_file"
       ? hints.length!==1||
         hints[0]?.operation!=="create_file"||
         hints[0]?.path!==p.path||
         sub.approved_run_tests!==false||
         !Array.isArray(sub.relevant_paths)||
         sub.relevant_paths.length!==1||sub.relevant_paths[0]!==p.path
       : p.operation==="update_file"||p.operation==="read_file"
       ? !hints.some(row=>row?.operation===p.operation&&row.path===p.path)||
         !Array.isArray(sub.relevant_paths)||
         !sub.relevant_paths.includes(p.path!)
       : sub.approved_run_tests!==true))
   deny("A2A identity/operation differs from trusted owner Task pins");
  if(p.operation==="read_then_update")b.plannedReads=readUpdateHints(hints,p.path!)!;
  return Object.freeze({
   stagedTool:p.operation,
   projectTestSourceProfile:this.#testSources,
   stage:async(requestId:string):Promise<unknown>=>{
    if(this.#retired||b.state!=="selected"||
       (p.operation!=="read_then_update"&&b.attempted))
     deny("one-shot owner effect already consumed or retired");
    if(p.operation==="read_then_update"){
      const phase=b.mixedPhase;
      if(phase!=="read_ready"&&phase!=="read_attested")
       deny("mixed effect out of sequence or previous evidence missing");
      // Burn the phase BEFORE any asynchronous authenticated owner call.
      // Reads first (each attested), then the single update.
      b.mixedPhase=b.attestedReads<b.plannedReads?"read_pending":"update_pending";
      b.mixedRequest=requestId;
      if(typeof requestId!=="string"||!ID.test(requestId)){
       b.mixedPhase="failed";deny("malformed mixed request ID");
      }
      try{return await b.stager.stage(requestId);}
      catch(error){b.mixedPhase="failed";throw error;}
    }
    b.attempted=true;
    if(typeof requestId!=="string"||!ID.test(requestId))
     deny("malformed Gateway request ID");
    return b.stager.stage(requestId);
   },
   ...(b.stager.reportNoChange?{
    reportNoChange:async()=>{
     if(this.#retired||b.state!=="selected"||p.operation!=="read_then_update"||
        b.mixedPhase!=="read_attested"||!b.mixedRequest)
      deny("no-change report requires the original attested read");
     b.mixedPhase="failed";
     await b.stager.reportNoChange!(b.mixedRequest);
    }
   }:{}),
   attest:async(requestId:string,tool:"read_file"|"update_file"):Promise<void>=>{
    if(this.#retired||b.state!=="selected"||
       p.operation!=="read_then_update"||
       (b.mixedPhase!=="read_pending"&&b.mixedPhase!=="update_pending")||
       !ID.test(requestId)||requestId!==b.mixedRequest||
       tool!==(b.mixedPhase==="read_pending"?"read_file":"update_file")||
       typeof b.stager.attest!=="function")
     deny("mixed native effect cannot attest out of order or without request");
    const phase=b.mixedPhase;
    b.mixedPhase="failed"; // ambiguous observer receipt is terminal
    await b.stager.attest(requestId,tool);
    if(phase==="read_pending")b.attestedReads+=1;
    b.mixedPhase=phase==="read_pending"?"read_attested":"finished";
   }
  });
 }
 /** Host-controlled cleanup after A2A completion, failure or cancellation. */
 retireFor(runtimeTaskId:string):void{
  const b=this.#entries.get(runtimeTaskId);
  if(!b)deny("unknown owner Task retirement");
  b.state="retired";
 }
 /** Fence all pending and active Task effects before host shutdown. */
 retireAll():void{
  this.#retired=true;
  for(const b of this.#entries.values())b.state="retired";
 }
}
