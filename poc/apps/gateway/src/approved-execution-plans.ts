/**
 * Opt-in, in-process Gateway enforcement for an immutable Engineer-approved
 * execution plan. NO HTTP method is exposed to activate, bind, complete or
 * terminate a plan. Those operations belong to a separately authenticated
 * trusted coordinator, not to Gemini, MCP or an A2A request.
 *
 * Approval authenticity is supplied by the TrustedApprovalStore implementation.
 * A matching SHA-256 digest alone NEVER proves human consent.
 *
 * This is an additional gate, NOT a replacement for Rust DC/VP verification,
 * OPA policy, tool validation or repository provider restrictions.
 */
import { assertApprovedExecution, assertApprovedPlanScope, planDigest } from
  "../../../packages/plan-contracts/src/plan.mjs";
import { RUST_OPERATIONS } from "./operation-catalog.ts";
import {approvedWorkBranch} from "../../../packages/plan-contracts/src/approved-work-branch.mjs";
import { TOOL_NAMES, type AgentRole, type Permission, type PreparedRequestRecord,
  type NormalizedToolRequest } from "./types.ts";
import { GatewayError } from "./errors.ts";
import {TrustedOperationalSessionStore} from "./trusted-operational-session-store.ts";
import {TrustedOperationalEpochIntake} from "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-intake.ts";
import type {ExecutionResult,GiteaReadFileExecutionResult,RunnerExecutionResult} from "./types.ts";
import type {TrustedCompletionObservation} from "./trusted-task-observation.ts";
import type { GatewayRepositoryConfig } from "./types.ts";

const CATALOG = new Set<string>(RUST_OPERATIONS);
const SUPPORTED = new Set<string>(TOOL_NAMES);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const TASK_AGENT = new Set<string>(["orchestrator","backend","frontend","test"]);
const MAX_TASKS = 128;

export interface AuthenticatedPlanRecord {
  /** Retrieved from the trusted Engineer approval backend, never caller JSON. */
  plan: unknown;
  approval: unknown;
  authenticated_engineer_did: string;
}

export interface AuthenticatedPlanStore {
  loadAuthenticatedApproval(sessionId: string): Promise<AuthenticatedPlanRecord>;
}

/**
 * Attestation comes from the trusted A2A task-result/CI observer.
 * No model-supplied "completed":true, A2A history or arbitrary caller
 * text is accepted as proof of a finished task.
 */
export interface TrustedProviderEffect {
  readonly request_id:string;
  readonly tool:string;
  readonly resource:string;
  // A successful read is attested by metadata only. Never retain private
  // Gitea source content in the in-memory Gateway completion registry.
  readonly execution:ExecutionResult | Omit<GiteaReadFileExecutionResult,"content">;
}
export interface TrustedCompletionEvidence {
  readonly session_id:string;
  readonly plan_digest:string;
  readonly plan_task_id:string;
  readonly runtime_task_id:string;
  readonly role:AgentRole;
  readonly successful_gateway_request_ids:readonly string[];
  readonly provider_effects:readonly TrustedProviderEffect[];
  readonly observation?:TrustedCompletionObservation;
}
export interface TrustedTaskCompletionAttestor {
  confirmCompleted(evidence:Readonly<TrustedCompletionEvidence>):Promise<boolean>;
}

interface RuntimeTaskBinding {
  readonly runtimeTaskId: string;
  readonly planTaskId: string;
  readonly agent: AgentRole;
  readonly sessionId: string;
  readonly epochVersion:number;
  readonly successfulRequests: Map<string,TrustedProviderEffect>;
  completed: boolean;
  completing: boolean;
  /** Terminal validation FAILED, not a successful Test completion. */
  failedFinalized:boolean;
  failedRunner?:Readonly<TrustedRunnerFailure>;
}

export interface TrustedRunnerFailure {
  readonly status:"validation_failed";
  readonly request_id:string;
  readonly plan_task_id:string;
  readonly runtime_task_id:string;
  readonly epoch_version:number;
  readonly branch:string;
  readonly tested_commit_sha:string;
  readonly first_failed_phase:string;
  readonly typecheck_error_codes:readonly string[];
}
const RUNNER_PHASES=[
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
] as const;

interface ActivePlan {
  readonly sessionId: string;
  readonly digest: string;
  readonly plan: any;
  readonly approval: any;
  readonly approvedAt: string;
  readonly workBranch:string;
  currentEpoch:number;
  readonly admittedEpochTasks:Map<string,{plan:any;digest:string;epoch:number}>;
  active: boolean;
  /** Only trusted explicit close/retire, never mere lease expiry. */
  closedByTrustedOwner:boolean;
  readonly completedPlanTasks: Set<string>;
  /** Only a trusted, attested exact-SHA Runner success may populate this. */
  testedFeatureSha?:string;
  /** Gateway-owned TTL: never accepted from an agent or public HTTP. */
  leaseExpiresAtMs?:number;
}

function denied(message: string, code = "approved_plan_denied"): never {
  throw new GatewayError(403, code, message);
}
function ensureId(value:unknown, label:string):string {
  if(typeof value!=="string" || !ID.test(value)) {
    throw new GatewayError(400,"invalid_trusted_plan_binding","Invalid trusted "+label);
  }
  return value;
}

/**
 * Store and attestor MUST be injected by a trusted in-process coordinator.
 * The Gateway's public prepare/execute routes have no approval or completion
 * input fields and cannot mutate this registry.
 */
export class TrustedApprovedExecutionPlans {
  readonly #repository:GatewayRepositoryConfig;
  readonly #engineerDid:string;
  readonly #store:AuthenticatedPlanStore;
  readonly #attestor:TrustedTaskCompletionAttestor;
  readonly #sessions=new Map<string,ActivePlan>();
  readonly #bindings=new Map<string,RuntimeTaskBinding>();
  readonly #closedSessionIds=new Set<string>();
  // A trusted retirement fences an in-flight activation even if the
  // signed approval load is still pending.
  readonly #retiredIds=new Set<string>();
  readonly #sessionStore?:TrustedOperationalSessionStore;
  readonly #operationalLeaseMs?:number;
  readonly #nowMs:()=>number;
  readonly #epochIntake?:TrustedOperationalEpochIntake;
  readonly #epochAdmissionInFlight=new Set<string>();

  constructor(config:{
    repository:GatewayRepositoryConfig;
    engineerDid:string;
    approvals:AuthenticatedPlanStore;
    completionAttestor:TrustedTaskCompletionAttestor;
    /** Opt-in crash fence; mandatory for admitted paid GitHub handoffs. */
    operationalLeaseMs?:number;
    /** Production: mandatory one-shot durable Gateway activation ledger. */
    operationalSessionStore?:TrustedOperationalSessionStore;
    /** Only the owner-private Engineer-root-bound intake, not an A2A model payload. */
    operationalEpochIntake?:TrustedOperationalEpochIntake;
    nowMs?:()=>number;
  }){
    if(!config.engineerDid?.startsWith("did:") || !config.approvals ||
       typeof config.approvals.loadAuthenticatedApproval!=="function" ||
       !config.completionAttestor ||
       typeof config.completionAttestor.confirmCompleted!=="function") {
      throw new Error("Trusted Engineer approval store and task completion attestor are required");
    }
    this.#repository=structuredClone(config.repository);
    this.#engineerDid=config.engineerDid;
    this.#store=config.approvals;
    this.#attestor=config.completionAttestor;
    if(config.operationalSessionStore!==undefined&&
       !(config.operationalSessionStore instanceof TrustedOperationalSessionStore))
      throw Error("Invalid trusted operational session journal");
    this.#sessionStore=config.operationalSessionStore;
    if(config.operationalEpochIntake!==undefined &&
       !(config.operationalEpochIntake instanceof TrustedOperationalEpochIntake))
      throw Error("Trusted operational epoch intake instance required");
    this.#epochIntake=config.operationalEpochIntake;
    if(config.operationalLeaseMs!==undefined&&
       (!Number.isSafeInteger(config.operationalLeaseMs)||
        config.operationalLeaseMs<10_000||
        config.operationalLeaseMs>120_000))
      throw new Error("Trusted Gateway operational lease must be 10-120 seconds");
    if(config.nowMs!==undefined&&typeof config.nowMs!=="function")
      throw new Error("Trusted Gateway clock must be a trusted function");
    this.#operationalLeaseMs=config.operationalLeaseMs;
    this.#nowMs=config.nowMs??Date.now;
  }

  /** In-process trusted Coordinator can inspect this, NOT a public route. */
  operationalLeaseConfigured():boolean{
    return this.#operationalLeaseMs!==undefined;
  }
  /** Authenticated IPC capability: the deployed Gateway needs both fences. */
  operationalSessionDurableConfigured():boolean{
    return this.#sessionStore instanceof TrustedOperationalSessionStore;
  }

  #clock():number{
    const now=this.#nowMs();
    if(!Number.isSafeInteger(now)||now<0)
      denied("Trusted Gateway lease clock invalid");
    return now;
  }

  #ensureUnexpired(session:ActivePlan):void{
    if(!session.active)denied("No active trusted plan session");
    if(this.#operationalLeaseMs!==undefined){
      const now=this.#clock();
      if(session.leaseExpiresAtMs===undefined||
         now>=session.leaseExpiresAtMs){
        // Expiration is terminal; a clock rollback or late Engineer cannot
        // resurrect this session. Root revocation is separately reconciled.
        session.active=false;
        denied("Trusted Gateway operational lease expired; plan permanently denied");
      }
    }
  }

  /** Called ONLY from trusted Coordinator after re-verifying GitHub Actions.
   * The agent, A2A, MCP and public Gateway HTTP have NO renewal endpoint.
   */
  renewLease(sessionId:string,expectedDigest:string):void{
    ensureId(sessionId,"session ID");
    if(this.#operationalLeaseMs===undefined)
      denied("Trusted Gateway operational lease is not configured");
    const session=this.#sessions.get(sessionId);
    if(!session || session.digest!==expectedDigest)
      denied("Trusted Gateway lease session or signed digest mismatch");
    this.#ensureUnexpired(session);
    session.leaseExpiresAtMs=this.#clock()+this.#operationalLeaseMs;
  }

  /**
   * Trusted activation is tied to the externally verified Gitea base SHA.
   * This does NOT issue the operational root; the Engineer's independent
   * root issuance/confirmed provisional revocation is a separate prerequisite.
   */
  async activate(sessionId:string, expectedBaseRevision:string):Promise<string> {
    ensureId(sessionId,"session ID");
    if(!SHA.test(expectedBaseRevision)) {
      throw new GatewayError(400,"invalid_trusted_plan_binding","Trusted Gitea SHA required");
    }
    if(this.#sessions.has(sessionId) || this.#closedSessionIds.has(sessionId)) {
      throw new GatewayError(409,"approved_plan_conflict","Plan session is already installed or closed");
    }
    // Reserve in RAM before any await and durably on the Gateway disk
    // BEFORE using a persisted human approval. If Gateway dies afterwards,
    // its replacement cannot re-activate this session or reissue authority.
    this.#closedSessionIds.add(sessionId);
    try {
      await this.#sessionStore?.reserveActivation(sessionId);
      if(this.#retiredIds.has(sessionId))
        denied("Operational session retired during activation");
      const fetched=await this.#store.loadAuthenticatedApproval(sessionId);
      if(fetched?.authenticated_engineer_did!==this.#engineerDid) {
        denied("Approval is not authenticated for the expected Engineer");
      }
      const plan=fetched.plan as any, approval=fetched.approval as any;
      const approved=assertApprovedPlanScope(plan,approval,{
        allowedOperations:CATALOG,expectedEngineerDid:this.#engineerDid
      }) as Array<{operation:string}>;
      if(plan.session_id!==sessionId ||
         plan.base_revision!==expectedBaseRevision ||
         JSON.stringify(plan.repository)!==JSON.stringify(this.#repository) ||
         !Array.isArray(plan.tasks) || plan.tasks.length>MAX_TASKS ||
         approved.some(p=>!SUPPORTED.has(p.operation)) ||
         plan.tasks.some((t:any)=>!TASK_AGENT.has(t.agent_id))) {
        denied("Approved plan does not match trusted Gitea snapshot or provider capability");
      }
      const workBranch=approvedWorkBranch(plan);
      const snapshot=structuredClone(plan), receipt=structuredClone(approval);
      const digest=planDigest(snapshot);
      if(this.#retiredIds.has(sessionId))
        denied("Operational session retired while verifying signed approval");
      this.#sessions.set(sessionId,{
        sessionId,digest,plan:snapshot,approval:receipt,approvedAt:receipt.approved_at,
        workBranch,currentEpoch:1,admittedEpochTasks:new Map(),
        active:true,closedByTrustedOwner:false,completedPlanTasks:new Set(),
        ...(this.#operationalLeaseMs===undefined?{}:
          {leaseExpiresAtMs:this.#clock()+this.#operationalLeaseMs})
      });
      return digest;
    } catch(error) {
      // Never reuse a failed session ID: the approval may have changed during
      // the failed external call, so a new authenticated session is required.
      throw error;
    }
  }

  /**
   * R103: Owner-private opt-in admission of the NEXT durably reserved plan.
   * Engineer consent and the already-issued Rust root are independently
   * verified by TrustedOperationalEpochIntake; this is a Gateway Task
   * registry only. It does NOT issue a DC, verify a VP or call the provider.
   *
   * A failed Runner Task remains incomplete in the current API; entering a
   * repair epoch requires a separate trusted failure quiescence mechanism.
   * Until that is integrated, unresolved tasks MUST block this transition.
   */
  async admitNextOperationalEpoch(sessionId:string,epochVersion:number):
    Promise<Readonly<{status:"gateway_epoch_admitted";epoch:number;plan_digest:string}>>{
    ensureId(sessionId,"session ID");
    const session=this.#sessions.get(sessionId);
    if(!this.#epochIntake||!session||
       !Number.isSafeInteger(epochVersion)||epochVersion<2||
       this.#epochAdmissionInFlight.has(sessionId))
      denied("Missing trusted epoch intake, active session or unique transition");
    this.#ensureUnexpired(session);
    if(epochVersion!==session.currentEpoch+1)
      denied("Operational epoch version must advance exactly once");
    // An in-flight original/previous Task may have an authorized Prepare.
    // Never retire its grants before independently confirming quiescence.
    this.#assertEpochQuiescent(session);
    this.#epochAdmissionInFlight.add(sessionId);
    try{
      const history=await this.#epochIntake.verifiedEpochHistory();
      // Close/expiry may happen while the private store is performing IO.
      this.#ensureUnexpired(session);
      if(this.#sessions.get(sessionId)!==session||
         epochVersion!==session.currentEpoch+1||history.length!==epochVersion||
         history[0]?.plan_digest!==session.digest)
        denied("Operational epoch changed or differs from original signed root");
      const epoch=history.at(-1);
      const plan=epoch?.plan;
      if(!epoch||!plan||epoch.epoch!==epochVersion||
         plan.session_id!==sessionId||
         plan.base_revision!==session.plan.base_revision||
         JSON.stringify(plan.repository)!==JSON.stringify(this.#repository)||
         approvedWorkBranch(plan)!==session.workBranch||
         planDigest(plan)!==epoch.plan_digest||
         plan.tasks.length>MAX_TASKS||
         plan.tasks.some((t:any)=>!TASK_AGENT.has(t.agent_id)))
        denied("Operational epoch plan is outside pinned root session");
      this.#assertEpochQuiescent(session);
      for(const task of plan.tasks){
        if(session.plan.tasks.some((t:any)=>t.id===task.id)||
           session.admittedEpochTasks.has(task.id)||
           [...this.#bindings.values()].some(b=>b.sessionId===sessionId&&
             b.planTaskId===task.id))
          denied("Replayed operational Task ID");
      }
      // Synchronous commit of the entire admitted plan after full checking.
      const approvedPlan=structuredClone(plan);
      for(const t of approvedPlan.tasks)
        session.admittedEpochTasks.set(t.id,{
          plan:approvedPlan,digest:epoch.plan_digest,epoch:epochVersion
        });
      session.currentEpoch=epochVersion;
      // An old passing Test may never authorize a PR after replanning.
      session.testedFeatureSha=undefined;
      return Object.freeze({status:"gateway_epoch_admitted" as const,
        epoch:epochVersion,plan_digest:epoch.plan_digest});
    }finally{
      this.#epochAdmissionInFlight.delete(sessionId);
    }
  }

  /** Bind the opaque A2A runtime task to ONE exact plan task and role. */
  bindTask(sessionId:string, planTaskId:string, runtimeTaskId:string, role:AgentRole):void {
    ensureId(sessionId,"session ID");
    ensureId(planTaskId,"plan task ID");
    ensureId(runtimeTaskId,"A2A runtime task ID");
    const session=this.#sessions.get(sessionId);
    if(!session?.active || this.#bindings.has(runtimeTaskId)) {
      denied("Unknown, inactive or duplicate approved runtime task");
    }
    this.#ensureUnexpired(session);
    const plan=session.currentEpoch===1?session.plan:
      session.admittedEpochTasks.get(planTaskId)?.plan;
    const task=plan?.tasks.find((t:any)=>t.id===planTaskId);
    if(!task || task.agent_id!==role ||
       [...this.#bindings.values()].some(b=>
         b.sessionId===sessionId && b.planTaskId===planTaskId)) {
      denied("A2A runtime task is not assigned to the current admitted epoch");
    }
    this.#bindings.set(runtimeTaskId,{
      runtimeTaskId,planTaskId,agent:role,sessionId,
      epochVersion:session.currentEpoch,
      successfulRequests:new Map(),completed:false,completing:false,
      failedFinalized:false
    });
  }

  /** Called during Gateway Prepare, before a one-shot challenge is created. */
  authorizePrepare(runtimeTaskId:string, role:AgentRole, required:Permission,
    request?:NormalizedToolRequest):
    { plan_digest:string; plan_task_id:string; work_branch:string;
      tested_head_sha?:string } {
    const {session,binding}=this.#activeBinding(runtimeTaskId);
    if(binding.agent!==role || binding.completed || binding.completing ||
       binding.failedRunner!==undefined || binding.failedFinalized) {
      denied("Runtime role or completing/completed task is outside approved plan");
    }
    this.#checkAction(session,binding,required,request);
    const approvedTestedSha=request?.tool==="create_pull_request"
      ?session.testedFeatureSha:undefined;
    if(request?.tool==="create_pull_request"&&!approvedTestedSha)
      denied("PR requires a trusted, completed exact-SHA Runner acceptance");
    return {plan_digest:session.digest,plan_task_id:binding.planTaskId,
      work_branch:session.workBranch,
      ...(approvedTestedSha?{tested_head_sha:approvedTestedSha}:{})};
  }

  /** Re-evaluate AFTER VP and OPA, immediately BEFORE provider I/O. */
  assertAuthorizedForExecution(
    record:PreparedRequestRecord, verifiedPresenterId?:string
  ):void {
    if(!record.approved_plan_digest || !record.approved_plan_task_id) {
      denied("Prepared request has no trusted plan binding");
    }
    const {session,binding}=this.#activeBinding(record.task_id);
    if(binding.agent!==record.agent_role || binding.completed ||
       binding.failedRunner!==undefined || binding.failedFinalized ||
       record.approved_plan_task_id!==binding.planTaskId ||
       record.approved_plan_digest!==session.digest) {
      denied("Prepared plan digest, task binding or role changed");
    }
    // For specialized agents, the DID in the approved immutable agent
    // registry must match the presenter whose VP the Rust Core verified.
    // Orchestrator identity is resolved independently by the Rust role map.
    if(binding.agent!=="orchestrator" && verifiedPresenterId!==undefined) {
      const effectivePlan=this.#taskPlan(session,binding);
      const entry=effectivePlan.candidate_agents.find(
        (a:any)=>a.agent_id===binding.agent
      );
      if(!entry || entry.did!==verifiedPresenterId) {
        denied("Verified presenter DID differs from approved agent identity");
      }
    }
    if(record.approved_work_branch!==session.workBranch){
      denied("Trusted plan working branch changed after Prepare");
    }
    if(record.request.tool==="create_pull_request"&&
       (!session.testedFeatureSha||
        record.approved_tested_head_sha!==session.testedFeatureSha)){
      denied("Prepared PR SHA differs from completed trusted Runner acceptance");
    }
    this.#checkAction(session,binding,record.required_permission,record.request);
  }

  /** Gateway-confirmed provider results are tracked internally, not via A2A. */
  recordProviderSuccess(
    record:PreparedRequestRecord,result:ExecutionResult,verifiedPresenterId:string
  ):void {
    if(!result.performed||result.provider==="mock")return;
    if(!["create_branch","create_pull_request","create_file",
          "update_file","run_tests","read_file"].includes(record.request.tool))return;
    this.assertAuthorizedForExecution(record,verifiedPresenterId);
    if(result.tool!==record.request.tool)return;
    if(result.tool==="read_file"){
      // Read-only signed Tasks are permitted by the Planner contract and
      // independently attested by GatewayCorroboratedTaskAttestor. Previously
      // dropping all reads made those legitimate Tasks impossible to complete.
      // Record only authenticated provider metadata, NEVER source bytes.
      if(record.request.tool!=="read_file"||result.provider!=="gitea"||
         !SHA.test(result.revision)||
         result.branch!==record.request.arguments.branch||
         result.path!==record.request.arguments.path)return;
      this.#bindings.get(record.task_id)?.successfulRequests.set(record.request_id,
        Object.freeze({
          request_id:record.request_id,tool:"read_file",
          resource:record.required_permission.resource,
          execution:{
            provider:"gitea" as const,performed:true as const,
            tool:"read_file" as const,branch:result.branch,path:result.path,
            revision:result.revision,blob_sha:result.blob_sha,
            last_commit_sha:result.last_commit_sha,size:result.size,
            encoding:result.encoding
          }
        }));
      return;
    }
    // A Runner FAIL is valid validation feedback, but NEVER a completed
    // Test Task or PR authority. Store it only after VP/Core+OPA permitted
    // an actual Runner provider execution. No model assertion is trusted.
    if(result.provider==="runner"&&result.status==="fail"){
      const {session,binding}=this.#activeBinding(record.task_id);
      const phases=result.phases;
      if(binding.agent!=="test"||record.agent_role!=="test"||
         binding.failedRunner!==undefined||binding.completed||
         binding.completing||result.tool!=="run_tests"||
         result.runner_profile!=="poc-default"||
         result.branch!==session.workBranch||
         result.branch!==record.request.arguments.branch||
         !SHA.test(result.tested_commit_sha)||
         result.tested_commit_sha!==result.revision||
         !Array.isArray(phases)||phases.length!==RUNNER_PHASES.length||
         phases.some((p,i)=>p.phase!==RUNNER_PHASES[i]||
           !["pass","fail","skipped"].includes(p.status))||
         !phases.some(p=>p.status==="fail")||
         result.project_tests?.status==="pass"&&
           phases.some(p=>p.phase!=="researcher_acceptance"&&p.status==="fail"))
        denied("Untrustworthy or incomplete failed Runner receipt");
      const codes=result.typecheck_error_codes;
      if(codes!==undefined&&(!Array.isArray(codes)||codes.length>16||
         codes.some(c=>typeof c!=="string"||!/^TS[0-9]{4}$/u.test(c))))
        denied("Untrusted compiler diagnostic code");
      // Only bounded, whitelisted metadata crosses the private feedback
      // boundary: no log references, stderr, source code or raw LLM text.
      const first=phases.find(p=>p.status==="fail")!.phase;
      binding.failedRunner=Object.freeze({
        status:"validation_failed",request_id:record.request_id,
        plan_task_id:binding.planTaskId,runtime_task_id:binding.runtimeTaskId,
        epoch_version:binding.epochVersion,
        branch:result.branch,tested_commit_sha:result.tested_commit_sha,
        first_failed_phase:first,
        typecheck_error_codes:Object.freeze([...(codes??[])])
      });
      session.testedFeatureSha=undefined;
      return;
    }
    if(result.provider==="runner"&&result.status!=="pass")return;
    // Any successful approved file mutation invalidates the previous test
    // attestation; tests must be rerun on the new immutable branch head.
    if(result.tool==="create_file"||result.tool==="update_file"){
      const bound=this.#bindings.get(record.task_id);
      const session=bound&&this.#sessions.get(bound.sessionId);
      if(session)session.testedFeatureSha=undefined;
    }
    this.#bindings.get(record.task_id)?.successfulRequests.set(record.request_id,
      Object.freeze({
        request_id:record.request_id,tool:record.request.tool,
        resource:record.required_permission.resource,
        execution:structuredClone(result)
      }));
  }

  /**
   * R104 private validation-failure acknowledgement: unlike PASS this does
   * NOT complete a Test Task, attest tests, or enable a PR. Only previously
   * Gateway-observed Docker failure metadata is eligible. The owner may then
   * request a distinct, attenuated repair epoch under the same Rust root.
   */
  confirmTestValidationFailure(runtimeTaskId:string):
    Readonly<TrustedRunnerFailure>{
    const {session,binding}=this.#activeBinding(runtimeTaskId);
    if(binding.agent!=="test"||binding.completed||binding.completing||
       binding.failedFinalized||!binding.failedRunner)
      denied("No unique verified failed Runner Test Task");
    this.#assertDependencies(session,binding);
    // Do not let earlier successful Runner effects provide an alternate
    // completed Test for the same failed Task.
    if([...binding.successfulRequests.values()].some(e=>e.tool==="run_tests"))
      denied("Conflicting Runner PASS and FAIL in the same Task");
    binding.failedFinalized=true;
    session.testedFeatureSha=undefined;
    return binding.failedRunner;
  }

  /** Owner-private metadata only. No signed VP, source, logs or credentials. */
  readVerifiedTestFailure(runtimeTaskId:string):
    Readonly<TrustedRunnerFailure>{
    const {binding}=this.#activeBinding(runtimeTaskId);
    if(binding.agent!=="test"||!binding.failedFinalized||
       !binding.failedRunner||binding.completed)
      denied("No terminal Gateway-confirmed validation failure");
    return binding.failedRunner;
  }

  /**
   * Called ONLY by authenticated trusted A2A/CI completion coordinator.
   * Requires observed Gateway provider effects and external attestation.
   * No "mark complete" public HTTP route or model-facing MCP tool exists.
   */
  async confirmTaskCompletion(runtimeTaskId:string,observation?:TrustedCompletionObservation):Promise<void> {
    const {session,binding}=this.#activeBinding(runtimeTaskId);
    if(binding.completed || binding.completing||binding.failedRunner||
       binding.failedFinalized || !binding.successfulRequests.size) {
      denied("Cannot complete a task without confirmed provider effects");
    }
    this.#assertDependencies(session,binding);
    // Freeze the exact Gateway effects about to be independently attested.
    // A previously prepared operation can finish while the asynchronous
    // attestor is awaiting evidence. Such a late provider effect must never
    // be silently added to the set of effects used for task completion.
    const attestedRequests=[...binding.successfulRequests.entries()];
    binding.completing=true;
    let confirmed=false;
    try {
      confirmed=await this.#attestor.confirmCompleted(Object.freeze({
        session_id:session.sessionId,plan_digest:session.digest,
        plan_task_id:binding.planTaskId,runtime_task_id:runtimeTaskId,
        role:binding.agent,
        successful_gateway_request_ids:Object.freeze(
          attestedRequests.map(([id])=>id)),
        provider_effects:Object.freeze(
          attestedRequests.map(([,effect])=>structuredClone(effect))),
        ...(observation?{observation:structuredClone(observation)}:{})
      }));
    } catch {
      denied("Trusted task completion attestor failed closed");
    } finally {
      binding.completing=false;
    }
    if(!confirmed || !session.active) {
      denied("No verified A2A task completion attestation");
    }
    // Comparing the whole ordered registry matters even for a second Runner
    // PASS on the *same* SHA: the attestor did not approve that new request.
    const currentRequests=[...binding.successfulRequests.entries()];
    if(currentRequests.length!==attestedRequests.length||
       currentRequests.some(([id,effect],i)=>
         id!==attestedRequests[i][0]||
         effect!==attestedRequests[i][1])) {
      denied("Gateway provider effects changed during Task attestation");
    }
    this.#ensureUnexpired(session);
    this.#assertDependencies(session,binding);
    // A model-reported "tests passed" cannot supply this SHA. It comes only
    // from a Gateway-recorded Runner provider effect plus trusted attestation.
    const successfulEffects=[...binding.successfulRequests.values()];
    const relevantEffects=successfulEffects.filter(v=>
      v.tool==="run_tests"||v.tool==="update_file"||
      v.tool==="create_file");
    const lastRelevant=relevantEffects.at(-1);
    // Only the FINAL provider effect capable of changing the tested
    // revision may establish PR authority. An earlier passing Docker
    // receipt is stale after any later approved write. After a repair,
    // a new passing Runner may legitimately attest a different SHA.
    if(lastRelevant?.tool==="run_tests"){
      const run=lastRelevant.execution;
      const lastMutation=relevantEffects.filter(v=>
        v.tool==="update_file"||v.tool==="create_file").at(-1)?.execution;
      if(run.provider==="runner"&&run.tool==="run_tests"&&
         run.branch===session.workBranch&&run.status==="pass"&&
         run.project_tests?.status==="pass"&&
         run.researcher_acceptance?.status==="pass"&&
         SHA.test(run.tested_commit_sha)&&
         (lastMutation===undefined||(
           lastMutation.provider==="gitea"&&
           "commit_sha" in lastMutation&&
           lastMutation.commit_sha===run.tested_commit_sha)))
        session.testedFeatureSha=run.tested_commit_sha;
    }
    binding.completed=true;
    session.completedPlanTasks.add(binding.planTaskId);
  }


  /**
   * Owner-private, POST-RETIREMENT read of the exact provider-corrobated Test
   * evidence. This is NOT an authorization, public API, A2A or MCP method.
   * The caller must separately verify native DC/root retirement. Returning
   * only fixed pass statuses avoids leaking Runner stderr or source paths.
   */
  readVerifiedRunnerEffect(query:Readonly<{
    session_id:string;task_id:string;branch:string;tested_commit_sha:string;
  }>):Readonly<Pick<RunnerExecutionResult,
    "provider"|"performed"|"tool"|"branch"|"tested_commit_sha"|"status"|
    "project_tests"|"researcher_acceptance"|"phases">>{
    if(!query||typeof query!=="object"||Array.isArray(query)||
       !ID.test(query.session_id)||!ID.test(query.task_id)||
       !SHA.test(query.tested_commit_sha))denied("Invalid trusted Runner query");
    const session=this.#sessions.get(query.session_id);
    // Closed, durably retired gateway authority and a finished TEST Task
    // are prerequisites. An A2A "completed" claim alone is insufficient.
    if(!session||session.active||!session.closedByTrustedOwner||
       !this.#closedSessionIds.has(query.session_id)||
       session.workBranch!==query.branch||
       session.testedFeatureSha!==query.tested_commit_sha||
       !session.completedPlanTasks.has(query.task_id))
      denied("No retired signed Test acceptance for requested exact SHA");
    const matches=[...this.#bindings.values()].filter(b=>
      b.sessionId===query.session_id&&b.planTaskId===query.task_id&&
      b.agent==="test"&&b.completed&&
      b.epochVersion===session.currentEpoch);
    if(matches.length!==1)denied("No unique attested Test Task");
    const b=matches[0];
    const runnerUri="gitea://"+this.#repository.authority+"/"+
      this.#repository.owner+"/"+this.#repository.repository+
      "/branches/"+encodeURIComponent(query.branch);
    const epochEntry=session.admittedEpochTasks.get(query.task_id);
    if(epochEntry&&epochEntry.epoch!==session.currentEpoch)
      denied("Test result comes from a stale operational epoch");
    const effectivePlan=epochEntry?.plan??session.plan;
    const signedRows=effectivePlan.requested_permissions.filter((p:any)=>
      p.task_id===query.task_id&&p.agent_id==="test"&&
      p.operation==="run_tests"&&p.resource===runnerUri&&
      (epochEntry!==undefined||session.approval.approved_permission_ids.includes(p.id)));
    if(signedRows.length!==1)denied("No authenticated Test Runner scope");
    const relevant=[...b.successfulRequests.values()].filter(e=>
      e.tool==="run_tests"||e.tool==="update_file"||e.tool==="create_file");
    const last=relevant.at(-1);
    const run=last?.execution;
    const phases=["dependency_install","typecheck","backend_tests",
      "frontend_tests","build","playwright_e2e","researcher_acceptance"];
    if(last?.tool!=="run_tests"||!run||run.provider!=="runner"||
       run.tool!=="run_tests"||run.status!=="pass"||
       run.runner_profile!=="poc-default"||
       run.branch!==query.branch||
       run.tested_commit_sha!==query.tested_commit_sha||
       run.project_tests?.status!=="pass"||
       run.researcher_acceptance?.status!=="pass"||
       !Array.isArray(run.phases)||run.phases.length!==phases.length||
       run.phases.some((p,i)=>p.phase!==phases[i]||p.status!=="pass"))
      denied("Incomplete trusted exact-SHA Runner acceptance");
    return Object.freeze({
      provider:"runner" as const,performed:true as const,
      tool:"run_tests" as const,branch:run.branch,
      tested_commit_sha:run.tested_commit_sha,status:"pass" as const,
      // Defensive copy. The caller never receives the internal provider
      // effect or its raw stderr; mutating this array cannot alter the store.
      phases:run.phases.map(p=>({phase:p.phase,status:"pass" as const})),
      project_tests:Object.freeze({status:"pass" as const,phases:[]}),
      researcher_acceptance:Object.freeze({
        phase:"researcher_acceptance" as const,status:"pass" as const
      })
    });
  }

  /** Existing prepared requests fail after this trusted revocation. */
  /** Trusted crash recovery: permanently tombstone an orphan session even
   * if the old host died before the Gateway activation request completed. */
  async retireSession(sessionId:string):Promise<void> {
    ensureId(sessionId,"session ID");
    // Fence synchronously before the first await. A concurrent activation
    // must never install a new active plan when retirement has started.
    this.#retiredIds.add(sessionId);
    this.#closedSessionIds.add(sessionId);
    const session=this.#sessions.get(sessionId);
    if(session)session.active=false;
    // ACK only after owner-private durable fsync. An uncertain write
    // blocks host recovery and preserves the separate Rust root journal.
    await this.#sessionStore?.markRetired(sessionId);
    if(session)session.closedByTrustedOwner=true;
  }

  closeSession(sessionId:string):void {
    ensureId(sessionId,"session ID");
    const session=this.#sessions.get(sessionId);
    if(!session)denied("Unknown approved plan session");
    session.active=false;
    session.closedByTrustedOwner=true;
    // Terminal state: a changed plan requires a NEW authenticated session,
    // reapproval and new operational root. Never overwrite this digest.
  }

  #activeBinding(runtimeTaskId:string):{
    session:ActivePlan;binding:RuntimeTaskBinding
  }{
    const binding=this.#bindings.get(runtimeTaskId);
    const session=binding && this.#sessions.get(binding.sessionId);
    if(!binding || !session?.active) {
      denied("No active trusted plan/task binding");
    }
    this.#ensureUnexpired(session);
    if(binding.epochVersion!==session.currentEpoch)
      denied("Stale operational epoch task binding");
    return {session,binding};
  }

  /**
   * A plan cannot be skipped merely because its Tasks were never bound.
   * Check every Task of the currently admitted DAG, not only the subset
   * observed in the runtime-task map. A failed Test will need a separate,
   * trusted terminal-failure report before it can qualify for transition.
   */
  #assertEpochQuiescent(session:ActivePlan):void{
    const previous=session.currentEpoch===1?session.plan:
      [...session.admittedEpochTasks.values()]
        .find(x=>x.epoch===session.currentEpoch)?.plan;
    if(!previous||!Array.isArray(previous.tasks)||!previous.tasks.length)
      denied("Current operational epoch is missing its immutable plan");
    for(const task of previous.tasks){
      const bound=[...this.#bindings.values()].filter(b=>
        b.sessionId===session.sessionId&&
        b.epochVersion===session.currentEpoch&&
        b.planTaskId===task.id);
      if(bound.length!==1||bound[0].completing||
         !(bound[0].completed||
           (task.agent_id==="test"&&bound[0].failedFinalized)))
        denied("Previous epoch has unresolved, unbound or in-flight Tasks");
    }
  }

  #taskPlan(session:ActivePlan,binding:RuntimeTaskBinding):any{
    if(binding.epochVersion===1)return session.plan;
    const admitted=session.admittedEpochTasks.get(binding.planTaskId);
    if(!admitted||admitted.epoch!==binding.epochVersion)
      denied("No trusted admitted plan for this Task");
    return admitted.plan;
  }

  #assertDependencies(session:ActivePlan,binding:RuntimeTaskBinding):void {
    const task=this.#taskPlan(session,binding).tasks.find(
      (t:any)=>t.id===binding.planTaskId);
    if(!task)denied("Plan Task no longer exists");
    for(const dependency of task.depends_on) {
      if(!session.completedPlanTasks.has(dependency)) {
        denied("Approved Task dependency has not been confirmed complete");
      }
    }
  }

  #checkAction(session:ActivePlan,binding:RuntimeTaskBinding,required:Permission,
    request?:NormalizedToolRequest):void {
    if(!request)denied("Trusted operation body is required for plan branch enforcement");
    // The branch comes from the signed plan, never from request metadata.
    const branch=request.tool==="create_branch"?request.arguments.branch:
      request.tool==="create_pull_request"?request.arguments.head_branch:
      "branch" in request.arguments?request.arguments.branch:undefined;
    if(branch!==undefined&&branch!==session.workBranch){
      denied("Provider branch differs from immutable approved plan");
    }
    if((request.tool==="create_branch"||request.tool==="create_pull_request")&&
       request.arguments.base_branch!=="main"){
      denied("Approved work must originate from main; main cannot be mutated");
    }
    if(binding.epochVersion>1){
      // R101 independently verified this immutable epoch against the
      // actually issued Rust parent BEFORE trusted Gateway registration.
      // Require exact Task, role, resource and operation again at Prepare,
      // AFTER VP/OPA and immediately before every provider operation.
      const plan=this.#taskPlan(session,binding);
      const task=plan.tasks.find((t:any)=>t.id===binding.planTaskId);
      if(!task||task.agent_id!==binding.agent||
         task.depends_on.some((id:string)=>!session.completedPlanTasks.has(id))||
         !plan.requested_permissions.some((p:any)=>
           p.task_id===binding.planTaskId&&p.agent_id===binding.agent&&
           p.resource===required.resource&&p.operation===required.operation))
        denied("Operation, role, permission or dependency outside admitted epoch");
      return;
    }
    try {
      assertApprovedExecution(session.plan,session.approval,{
        task_id:binding.planTaskId,
        agent_id:binding.agent,
        resource:required.resource,
        operation:required.operation
      },{
        allowedOperations:CATALOG,
        completedTaskIds:[...session.completedPlanTasks]
      });
    } catch {
      denied("Operation, resource, task, role or dependencies not in approved plan");
    }
  }
}
