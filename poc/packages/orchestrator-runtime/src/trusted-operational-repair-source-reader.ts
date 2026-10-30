/**
 * R108: an AUTHORIZED read_file execution for an operational repair Planner.
 *
 * This is a trusted-host port, never a direct Gitea API, and it does not
 * manufacture credentials. A real owner supplies a Rust-signed VP for the
 * Gateway challenge. The Gateway independently verifies DC/VP -> Core Rust
 * -> OPA -> exact Task/role/resource -> Gitea. Merely possessing a read
 * grant on the root does NOT authorize an unbound operational Task.
 *
 * The caller must bind an independently approved read-only Task on the
 * active operational epoch. If no such Task exists, this class fails closed.
 * This deliberately does not silently widen an Engineer-signed old DAG.
 */
import {Buffer} from "node:buffer";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {TrustedApprovedExecutionPlans} from "../../../apps/gateway/src/approved-execution-plans.ts";
import {prepareTrustedRepairFeedback} from "./trusted-validation-repair-feedback.ts";
import {canonicalFileUri} from "../../../apps/gateway/src/canonical.ts";
import type {PreparedAuthorizationResponse} from
 "../../../apps/gateway/src/types.ts";
import {TrustedOperationalEpochIntake} from
 "./trusted-operational-epoch-intake.ts";
import {TrustedOperationalFeatureHeadReader} from
 "../../../apps/gateway/src/trusted-operational-feature-head.ts";
import {approvedWorkBranch} from "../../plan-contracts/src/approved-work-branch.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const PATH=/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^\0\r\n]{1,300}$/u;
const MAX_READS=4,MAX_FILE_BYTES=32768,MAX_TOTAL_BYTES=65536;
const deny=(s:string):never=>{throw Error("Trusted repair source read NO-GO: "+s);};
export interface VerifiedRepairSource{
 readonly status:"gateway_verified_read";
 readonly branch:string;readonly path:string;
 readonly revision:string;readonly content:string;
 readonly bytes:number;
}
type Repository={authority:string;owner:string;repository:string};
type AgentRole="orchestrator"|"backend"|"frontend"|"test";
export class TrustedOperationalRepairSourceReader {
 readonly #gateway:GatewayRuntime;
 readonly #gatewayPlans:TrustedApprovedExecutionPlans;
 readonly #intake:TrustedOperationalEpochIntake;
 readonly #failedRuntimeTask:string;
 readonly #feature:TrustedOperationalFeatureHeadReader;
 readonly #session:string;
 readonly #runtimeTask:string;
 readonly #role:AgentRole;
 readonly #expectedSha:string;
 readonly #signedVp:(challenge:Readonly<PreparedAuthorizationResponse>)=>
  Promise<string>;
 #attempts=0;
 #bytes=0;
 #busy=false;
 constructor(config:{
  gateway:GatewayRuntime;
  trustedGatewayPlans:TrustedApprovedExecutionPlans;
  failedRuntimeTestTaskId:string;
  intake:TrustedOperationalEpochIntake;
  featureHeadReader:TrustedOperationalFeatureHeadReader;
  sessionId:string;
  runtimeTaskId:string;
  agentRole:AgentRole;
  expectedTestedSha:string;
  issueSignedVp:(challenge:Readonly<PreparedAuthorizationResponse>)=>
   Promise<string>;
 }){
  if(!(config.gateway instanceof GatewayRuntime)||
     !(config.trustedGatewayPlans instanceof TrustedApprovedExecutionPlans)||
     !config.gateway.hasExactTrustedOperationalPlanGate(config.trustedGatewayPlans)||
     !(config.intake instanceof TrustedOperationalEpochIntake)||
     !config.trustedGatewayPlans.isBoundToOperationalEpochIntake(config.intake)||
     typeof config.failedRuntimeTestTaskId!=="string"||
     !config.failedRuntimeTestTaskId||
     !(config.featureHeadReader instanceof TrustedOperationalFeatureHeadReader)||
     typeof config.sessionId!=="string"||!config.sessionId||
     typeof config.runtimeTaskId!=="string"||!config.runtimeTaskId||
     !["orchestrator","backend","frontend","test"].includes(config.agentRole)||
     !SHA.test(config.expectedTestedSha)||
     typeof config.issueSignedVp!=="function"||
     config.gateway.providerLabel!=="gitea"||
     !config.gateway.hasTrustedOperationalPlanGate())
   deny("real Gateway, owner intake, provider and VP issuer required");
  config.featureHeadReader.assertSameIntake(config.intake);
  this.#gateway=config.gateway;
  this.#gatewayPlans=config.trustedGatewayPlans;
  this.#failedRuntimeTask=config.failedRuntimeTestTaskId;
  this.#intake=config.intake;this.#feature=config.featureHeadReader;
  this.#session=config.sessionId;this.#runtimeTask=config.runtimeTaskId;
  this.#role=config.agentRole;this.#expectedSha=config.expectedTestedSha;
  this.#signedVp=config.issueSignedVp;
 }
 async read(path:string):Promise<Readonly<VerifiedRepairSource>>{
  // A model cannot exploit concurrent reads to defeat the budgets or
  // interleave authorization with a new epoch.
  if(this.#busy)deny("concurrent repair source read");
  if(this.#attempts>=MAX_READS)deny("read budget exhausted");
  this.#attempts++;
  this.#busy=true;
  try{
   if(typeof path!=="string"||!PATH.test(path))
    deny("invalid repository relative file path");
   const history=await this.#intake.verifiedEpochHistory();
   const current=history.at(-1);
   if(!current||current.plan.session_id!==this.#session)
    deny("operational root is not bound to this session");
   const repo:Repository=current.plan.repository;
   const branch=approvedWorkBranch(current.plan);
   const resource=canonicalFileUri(repo,branch,path);
   const granted=await this.#intake.trustedRootReadGrants();
   if(!granted.some(p=>p.resource===resource&&p.operation==="read_file"))
    deny("read_file resource absent from issued Rust root");
   // A read in the repair-planning phase MUST originate from a
   // Gateway-confirmed Test FAIL on this very operational root/session.
   // A caller-supplied SHA is never sufficient to start model source reads.
   const failure=await prepareTrustedRepairFeedback({
    gateway:this.#gatewayPlans,intake:this.#intake,
    sessionId:this.#session,runtimeTestTaskId:this.#failedRuntimeTask
   });
   if(failure.status!=="repair_planning_eligible"||
      failure.tested_commit_sha!==this.#expectedSha||
      failure.failed_epoch!==history.length||
      failure.work_branch!==branch)
    deny("read source revision not pinned to trusted failed Runner");
   const before=await this.#feature.read(repo,branch);
   if(before.head_sha!==this.#expectedSha)
    deny("feature HEAD no longer matches failed Runner SHA");
   // This is the SAME Gateway Prepare used by authorized Agent operations.
   // An unbound Task or missing Task-specific grant is denied here before
   // a VP is signed and before Gitea can read source.
   const prepared=this.#gateway.prepare({
    task_id:this.#runtimeTask,agent_role:this.#role,
    tool:"read_file",arguments:{branch,path}
   });
   if(prepared.required_permission.resource!==resource||
      prepared.required_permission.operation!=="read_file")
    deny("Gateway challenge selected different permission");
   const signedVp=await this.#signedVp(Object.freeze({...prepared}));
   if(typeof signedVp!=="string"||!signedVp.trim())
    deny("trusted signer returned no signed VP");
   const response=await this.#gateway.execute({
    request_id:prepared.request_id,signed_vp:signedVp
   });
   const result=response.execution;
   if(response.request_id!==prepared.request_id||
      response.decision!=="allow"||result.provider!=="gitea"||
      result.performed!==true||result.tool!=="read_file"||
      result.path!==path||result.branch!==branch||
      result.revision!==this.#expectedSha||
      result.encoding!=="utf-8"||
      typeof result.content!=="string"||
      !Number.isSafeInteger(result.size)||result.size<0)
    deny("Gateway did not return exact-SHA authorized file source");
   const bytes=Buffer.byteLength(result.content,"utf8");
   if(bytes>MAX_FILE_BYTES||bytes>result.size+4||
      bytes+this.#bytes>MAX_TOTAL_BYTES)
    deny("file exceeds approved model read budget");
   const after=await this.#feature.read(repo,branch);
   if(after.head_sha!==before.head_sha)
    deny("feature branch changed during approved file read");
   const rechecked=await prepareTrustedRepairFeedback({
    gateway:this.#gatewayPlans,intake:this.#intake,
    sessionId:this.#session,runtimeTestTaskId:this.#failedRuntimeTask
   });
   if(rechecked.failed_request_id!==failure.failed_request_id||
      rechecked.tested_commit_sha!==failure.tested_commit_sha)
    deny("failed Runner evidence changed during source read");
   const latest=await this.#intake.verifiedEpochHistory();
   if(latest.length!==history.length||
      latest.at(-1)?.plan_digest!==current.plan_digest)
    deny("operational epoch changed during source read");
   this.#bytes+=bytes;
   return Object.freeze({
    status:"gateway_verified_read",path,branch,
    revision:result.revision,bytes,content:result.content
   });
  }finally{
   this.#busy=false;
  }
 }
}
