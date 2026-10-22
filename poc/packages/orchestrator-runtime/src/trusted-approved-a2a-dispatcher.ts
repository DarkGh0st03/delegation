/**
 * Opt-in dispatcher for the immutable, Engineer-approved A2A Task DAG.
 *
 * The Gateway binding is installed BEFORE the delegated child credential
 * is issued or any protected A2A message is sent. The Gateway uses a random
 * dispatch ID, not the SDK-assigned A2A Task ID (which arrives too late).
 *
 * This trusted service consumes only a signed plan from a verified store.
 * It is NOT an ADK tool and exposes no model-controlled role/permission/URL.
 * The fixed Account Suspension dispatcher remains unchanged.
 */
import {randomBytes} from "node:crypto";
import {assertApprovedPlanScope,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {observedA2ACompletion} from "./trusted-a2a-observer.ts";
import {validatePrivateApprovedBranch} from "../../../packages/agent-runtime/src/approved-branch.ts";
import type {AuthenticatedPlanStore} from "../../../apps/gateway/src/approved-execution-plans.ts";
import type {SpecializedAgentRole} from "@thesis/agent-runtime";
import type {
  DelegatedA2ARoleTaskInput,DelegatedA2ARoleTaskResult,
  ProtectedA2AClientPort
} from "./a2a-workflow.ts";
import {TrustedApprovedPlanChildAuthorityIssuer} from "./trusted-approved-child-issuer.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";

const SHA=/^[a-f0-9]{40}$/u;
const ROLES=new Set(["backend","frontend","test"]);
const OPERATIONS=new Set<string>(RUST_OPERATIONS);

interface PlanTask{
  id:string;agent_id:string;description:string;
  depends_on:string[];resources:string[];
}
interface ApprovedSnapshot{
  plan: {
    session_id:string;repository:{authority:string;owner:string;repository:string};
    base_revision:string;tasks:PlanTask[];
  };
  approvedRows:{task_id:string;agent_id:string}[];
  digest:string;
  approvedBranch:string;
}
type RootInput=Pick<DelegatedA2ARoleTaskInput,
  "parent_credential_id"|"credential_id"|"valid_from"|
  "validity_seconds"|"credential_status">;

export interface TrustedApprovedA2ADispatcherConfig{
  approvals:AuthenticatedPlanStore;
  coordinator:Pick<TrustedExecutionCoordinator,
    "phase"|"bindDispatchedTask"|"confirmTask"|"closeExecution">;
  roleRunner: {issueAndRun(input:DelegatedA2ARoleTaskInput):Promise<DelegatedA2ARoleTaskResult>};
  sessionId:string;
  expectedPlanDigest:string;
  baseRevision:string;
  expectedEngineerDid:string;
  /** Trusted, pinned Agent Card endpoints; never sourced from the model. */
  agentBaseUrls:Readonly<Record<SpecializedAgentRole,string>>;
  /** Trusted authority allocator: unique child status index per Task. */
  authorityForTask(taskId:string,role:SpecializedAgentRole):Promise<RootInput>;
}

export class TrustedApprovedA2ADispatcher {
  readonly #config:TrustedApprovedA2ADispatcherConfig;
  readonly #snapshot:ApprovedSnapshot;
  readonly #completed=new Set<string>();
  readonly #started=new Set<string>();
  #busy=false;
  #terminal=false;

  private constructor(config:TrustedApprovedA2ADispatcherConfig,
    snapshot:ApprovedSnapshot){
    this.#config=config;this.#snapshot=snapshot;
  }

  /**
   * Production-style opt-in factory: the approved DAG dispatcher cannot
   * silently inherit the legacy static-role child issuer.
   *
   * The same authenticated receipt and verified operational root constrain
   * child issuance, and Rust independently enforces subset delegation.
   */
  static async loadWithScopedChildAuthority(
    config:Omit<TrustedApprovedA2ADispatcherConfig,
      "roleRunner"|"coordinator"> & {
      coordinator:TrustedExecutionCoordinator;
      a2a:ProtectedA2AClientPort;
      adapter:{adapterBaseUrl:string;bearerToken:string;
        fetchFn?:typeof fetch;timeoutMs?:number};
    }
  ){
    const {a2a,adapter,...base}=config;
    // Validate and freeze the signed plan BEFORE building privileged issuer.
    const provisional=await this.load({
      ...base,roleRunner:{
        async issueAndRun():Promise<DelegatedA2ARoleTaskResult>{
          throw Error("Scoped child issuer not yet initialized");
        }
      }
    });
    // The optional A2A SDK must not become a runtime dependency of the
    // standalone Gateway/approved-plan verifier used by offline CI.
    const {DelegatedA2ARoleRunner}=await import("./a2a-workflow.ts");
    const authorityIssuer=await TrustedApprovedPlanChildAuthorityIssuer.create({
      approvals:base.approvals,coordinator:base.coordinator,
      sessionId:base.sessionId,engineerDid:base.expectedEngineerDid,
      ...adapter
    });
    return new TrustedApprovedA2ADispatcher({
      ...base,roleRunner:new DelegatedA2ARoleRunner({
        authorityIssuer,a2a
      })
    },provisional.#snapshot);
  }

  static async load(config:TrustedApprovedA2ADispatcherConfig){
    if(!config.expectedEngineerDid?.startsWith("did:")||
       !/^[a-f0-9]{64}$/u.test(config.expectedPlanDigest)||
       !SHA.test(config.baseRevision)||
       !config.sessionId)throw Error("Trusted dispatcher requires pinned session and approval");
    if(config.coordinator.phase!=="execution"){
      throw Error("Trusted dispatcher requires activated Execution");
    }
    const fetched=await config.approvals.loadAuthenticatedApproval(config.sessionId);
    if(fetched.authenticated_engineer_did!==config.expectedEngineerDid){
      throw Error("Trusted dispatcher Engineer identity mismatch");
    }
    const plan=fetched.plan as any;
    const rows=assertApprovedPlanScope(plan,fetched.approval,{
      allowedOperations:OPERATIONS,expectedEngineerDid:config.expectedEngineerDid
    }) as ApprovedSnapshot["approvedRows"];
    const digest=planDigest(plan);
    if(plan.session_id!==config.sessionId||
       plan.base_revision!==config.baseRevision||
       digest!==config.expectedPlanDigest){
      throw Error("Trusted dispatcher plan does not match activated Gateway digest/SHA");
    }
    // Derive the only permitted working branch from SIGNED resources.
    // Arbitrary untrusted LLM-supplied branch strings are never consulted.
    const root="gitea://"+plan.repository.authority+"/"+
      plan.repository.owner+"/"+plan.repository.repository;
    const branches=new Set<string>();
    for(const item of plan.requested_permissions){
      if(typeof item.resource!=="string")throw Error("Malformed approved resource");
      if(item.resource===root)continue;
      const prefix=root+"/branches/";
      if(!item.resource.startsWith(prefix))throw Error("Unrelated approved repository resource");
      const encoded=item.resource.slice(prefix.length).split("/")[0];
      let decoded:string;
      try{decoded=decodeURIComponent(encoded);}
      catch{throw Error("Malformed approved branch URI");}
      if(encodeURIComponent(decoded)!==encoded){
        throw Error("Approved branch resource is not canonically encoded");
      }
      branches.add(validatePrivateApprovedBranch(decoded));
    }
    if(branches.size!==1)throw Error("Exactly one approved feature branch is required");
    const approvedBranch=[...branches][0]!;
    const snapshot:ApprovedSnapshot=structuredClone({
      plan,approvedRows:rows,digest,approvedBranch
    });
    return new TrustedApprovedA2ADispatcher(config,snapshot);
  }

  get completedTaskIds():readonly string[]{return [...this.#completed];}
  get approvedBranch():string{return this.#snapshot.approvedBranch;}

  /** No speculative dispatch or concurrency in this incremental PoC. */
  async dispatch(planTaskId:string):Promise<DelegatedA2ARoleTaskResult>{
    if(this.#terminal||this.#busy||this.#config.coordinator.phase!=="execution"){
      throw Error("Trusted A2A dispatcher is inactive or already running");
    }
    const task=this.#snapshot.plan.tasks.find(t=>t.id===planTaskId);
    if(!task||!ROLES.has(task.agent_id)){
      throw Error("Approved specialized A2A Task not found");
    }
    if(this.#started.has(task.id)){
      throw Error("Approved A2A Task already dispatched; no replay");
    }
    if(task.depends_on.some(id=>!this.#completed.has(id))){
      throw Error("Approved Task dependencies not verified");
    }
    if(!this.#snapshot.approvedRows.some(p=>
      p.task_id===task.id&&p.agent_id===task.agent_id)){
      throw Error("Approved Task has no granted permission");
    }
    const role=task.agent_id as SpecializedAgentRole;
    const url=this.#config.agentBaseUrls[role];
    if(typeof url!=="string"||!/^https?:\/\//u.test(url)){
      throw Error("Trusted Agent Card endpoint missing");
    }
    const repoRoot="gitea://"+this.#snapshot.plan.repository.authority+"/"+
      this.#snapshot.plan.repository.owner+"/"+
      this.#snapshot.plan.repository.repository;
    const branchRoot=repoRoot+"/branches/"+
      encodeURIComponent(this.#snapshot.approvedBranch);
    const prefix=branchRoot+"/files/";
    const paths:string[]=[];
    for(const resource of task.resources){
      if(resource===repoRoot||resource===branchRoot)continue;
      if(resource.startsWith(prefix)){
        const encoded=resource.slice(prefix.length);
        let path:string;
        try{path=encoded.split("/").map(decodeURIComponent).join("/");}
        catch{throw Error("Malformed approved Task file URI");}
        if(!path||path.startsWith("/")||path.split("/").some(s=>
          !s||s==="."||s===".."||s.includes("\\"))){
          throw Error("Malformed approved Task file path");
        }
        paths.push(path);
      }else{
        throw Error("Task resource is outside approved working branch");
      }
    }
    if(paths.length>32)throw Error("Approved Task has too many relevant paths");
    this.#busy=true;
    const dispatchId="dispatch_"+randomBytes(16).toString("base64url");
    // Once binding has been attempted, no retry may reuse the plan Task:
    // a lost network reply can otherwise conceal an active A2A side effect.
    this.#started.add(task.id);
    try{
      const authority=await this.#config.authorityForTask(task.id,role);
      await this.#config.coordinator.bindDispatchedTask(task.id,dispatchId,role);
      const result=await this.#config.roleRunner.issueAndRun({
        ...authority,role,approved_task_id:task.id,agent_base_url:url,
        trusted_gateway_task_id:dispatchId,
        subtask:{
          subtask_id:task.id,
          instruction:task.description,
          branch:this.#snapshot.approvedBranch,
          relevant_paths:[...new Set(paths)]
        }
      });
      if(result.role!==role||!result.task_id||
         result.artifact?.role!==role||
         result.artifact?.branch!==this.#snapshot.approvedBranch){
        throw Error("Protected A2A result does not match bound role/Task");
      }
      await this.#config.coordinator.confirmTask(
        dispatchId,observedA2ACompletion(result,dispatchId));
      this.#completed.add(task.id);
      return result;
    }catch(error){
      this.#terminal=true;
      // Fail closed on uncertain A2A dispatch: close Gateway and revoke the
      // operational root. Never automatically resubmit to another Agent.
      try{await this.#config.coordinator.closeExecution();}
      catch{
        throw new Error("Trusted dispatch failed; Gateway/credential reconciliation required",
          {cause:error});
      }
      throw error;
    }finally{this.#busy=false;}
  }

  /**
   * Prepare a trusted Orchestrator-only Task BEFORE the protected Gateway
   * call (e.g. create_branch). Its callback runs under the private trusted
   * root client, never ADK / Gemini. Gateway independently checks the effect.
   */
  async runOrchestratorTask(planTaskId:string,
    invoke:(gatewayTaskId:string)=>Promise<unknown>):Promise<void>{
    if(this.#terminal||this.#busy||this.#config.coordinator.phase!=="execution")
      throw Error("Trusted dispatcher is inactive");
    const task=this.#snapshot.plan.tasks.find(t=>t.id===planTaskId);
    if(!task||task.agent_id!=="orchestrator"||
       task.depends_on.some(id=>!this.#completed.has(id))||
       this.#started.has(task.id)||
       !this.#snapshot.approvedRows.some(p=>p.task_id===task.id&&
         p.agent_id==="orchestrator")){
      throw Error("Unknown, repeated, unapproved or dependency-blocked Orchestrator Task");
    }
    this.#busy=true;
    this.#started.add(task.id);
    const dispatchId="dispatch_"+randomBytes(16).toString("base64url");
    try{
      await this.#config.coordinator.bindDispatchedTask(task.id,dispatchId,"orchestrator");
      await invoke(dispatchId);
      await this.#config.coordinator.confirmTask(
        dispatchId,{
          source:"trusted_orchestrator",runtime_task_id:dispatchId,
          role:"orchestrator",state:"completed"
        });
      this.#completed.add(task.id);
    }catch(error){
      this.#terminal=true;
      try{await this.#config.coordinator.closeExecution();}
      catch{
        throw new Error("Trusted Orchestrator Task failed; credential reconciliation required",
          {cause:error});
      }
      throw error;
    }finally{this.#busy=false;}
  }
}
