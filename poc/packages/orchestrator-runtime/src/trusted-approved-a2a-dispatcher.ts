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
import {approvedWorkBranch} from "../../../packages/plan-contracts/src/approved-work-branch.mjs";
import {TrustedApprovedExecutionPlans,type AuthenticatedPlanStore}
 from "../../../apps/gateway/src/approved-execution-plans.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import {prepareTrustedRepairFeedback,prepareTrustedRemoteRepairFeedback,
 type TrustedRepairFeedbackSignal}
 from "./trusted-validation-repair-feedback.ts";
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
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
  approvedRows:{task_id:string;agent_id:string;operation:string;resource:string}[];
  digest:string;
  approvedBranch:string;
}
/** A private control-flow result, never a model-visible source of authority. */
class VerifiedFailedTestSuspension extends Error {
 readonly verified:Readonly<TrustedRepairFeedbackSignal>;
 constructor(verified:Readonly<TrustedRepairFeedbackSignal>){
  super("Gateway confirmed terminal Docker FAIL; trusted repair admission required");
  this.verified=verified;
 }
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
  /**
   * R112 opt-in: only the host which owns BOTH the Gateway Task registry
   * and the original signed Rust-root intake can preserve an active root
   * after an independently corroborated terminal failed Test.
   */
  verifiedTestFailureRecovery?:Readonly<{
    gateway:TrustedApprovedExecutionPlans|TrustedPlanIpcClient;
    intake:TrustedOperationalEpochIntake;
  }>;
}

export class TrustedApprovedA2ADispatcher {
  readonly #config:TrustedApprovedA2ADispatcherConfig;
  readonly #snapshot:ApprovedSnapshot;
  readonly #completed=new Set<string>();
  readonly #started=new Set<string>();
  #busy=false;
  #terminal=false;
  #withinDag=false;

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
    if(config.verifiedTestFailureRecovery){
      const recovery=config.verifiedTestFailureRecovery;
      if(!(recovery.intake instanceof TrustedOperationalEpochIntake))
        throw Error("R117 recovery requires original signed Rust-root intake");
      if(recovery.gateway instanceof TrustedApprovedExecutionPlans){
        if(!recovery.gateway.isBoundToOperationalEpochIntake(recovery.intake))
          throw Error("R112 recovery requires identical Gateway/root intake");
      }else if(recovery.gateway instanceof TrustedPlanIpcClient){
        if(!recovery.gateway.operationalLeaseConfigured()||
           !recovery.gateway.operationalSessionDurableConfigured())
          throw Error("R117 remote Gateway lacks durable operational recovery fences");
      }else throw Error("R117 unknown remote Gateway recovery port");
      recovery.intake.assertSameCoordinator(config.coordinator);
    }
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
    // Reuse the SAME signed-resource branch derivation as Gateway.
    // Fail closed rather than picking a branch from model-supplied metadata.
    const root="gitea://"+plan.repository.authority+"/"+
      plan.repository.owner+"/"+plan.repository.repository;
    if(!plan.requested_permissions.some((p:any)=>p.resource!==root)){
      throw Error("Exactly one approved feature branch is required");
    }
    const approvedBranch=approvedWorkBranch(plan);
    const snapshot:ApprovedSnapshot=structuredClone({
      plan,approvedRows:rows,digest,approvedBranch
    });
    return new TrustedApprovedA2ADispatcher(config,snapshot);
  }

  get completedTaskIds():readonly string[]{return [...this.#completed];}
  get approvedBranch():string{return this.#snapshot.approvedBranch;}

  /**
   * Run the *entire* immutable DAG in dependency order. Each specialized
   * Task crosses the protected A2A path; the private Orchestrator callback
   * alone handles approved infrastructure operations (e.g. create_branch).
   *
   * The next node is NOT released by the remote A2A "completed" status:
   * dispatch() waits for independent trusted Gateway corroboration first.
   * This method does not dynamically rewrite, reassign or expand the plan.
   */
  async executeApprovedDag(config:{
    invokeOrchestratorTask?:(planTaskId:string,gatewayTaskId:string)=>Promise<unknown>;
    /** Trusted host-owned liveness check before EACH Task, including branch. */
    beforeTask?:(planTaskId:string)=>Promise<void>;
    /** Final independent live-run check after ALL verified Tasks but
     * BEFORE Gateway closure and native operational root revocation.
     * A rejected check must fail closed, never report completed DAG. */
    beforeCompletion?:()=>Promise<void>;
  }={}):Promise<{
    plan_digest:string;
    completed_task_ids:string[];
    specialized_results:DelegatedA2ARoleTaskResult[];
    status?:"completed"|"verified_test_failure_suspended";
    verified_test_failure?:Readonly<TrustedRepairFeedbackSignal>;
  }>{
    if(this.#terminal||this.#busy||
       this.#config.coordinator.phase!=="execution"||
       this.#started.size>0||this.#completed.size>0){
      throw Error("Trusted DAG execution requires a fresh approved Execution session");
    }
    const tasks=this.#snapshot.plan.tasks;
    if(tasks.some(t=>t.agent_id==="orchestrator")&&
       typeof config.invokeOrchestratorTask!=="function"){
      throw Error("Trusted DAG requires a private Orchestrator provider callback");
    }
    // A partially approved plan must not cause irreversible branch/file
    // effects before reaching an unapproved node later in the DAG.
    if(tasks.some(t=>!this.#snapshot.approvedRows.some(p=>
       p.task_id===t.id&&p.agent_id===t.agent_id))){
      throw Error("Approved DAG has a Task without Engineer-granted permissions");
    }
    this.#withinDag=true;
    const remaining=new Set(tasks.map(t=>t.id));
    const results:DelegatedA2ARoleTaskResult[]=[];
    try{
      while(remaining.size>0){
        const task=tasks.find(t=>remaining.has(t.id)&&
          t.depends_on.every(parent=>this.#completed.has(parent)));
        if(!task)throw Error("Approved DAG contains unreachable dependencies");
        // An initial OIDC check cannot authorize every later A2A/branch
        // effect. Recheck the live GitHub run before each independently
        // signed Task, not just once before loading the DAG.
        await config.beforeTask?.(task.id);
        if(this.#config.coordinator.phase!=="execution")
          throw Error("Trusted DAG operational session closed before Task");
        if(task.agent_id==="orchestrator"){
          await this.runOrchestratorTask(task.id,gatewayTaskId=>
            config.invokeOrchestratorTask!(task.id,gatewayTaskId));
        }else{
          results.push(await this.dispatch(task.id));
        }
        remaining.delete(task.id);
      }
      // The final Task may have completed AFTER the GitHub job was
      // canceled. Re-check its authenticated liveness before retiring
      // authority; a rejection enters catch and still closes the root.
      await config.beforeCompletion?.();
      if(this.#config.coordinator.phase!=="execution")
        throw Error("Operational session closed before final DAG attestation");
      // Completion is durable only once the trusted Gateway is closed and
      // the operational root revocation has been independently confirmed.
      await this.#config.coordinator.closeExecution();
      this.#terminal=true;
      return {
        plan_digest:this.#snapshot.digest,
        completed_task_ids:[...this.#completed],
        specialized_results:results
      };
    }catch(error){
      // This is NOT a generic A2A exception handler. The ONLY nonterminal
      // failure is a previously finalized Gateway Runner receipt under the
      // active, authenticated Rust root. The old dispatcher stays terminal:
      // trusted R106/R109 owner code must admit a NEW epoch and fresh Tasks.
      if(error instanceof VerifiedFailedTestSuspension &&
         this.#config.coordinator.phase==="execution"){
        this.#terminal=true;
        return {
          status:"verified_test_failure_suspended",
          plan_digest:this.#snapshot.digest,
          completed_task_ids:[...this.#completed],
          specialized_results:results,
          verified_test_failure:error.verified
        };
      }
      this.#terminal=true;
      // dispatch/runOrchestratorTask may have already failed closed.
      if(this.#config.coordinator.phase==="execution"){
        try{await this.#config.coordinator.closeExecution();}
        catch{
          throw new Error("Trusted DAG termination or revocation not confirmed",
            {cause:error});
        }
      }
      throw error;
    }finally{
      this.#withinDag=false;
    }
  }

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
    // Only APPROVED permission resources reach the model/A2A context.
    // The candidate Task may describe more requested files than the
    // Engineer actually approved; never leak those into relevant_paths.
    const approvedRows=this.#snapshot.approvedRows.filter(row=>
      row.task_id===task.id&&row.agent_id===task.agent_id);
    const paths:string[]=[];
    const approvedFilePermissions:Array<{
      operation:"read_file"|"update_file"|"create_file";path:string
    }>=[];
    for(const row of approvedRows){
      const resource=row.resource;
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
        if(["read_file","update_file","create_file"].includes(row.operation)){
          approvedFilePermissions.push({
            operation:row.operation as "read_file"|"update_file"|"create_file",path
          });
        }else{
          throw Error("Non-file permission is scoped to a file resource");
        }
      }else{
        throw Error("Task resource is outside approved working branch");
      }
    }
    if(new Set(paths).size>32||approvedFilePermissions.length>32) {
      throw Error("Approved Task has too many scoped file permissions");
    }
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
          relevant_paths:[...new Set(paths)],
          // Operation-specific, non-authoritative hints: reading a context
          // file NEVER makes it writable in the ADK or MCP tool surface.
          approved_file_permissions:approvedFilePermissions,
          ...(role==="test"?{approved_run_tests:approvedRows.some(row=>
            row.operation==="run_tests"&&row.resource===branchRoot)}:{})
        }
      });
      // The signed root may be revoked while protected A2A is in flight.
      // No stale A2A response may generate Gateway completion evidence.
      if(this.#config.coordinator.phase!=="execution")
        throw Error("Trusted A2A response arrived after operational shutdown");
      if(result.role!==role||!result.task_id||
         result.artifact?.role!==role||
         result.artifact?.branch!==this.#snapshot.approvedBranch){
        throw Error("Protected A2A result does not match bound role/Task");
      }
      await this.#config.coordinator.confirmTask(
        dispatchId,observedA2ACompletion(result,dispatchId));
      // A concurrent close may race the attestor. Never unlock a
      // dependent node based on a confirmation from a closed session.
      if(this.#config.coordinator.phase!=="execution")
        throw Error("Trusted A2A confirmation raced operational shutdown");
      this.#completed.add(task.id);
      return result;
    }catch(error){
      // An A2A "failed" message alone cannot preserve root authority.
      // Only the allowlisted controlled-tool-failure transport outcome AND
      // a Gateway-recorded, terminal, specific Test Runner FAIL qualify.
      const recovery=this.#config.verifiedTestFailureRecovery;
      if(this.#withinDag&&role==="test"&&recovery&&
         error instanceof Error&&
         error.message==="Protected A2A task ended without completion"&&
         this.#config.coordinator.phase==="execution"){
        try{
          const proof=recovery.gateway instanceof TrustedPlanIpcClient
            ?await prepareTrustedRemoteRepairFeedback({
              gateway:recovery.gateway,intake:recovery.intake,
              coordinator:this.#config.coordinator as TrustedExecutionCoordinator,
              sessionId:this.#config.sessionId,runtimeTestTaskId:dispatchId
            })
            :(recovery.gateway.confirmTestValidationFailure(dispatchId),
              await prepareTrustedRepairFeedback({
                gateway:recovery.gateway,intake:recovery.intake,
                sessionId:this.#config.sessionId,runtimeTestTaskId:dispatchId
              }));
          if(proof.status==="repair_planning_eligible"&&
             proof.failed_task_id===task.id&&
             proof.failed_runtime_task_id===dispatchId&&
             this.#config.coordinator.phase==="execution"){
            this.#terminal=true;
            throw new VerifiedFailedTestSuspension(proof);
          }
        }catch(verificationError){
          if(verificationError instanceof VerifiedFailedTestSuspension)
            throw verificationError;
          // No fallback based on A2A text or incomplete Runner metadata.
        }
      }
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
      if(this.#config.coordinator.phase!=="execution")
        throw Error("Trusted Orchestrator confirmation raced operational shutdown");
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
