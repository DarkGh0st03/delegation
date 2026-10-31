/**
 * R106: one-shot owner-private repair planning, NO fresh Engineer approval.
 *
 * Uses existing signed original -> issued Rust operational root -> verified
 * Gateway Test FAIL -> authenticated feature HEAD -> new epoch preflight.
 * Planning is NOT credential issuance or Gateway authorization. The model
 * may propose only role, Task text, dependency IDs and ResourceURI/Operation;
 * it cannot choose repository, branch, session, Git base SHA, Agent DID/Card
 * or parent DC. All permissions are rechecked against the actual issued root.
 *
 * The model proposal callback is explicitly a host adapter placeholder,
 * not a claim that paid Gemini ADK planning has been integrated.
 */
import {PLAN_SCHEMA_VERSION,planDigest,validatePlan} from
  "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans} from
  "../../../apps/gateway/src/approved-execution-plans.ts";
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import {TrustedOperationalFeatureHeadReader} from "../../../apps/gateway/src/trusted-operational-feature-head.ts";
import {prepareTrustedRepairFeedback,prepareTrustedRemoteRepairFeedback,
 type TrustedRepairFeedbackSignal} from "./trusted-validation-repair-feedback.ts";

const CATALOG=new Set<string>(RUST_OPERATIONS);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const ROLES=new Set(["backend","frontend","test","orchestrator"]);
const WRITES=new Set(["update_file","create_file","write_file"]);
const MAX_TASKS=12,MAX_PERMISSIONS=32;
const fail=(reason:string):never=>{throw Error("Trusted repair planner NO-GO: "+reason);};
type Role="backend"|"frontend"|"test"|"orchestrator";
type SpecializedRole=Exclude<Role,"orchestrator">;
type Repository={authority:string;owner:string;repository:string};
type Grant={resource:string;operation:string};
type RepairTaskDraft={
 id:string;agent_id:Role;title:string;description:string;depends_on:string[];
 permissions:{resource:string;operation:string;reason:string}[];
};
export type RepairPlanDraft={tasks:RepairTaskDraft[]};
export interface TrustedFeatureRevision {
 readonly repository:Readonly<Repository>;
 readonly branch:string;
 readonly head_sha:string;
}
export interface TrustedRepairPlanningObservation{
 readonly failed_phase:string;
 readonly typecheck_error_codes:readonly string[];
 readonly tested_commit_sha:string;
 readonly work_branch:string;
 readonly remaining_repair_epochs:number;
}
/** R151.44: authenticated Gateway read metadata, never a source or grant. */
export interface TrustedRepairDiscoveryObservation{
 readonly status:"gateway_discovery_read_confirmed_no_authority";
 readonly resource:string;readonly branch:string;
 readonly tested_commit_sha:string;readonly operation:"read_file";
}
export interface TrustedRepairDiscoveryLookup{
 readonly task_id:string;readonly runtime_task_id:string;readonly resource:string;
}
/** Source-free reducer: only the Gateway IPC client may supply this receipt. */
export function boundedTrustedRepairDiscoveryObservation(
 receipt:unknown,pins:Readonly<{
  session_id:string;epoch:number;task_id:string;runtime_task_id:string;
  resource:string;branch:string;tested_commit_sha:string;
 }>):Readonly<TrustedRepairDiscoveryObservation>{
 const r=strictObject(receipt,[
  "status","session_id","task_id","runtime_task_id","epoch","resource",
  "branch","revision","request_id","credential_id",
  "gateway_provider_corroborated","source_disclosed",
  "repair_dag_authorized","pr_authorized"
 ],"Gateway discovery metadata");
 if(r.status!=="gateway_confirmed_exact_sha_discovery_read_no_repair_authority"||
    r.session_id!==pins.session_id||r.epoch!==pins.epoch||
    r.task_id!==pins.task_id||r.runtime_task_id!==pins.runtime_task_id||
    r.resource!==pins.resource||r.branch!==pins.branch||
    r.revision!==pins.tested_commit_sha||
    r.gateway_provider_corroborated!==true||r.source_disclosed!==false||
    r.repair_dag_authorized!==false||r.pr_authorized!==false||
    typeof r.request_id!=="string"||!ID.test(r.request_id)||
    typeof r.credential_id!=="string"||!ID.test(r.credential_id))
   fail("discovery provider evidence does not match the signed failed Test");
 return Object.freeze({
  status:"gateway_discovery_read_confirmed_no_authority" as const,
  resource:pins.resource,branch:pins.branch,
  tested_commit_sha:pins.tested_commit_sha,operation:"read_file" as const
 });
}
export interface TrustedRepairModelInput {
 readonly requirement:string;
 readonly feedback:Readonly<TrustedRepairPlanningObservation>;
 readonly already_delegated_grants:ReadonlyArray<Readonly<Grant>>;
 readonly agents:readonly Role[];
 readonly diagnostic_read?:Readonly<TrustedRepairDiscoveryObservation>;
}
export interface TrustedRepairPlanningResult {
 readonly status:"repair_epoch_reserved_no_execution_authority";
 readonly epoch:number;
 readonly plan_digest:string;
 readonly source_failed_sha:string;
 readonly execution_authorized:false;
 readonly child_credential_issued:false;
 readonly model_invocations:1;
}
function strictObject(x:unknown,fields:readonly string[],label:string):
 Record<string,unknown>{
 if(!x||typeof x!=="object"||Array.isArray(x))fail("invalid "+label);
 const obj=x as Record<string,unknown>;
 if(Object.keys(obj).sort().join(",")!==[...fields].sort().join(","))
  fail("unexpected fields in "+label);
 return obj;
}
function text(x:unknown,max:number,label:string):string{
 if(typeof x!=="string"||!x.trim()||x.length>max)
  fail("invalid "+label);
 return x;
}
function id(x:unknown,label:string):string{
 const value=text(x,128,label);
 if(!ID.test(value))fail("invalid "+label);
 return value;
}
function sameRepo(a:Repository,b:Repository):boolean{
 return ["authority","owner","repository"].every(k=>
   a[k as keyof Repository]===b[k as keyof Repository]);
}
function assertFeatureHead(value:TrustedFeatureRevision,
 repository:Repository,branch:string,sha:string):void{
 if(!value||!value.repository||!sameRepo(value.repository,repository)||
    value.branch!==branch||!SHA.test(value.head_sha)||
    value.head_sha!==sha)
  fail("trusted Gitea branch HEAD differs from Runner-tested revision");
}
function ancestors(tasks:RepairTaskDraft[],ancestor:string,descendant:string){
 const byId=new Map(tasks.map(t=>[t.id,t]));
 const seen=new Set<string>();
 const visit=(id:string):boolean=>{
  if(id===ancestor)return true;
  if(seen.has(id))return false;
  seen.add(id);
  return byId.get(id)?.depends_on.some(visit)??false;
 };
 return visit(descendant);
}
function compileDraft(input:unknown,original:any,previous:any,
 planId:string,agentRegistry:readonly {agent_id:SpecializedRole;did:string;card_ref:string}[]){
 const draft=strictObject(input,["tasks"],"repair draft");
 if(!Array.isArray(draft.tasks)||draft.tasks.length<2||
    draft.tasks.length>MAX_TASKS)fail("invalid repair Task count");
 const registered=new Map(agentRegistry.map(a=>[a.agent_id,a]));
 if(registered.size!==agentRegistry.length||
    agentRegistry.some(a=>!ROLES.has(a.agent_id)||!a.did.startsWith("did:")||
       !a.card_ref.trim()))fail("trusted Agent Card registry invalid");
 let permissions=0;
 const tasks:RepairTaskDraft[]=draft.tasks.map((raw,i)=>{
  const task=strictObject(raw,
    ["id","agent_id","title","description","depends_on","permissions"],
    "Task "+i);
  const taskId=id(task.id,"Task id");
  const role=task.agent_id as Role;
  if(!ROLES.has(role)||
    (role!=="orchestrator"&&!registered.has(role)))
   fail("unregistered repair role");
  const title=text(task.title,160,"Task title");
  const description=text(task.description,1600,"Task description");
  if(!Array.isArray(task.depends_on)||task.depends_on.length>MAX_TASKS||
     task.depends_on.some(x=>typeof x!=="string"||!ID.test(x))||
     new Set(task.depends_on).size!==task.depends_on.length)
   fail("invalid Task dependencies");
  if(!Array.isArray(task.permissions)||!task.permissions.length||
     task.permissions.length>MAX_PERMISSIONS)
   fail("repair Task missing bounded permissions");
  permissions+=task.permissions.length;
  const grants=task.permissions.map((rawPerm:any)=>{
   const p=strictObject(rawPerm,["resource","operation","reason"],"permission");
   const resource=text(p.resource,1024,"resource URI");
   const operation=text(p.operation,64,"operation");
   if(!CATALOG.has(operation))fail("operation outside Rust catalog");
   if(role==="orchestrator"&&operation!=="create_pull_request")
    fail("Orchestrator may only create review PR in a repair epoch");
   if(role==="test"&&operation!=="run_tests"&&
      !["read_file","update_file","create_file"].includes(operation))
    fail("Test agent operation outside supported tool surface");
   if(role!=="test"&&role!=="orchestrator"&&
      !["read_file","update_file"].includes(operation))
    fail("implementation agent operation outside supported tool surface");
   return {resource,operation,reason:text(p.reason,280,"reason")};
  });
  if(new Set(grants.map(p=>JSON.stringify([p.resource,p.operation]))).size
     !==grants.length)fail("duplicate Task permission");
  return {id:taskId,agent_id:role,title,description,
    depends_on:[...task.depends_on],permissions:grants};
 });
 if(permissions>MAX_PERMISSIONS)fail("too many permissions");
 const writes=tasks.filter(t=>t.permissions.some(p=>WRITES.has(p.operation)&&
   (t.agent_id==="backend"||t.agent_id==="frontend"||
    t.agent_id==="test")));
 const tests=tasks.filter(t=>t.agent_id==="test"&&
   t.permissions.some(p=>p.operation==="run_tests"));
 if(!writes.length||tests.length!==1)
  fail("repair requires concrete write Task and one Test validation");
 const testTask=tests[0];
 const reviews=tasks.filter(t=>t.agent_id==="orchestrator");
 if(reviews.length>1||reviews.some(t=>
      t.permissions.length!==1||
      t.permissions[0].operation!=="create_pull_request"||
      !ancestors(tasks,testTask.id,t.id)))
  fail("Optional review PR must depend on passing Test");
 if(writes.some(t=>t.id!==testTask.id&&
     !ancestors(tasks,t.id,testTask.id)))
  fail("Test must depend on each implementation repair");
 if(testTask.depends_on.includes(testTask.id))
  fail("Test may not depend on itself");
 // It is NOT a fresh branch-creation plan: leave the existing disposable
 // Gitea branch untouched and re-run tests on its authenticated HEAD.
 const plan={
  schema_version:PLAN_SCHEMA_VERSION,
  plan_id:planId,session_id:original.session_id,
  version:previous.version+1,
  repository:structuredClone(original.repository),
  base_revision:original.base_revision,requirement:original.requirement,
  candidate_agents:agentRegistry.filter(a=>tasks.some(t=>t.agent_id===a.agent_id))
   .map(a=>({...a})),
  tasks:tasks.map(t=>({
   id:t.id,agent_id:t.agent_id,title:t.title,description:t.description,
   depends_on:t.depends_on,
   resources:[...new Set(t.permissions.map(p=>p.resource))]
  })),
  requested_permissions:tasks.flatMap(t=>t.permissions.map((p,i)=>({
   id:"repair-"+t.id+"-"+i,task_id:t.id,agent_id:t.agent_id,
   resource:p.resource,operation:p.operation,reason:p.reason
  }))),
  assumptions:[],uncertainties:[]
 };
 validatePlan(plan,{allowedOperations:CATALOG});
 return plan;
}
function sameFeedback(a:TrustedRepairFeedbackSignal,b:TrustedRepairFeedbackSignal){
 return a.session_id===b.session_id&&
  a.root_plan_digest===b.root_plan_digest&&
  a.failed_plan_digest===b.failed_plan_digest&&
  a.failed_request_id===b.failed_request_id&&
  a.failed_epoch===b.failed_epoch&&
  a.tested_commit_sha===b.tested_commit_sha&&
  a.work_branch===b.work_branch&&
  a.status===b.status;
}
/**
 * Host-controlled one-shot model proposal adapter. No ADK/Gemini invocation
 * happens inside this component; the caller must separately enforce provider
 * budgets and a trusted read-only, current-feature-branch discovery port.
 */
export class TrustedOperationalRepairPlanner {
 readonly #gateway:TrustedApprovedExecutionPlans|TrustedPlanIpcClient;
 readonly #coordinator?:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">;
 readonly #readFinalizedFailure:boolean;
 readonly #intake:TrustedOperationalEpochIntake;
 readonly #session:string;
 readonly #testTask:string;
 readonly #nextId:string;
 readonly #agents:readonly {agent_id:SpecializedRole;did:string;card_ref:string}[];
 readonly #head:TrustedOperationalFeatureHeadReader;
 readonly #proposer:(input:Readonly<TrustedRepairModelInput>)=>
   Promise<unknown>;
 readonly #discovery?:Readonly<TrustedRepairDiscoveryLookup>;
 #attempted=false;
 constructor(config:{
  gateway:TrustedApprovedExecutionPlans|TrustedPlanIpcClient;
  /** Mandatory with IPC: original signed-root owner, not a recreated port. */
  coordinator?:Pick<TrustedExecutionCoordinator,
   "phase"|"trustedOperationalAuthority">;
  /** A Test FAIL already finalized by the trusted A2A dispatcher. */
  failedTestAlreadyFinalized?:boolean;
  intake:TrustedOperationalEpochIntake;
  sessionId:string;runtimeTestTaskId:string;nextPlanId:string;
  pinnedAgentRegistry:readonly {agent_id:SpecializedRole;did:string;card_ref:string}[];
  /** Server-constructed Gateway observation bound to the same root owner. */
  featureHeadReader:TrustedOperationalFeatureHeadReader;
  proposeRepairPlan:(input:Readonly<TrustedRepairModelInput>)=>Promise<unknown>;
  completedDiscoveryRead?:Readonly<TrustedRepairDiscoveryLookup>;
 }){
  if((!(config.gateway instanceof TrustedApprovedExecutionPlans)&&
      !(config.gateway instanceof TrustedPlanIpcClient))||
     !(config.intake instanceof TrustedOperationalEpochIntake)||
     !ID.test(config.sessionId)||!ID.test(config.runtimeTestTaskId)||
     !ID.test(config.nextPlanId)||
     !Array.isArray(config.pinnedAgentRegistry)||
     !(config.featureHeadReader instanceof TrustedOperationalFeatureHeadReader)||
     typeof config.proposeRepairPlan!=="function")
   fail("missing trusted planning dependencies");
  if(config.gateway instanceof TrustedPlanIpcClient){
   if(!config.coordinator||
      !config.gateway.operationalLeaseConfigured()||
      !config.gateway.operationalSessionDurableConfigured())
    fail("R121 remote planner needs live Coordinator and durable Gateway fences");
   config.intake.assertSameCoordinator(config.coordinator);
  }
  this.#gateway=config.gateway;this.#intake=config.intake;
  this.#coordinator=config.coordinator;
  this.#readFinalizedFailure=config.failedTestAlreadyFinalized===true;
  this.#session=config.sessionId;this.#testTask=config.runtimeTestTaskId;
  this.#nextId=config.nextPlanId;
  this.#agents=structuredClone(config.pinnedAgentRegistry);
  config.featureHeadReader.assertSameIntake(config.intake);
  this.#head=config.featureHeadReader;
  this.#proposer=config.proposeRepairPlan;
  if(config.completedDiscoveryRead){
   const d=config.completedDiscoveryRead;
   if(!(config.gateway instanceof TrustedPlanIpcClient)||
      config.failedTestAlreadyFinalized!==true||
      !ID.test(d.task_id)||!ID.test(d.runtime_task_id)||
      typeof d.resource!=="string"||d.resource.length>2048||
      !/^gitea:\/\/[^/?#\s]+\/[^/?#\s]+\/[^/?#\s]+\/branches\/[^/?#\s]+\/files\/[^?#\s]+$/u.test(d.resource))
    fail("only a finalized remote Test may select exact discovery Task pins");
   this.#discovery=Object.freeze({
    task_id:d.task_id,runtime_task_id:d.runtime_task_id,resource:d.resource
   });
  }
 }
 async proposeAndReserve():Promise<Readonly<TrustedRepairPlanningResult>>{
  if(this.#attempted)fail("model proposal already attempted (no retry)");
  this.#attempted=true;
  // R121: remote Gateway IPC FAIL is one-use: never repeat a finalizer.
  // The original issued Rust root and signed epoch are independently
  // attested by the SAME owner before the private HMAC confirmation.
  const remote=this.#gateway instanceof TrustedPlanIpcClient?
    this.#gateway:null;
  const feedback=remote
   ?await prepareTrustedRemoteRepairFeedback({
     gateway:remote,intake:this.#intake,coordinator:this.#coordinator!,
     sessionId:this.#session,runtimeTestTaskId:this.#testTask,
     alreadyFinalized:this.#readFinalizedFailure
    })
   :await prepareTrustedRepairFeedback({
     gateway:this.#gateway as TrustedApprovedExecutionPlans,
     intake:this.#intake,sessionId:this.#session,
     runtimeTestTaskId:this.#testTask
    });
  if(feedback.status!=="repair_planning_eligible"||
     feedback.remaining_repair_epochs<1)
   fail("repair budget exhausted");
  const history=await this.#intake.verifiedEpochHistory();
  const original=history[0]?.plan,previous=history.at(-1)?.plan;
  if(!original||!previous||history.length!==feedback.failed_epoch||
     planDigest(previous)!==feedback.failed_plan_digest)
   fail("repair epoch history changed");
  assertFeatureHead(await this.#head.read(original.repository,feedback.work_branch),
    original.repository,feedback.work_branch,feedback.tested_commit_sha);
  // Authenticated Gateway source-of-truth, before any model inference.
  // The supplied IDs are lookup pins, NOT evidence from an A2A message.
  const discoveryQuery=this.#discovery&&remote?{
   session_id:this.#session,root_plan_digest:feedback.root_plan_digest,
   plan_digest:feedback.failed_plan_digest,epoch:feedback.failed_epoch,
   task_id:this.#discovery.task_id,
   runtime_task_id:this.#discovery.runtime_task_id,
   runtime_test_task_id:this.#testTask,
   resource:this.#discovery.resource,
   tested_commit_sha:feedback.tested_commit_sha
  }:undefined;
  const discoveryReceipt=discoveryQuery?
   await remote!.readConfirmedRemoteDiscoveryEffect(discoveryQuery):undefined;
  const diagnostic=discoveryReceipt?
   boundedTrustedRepairDiscoveryObservation(discoveryReceipt,{
    session_id:this.#session,epoch:feedback.failed_epoch,
    task_id:this.#discovery!.task_id,
    runtime_task_id:this.#discovery!.runtime_task_id,
    resource:this.#discovery!.resource,branch:feedback.work_branch,
    tested_commit_sha:feedback.tested_commit_sha
   }):undefined;
  const grants=[...new Map(original.requested_permissions.map((p:any)=>[
    JSON.stringify([p.resource,p.operation]),
    {resource:p.resource,operation:p.operation}
  ])).values()] as Grant[];
  const modelInput:TrustedRepairModelInput=Object.freeze({
   requirement:original.requirement,
   feedback:Object.freeze({
    failed_phase:feedback.first_failed_phase,
    typecheck_error_codes:Object.freeze([...feedback.typecheck_error_codes]),
    tested_commit_sha:feedback.tested_commit_sha,
    work_branch:feedback.work_branch,
    remaining_repair_epochs:feedback.remaining_repair_epochs
   }),
   already_delegated_grants:Object.freeze(grants.map(p=>Object.freeze(p))),
   agents:Object.freeze([...this.#agents.map(a=>a.agent_id),"orchestrator" as const]),
   ...(diagnostic?{diagnostic_read:diagnostic}:{})
  });
  const raw=await this.#proposer(modelInput);
  const plan=compileDraft(raw,original,previous,this.#nextId,this.#agents);
  // Two independent trust boundaries: validate plan under the actual
  // Rust root before AND after the potentially slow model invocation.
  const proof=await this.#intake.preflightRepairEpoch(plan);
  if(proof.execution_authorized!==false||
     proof.child_credential_issued!==false)
   fail("unexpected preflight authority");
  if(remote){
   // Replaying confirm_test_failure is denied by design. Revalidate the
   // independently signed Engineer approval, issued Rust root and ALL
   // durable epochs after any slow/untrusted model proposal instead.
   const later=await this.#intake.verifiedEpochHistory();
   if(later.length!==history.length||
      later[0]?.plan_digest!==history[0]?.plan_digest||
      later[0]?.root_credential_id!==history[0]?.root_credential_id||
      later.at(-1)?.plan_digest!==history.at(-1)?.plan_digest||
      later.at(-1)?.root_credential_id!==history.at(-1)?.root_credential_id)
    fail("verified operational root or repair epoch changed while planning");
  }else{
   const later=await prepareTrustedRepairFeedback({
    gateway:this.#gateway as TrustedApprovedExecutionPlans,
    intake:this.#intake,sessionId:this.#session,
    runtimeTestTaskId:this.#testTask
   });
   if(!sameFeedback(feedback,later))
    fail("validated failure replaced while model was planning");
  }
  assertFeatureHead(await this.#head.read(original.repository,feedback.work_branch),
    original.repository,feedback.work_branch,feedback.tested_commit_sha);
  if(discoveryQuery){
   // A slow model cannot replace or invalidate the one permitted read.
   const second=await remote!.readConfirmedRemoteDiscoveryEffect(discoveryQuery);
   if(JSON.stringify(second)!==JSON.stringify(discoveryReceipt))
    fail("Gateway discovery provider receipt changed during proposal");
  }
  // Exactly one durable reservation, with existing Engineer-root-based
  // preflight and anti-replay journal. Never auto-dispatch from a proposal.
  const reservation=await this.#intake.reserveRepairEpoch(plan);
  if(reservation.execution_authorized!==false||
     reservation.plan_digest!==planDigest(plan))
   fail("unexpected durable reservation output");
  return Object.freeze({
   status:"repair_epoch_reserved_no_execution_authority",
   epoch:reservation.epoch,
   plan_digest:reservation.plan_digest,
   source_failed_sha:feedback.tested_commit_sha,
   execution_authorized:false,child_credential_issued:false,
   model_invocations:1
  });
 }
}
