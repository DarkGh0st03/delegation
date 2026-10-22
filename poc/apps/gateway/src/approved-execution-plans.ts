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
import type {ExecutionResult} from "./types.ts";
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
  readonly execution:ExecutionResult;
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
  readonly successfulRequests: Map<string,TrustedProviderEffect>;
  completed: boolean;
  completing: boolean;
}

interface ActivePlan {
  readonly sessionId: string;
  readonly digest: string;
  readonly plan: any;
  readonly approval: any;
  readonly approvedAt: string;
  readonly workBranch:string;
  active: boolean;
  readonly completedPlanTasks: Set<string>;
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
  readonly #operationalLeaseMs?:number;
  readonly #nowMs:()=>number;

  constructor(config:{
    repository:GatewayRepositoryConfig;
    engineerDid:string;
    approvals:AuthenticatedPlanStore;
    completionAttestor:TrustedTaskCompletionAttestor;
    /** Opt-in crash fence; mandatory for admitted paid GitHub handoffs. */
    operationalLeaseMs?:number;
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
    // Reserve before await to prevent two competing activations.
    this.#closedSessionIds.add(sessionId);
    try {
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
      this.#sessions.set(sessionId,{
        sessionId,digest,plan:snapshot,approval:receipt,approvedAt:receipt.approved_at,
        workBranch,
        active:true,completedPlanTasks:new Set(),
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
    const task=session.plan.tasks.find((t:any)=>t.id===planTaskId);
    if(!task || task.agent_id!==role ||
       [...this.#bindings.values()].some(b=>
         b.sessionId===sessionId && b.planTaskId===planTaskId)) {
      denied("A2A runtime task is not assigned to the approved agent");
    }
    this.#bindings.set(runtimeTaskId,{
      runtimeTaskId,planTaskId,agent:role,sessionId,
      successfulRequests:new Map(),completed:false,completing:false
    });
  }

  /** Called during Gateway Prepare, before a one-shot challenge is created. */
  authorizePrepare(runtimeTaskId:string, role:AgentRole, required:Permission,
    request?:NormalizedToolRequest):
    { plan_digest:string; plan_task_id:string; work_branch:string } {
    const {session,binding}=this.#activeBinding(runtimeTaskId);
    if(binding.agent!==role || binding.completed) {
      denied("Runtime role or completed task is outside approved plan");
    }
    this.#checkAction(session,binding,required,request);
    return {plan_digest:session.digest,plan_task_id:binding.planTaskId,
      work_branch:session.workBranch};
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
       record.approved_plan_task_id!==binding.planTaskId ||
       record.approved_plan_digest!==session.digest) {
      denied("Prepared plan digest, task binding or role changed");
    }
    // For specialized agents, the DID in the approved immutable agent
    // registry must match the presenter whose VP the Rust Core verified.
    // Orchestrator identity is resolved independently by the Rust role map.
    if(binding.agent!=="orchestrator" && verifiedPresenterId!==undefined) {
      const entry=session.plan.candidate_agents.find(
        (a:any)=>a.agent_id===binding.agent
      );
      if(!entry || entry.did!==verifiedPresenterId) {
        denied("Verified presenter DID differs from approved agent identity");
      }
    }
    if(record.approved_work_branch!==session.workBranch){
      denied("Trusted plan working branch changed after Prepare");
    }
    this.#checkAction(session,binding,record.required_permission,record.request);
  }

  /** Gateway-confirmed provider results are tracked internally, not via A2A. */
  recordProviderSuccess(
    record:PreparedRequestRecord,result:ExecutionResult,verifiedPresenterId:string
  ):void {
    if(!result.performed||result.provider==="mock")return;
    // Read-only responses can contain full repository file content and
    // are not independently sufficient to attest completed write/test work.
    // Never retain them in the in-memory completion-evidence registry.
    if(!["create_branch","create_pull_request","create_file",
          "update_file","run_tests"].includes(record.request.tool))return;
    this.assertAuthorizedForExecution(record,verifiedPresenterId);
    if(result.tool!==record.request.tool)return;
    // Failed Runner jobs cannot be evidence of a passing Test Task.
    if(result.provider==="runner"&&result.status!=="pass")return;
    this.#bindings.get(record.task_id)?.successfulRequests.set(record.request_id,
      Object.freeze({
        request_id:record.request_id,tool:record.request.tool,
        resource:record.required_permission.resource,
        execution:structuredClone(result)
      }));
  }

  /**
   * Called ONLY by authenticated trusted A2A/CI completion coordinator.
   * Requires observed Gateway provider effects and external attestation.
   * No "mark complete" public HTTP route or model-facing MCP tool exists.
   */
  async confirmTaskCompletion(runtimeTaskId:string,observation?:TrustedCompletionObservation):Promise<void> {
    const {session,binding}=this.#activeBinding(runtimeTaskId);
    if(binding.completed || binding.completing || !binding.successfulRequests.size) {
      denied("Cannot complete a task without confirmed provider effects");
    }
    this.#assertDependencies(session,binding);
    binding.completing=true;
    let confirmed=false;
    try {
      confirmed=await this.#attestor.confirmCompleted(Object.freeze({
        session_id:session.sessionId,plan_digest:session.digest,
        plan_task_id:binding.planTaskId,runtime_task_id:runtimeTaskId,
        role:binding.agent,
        successful_gateway_request_ids:Object.freeze([...binding.successfulRequests.keys()]),
        provider_effects:Object.freeze(
          [...binding.successfulRequests.values()].map(v=>structuredClone(v))),
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
    this.#ensureUnexpired(session);
    this.#assertDependencies(session,binding);
    binding.completed=true;
    session.completedPlanTasks.add(binding.planTaskId);
  }

  /** Existing prepared requests fail after this trusted revocation. */
  closeSession(sessionId:string):void {
    ensureId(sessionId,"session ID");
    const session=this.#sessions.get(sessionId);
    if(!session)denied("Unknown approved plan session");
    session.active=false;
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
    return {session,binding};
  }

  #assertDependencies(session:ActivePlan,binding:RuntimeTaskBinding):void {
    const task=session.plan.tasks.find((t:any)=>t.id===binding.planTaskId);
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
