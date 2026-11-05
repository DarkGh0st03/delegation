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
import type {AgentTaskContext, SpecializedAgentRole} from "./contracts.ts";
import {validatePrivateApprovedBranch} from "./approved-branch.ts";
import type {TrustedEffectStagingPort} from "./gateway-tool-client.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const DID=/^did:[A-Za-z0-9:._-]{6,240}$/u;
const PATH=/^[^\\%\x00-\x1f\x7f]{1,240}$/u;
function deny(reason:string):never{
 throw Error("Trusted ADK effect Task binding NO-GO: "+reason);
}
export interface TrustedEffectTaskOwnerPins {
  runtimeTaskId:string;
  planTaskId:string;
  role:SpecializedAgentRole;
  childCredentialId:string;
  presenterId:string;
  branch:string;
  operation:"update_file"|"run_tests";
  /** Required only for exact file mutations. Never model provided. */
  path?:string;
  /** Owner-side gateway stager, permanently bound to its original request store. */
  effectStager:TrustedEffectStagingPort;
}
interface Entry {
 readonly pins:Readonly<Omit<TrustedEffectTaskOwnerPins,"effectStager">>;
 readonly stager:TrustedEffectStagingPort;
 state:"ready"|"selected"|"retired";
 attempted:boolean;
}
export class TrustedEffectStagingTaskRegistry {
 readonly #entries=new Map<string,Entry>();
 #retired=false;

 /** Only callable by privileged in-process owner assembly, not A2A. */
 bindTask(input:TrustedEffectTaskOwnerPins):void{
  if(this.#retired)deny("registry is retired");
  if(!input||!DISPATCH.test(input.runtimeTaskId)||
     !ID.test(input.planTaskId)||!ID.test(input.childCredentialId)||
     !DID.test(input.presenterId)||
     !["backend","frontend","test"].includes(input.role)||
     !["update_file","run_tests"].includes(input.operation)||
     typeof input.effectStager?.stage!=="function")
   deny("exact trusted owner Task/Child and one-shot effect port required");
  try{validatePrivateApprovedBranch(input.branch);}
  catch{deny("invalid owner-pinned feature branch");}
  if(input.operation==="update_file"){
   if(typeof input.path!=="string"||!PATH.test(input.path)||
      input.path.startsWith("/")||input.path.includes("//")||
      input.path.split("/").some(p=>p==="."||p===".."||!p))
    deny("canonical update path required");
  }else if(input.role!=="test"||input.path!==undefined){
   deny("run_tests must be an exact Test Task without file path");
  }
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
   stager:input.effectStager,state:"ready",attempted:false
  });
 }

 /** Fail closed for EVERY A2A Task on a host configured with this registry. */
 selectFor(context:AgentTaskContext):TrustedEffectStagingPort{
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
     (p.operation==="update_file"
       ? !hints.some(row=>row?.operation==="update_file"&&row.path===p.path)||
         !Array.isArray(sub.relevant_paths)||
         !sub.relevant_paths.includes(p.path!)
       : sub.approved_run_tests!==true))
   deny("A2A identity/operation differs from trusted owner Task pins");
  return Object.freeze({
   stage:async(requestId:string):Promise<unknown>=>{
    if(this.#retired||b.state!=="selected"||b.attempted)
     deny("one-shot owner effect already consumed or retired");
    // Reserve BEFORE checking the untrusted Gateway request ID; owner
    // preflight subsequently checks the original PreparedRequestRecord.
    b.attempted=true;
    if(typeof requestId!=="string"||!ID.test(requestId))
     deny("malformed Gateway request ID");
    return b.stager.stage(requestId);
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
