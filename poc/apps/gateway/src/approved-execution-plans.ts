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
import { TOOL_NAMES, type AgentRole, type Permission, type PreparedRequestRecord } from "./types.ts";
import { GatewayError } from "./errors.ts";
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
export interface TrustedTaskCompletionAttestor {
  confirmCompleted(evidence: Readonly<{
    session_id: string;
    plan_digest: string;
    plan_task_id: string;
    runtime_task_id: string;
    successful_gateway_request_ids: readonly string[];
  }>): Promise<boolean>;
}

interface RuntimeTaskBinding {
  readonly runtimeTaskId: string;
  readonly planTaskId: string;
  readonly agent: AgentRole;
  readonly sessionId: string;
  readonly successfulRequests: Set<string>;
  completed: boolean;
  completing: boolean;
}

interface ActivePlan {
  readonly sessionId: string;
  readonly digest: string;
  readonly plan: any;
  readonly approval: any;
  readonly approvedAt: string;
  active: boolean;
  readonly completedPlanTasks: Set<string>;
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

  constructor(config:{
    repository:GatewayRepositoryConfig;
    engineerDid:string;
    approvals:AuthenticatedPlanStore;
    completionAttestor:TrustedTaskCompletionAttestor;
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
      const snapshot=structuredClone(plan), receipt=structuredClone(approval);
      const digest=planDigest(snapshot);
      this.#sessions.set(sessionId,{
        sessionId,digest,plan:snapshot,approval:receipt,approvedAt:receipt.approved_at,
        active:true,completedPlanTasks:new Set()
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
    const task=session.plan.tasks.find((t:any)=>t.id===planTaskId);
    if(!task || task.agent_id!==role ||
       [...this.#bindings.values()].some(b=>
         b.sessionId===sessionId && b.planTaskId===planTaskId)) {
      denied("A2A runtime task is not assigned to the approved agent");
    }
    this.#bindings.set(runtimeTaskId,{
      runtimeTaskId,planTaskId,agent:role,sessionId,
      successfulRequests:new Set(),completed:false,completing:false
    });
  }

  /** Called during Gateway Prepare, before a one-shot challenge is created. */
  authorizePrepare(runtimeTaskId:string, role:AgentRole, required:Permission):
    { plan_digest:string; plan_task_id:string } {
    const {session,binding}=this.#activeBinding(runtimeTaskId);
    if(binding.agent!==role || binding.completed) {
      denied("Runtime role or completed task is outside approved plan");
    }
    this.#checkAction(session,binding,required);
    return {plan_digest:session.digest,plan_task_id:binding.planTaskId};
  }

  /** Re-evaluate AFTER VP and OPA, immediately BEFORE provider I/O. */
  assertAuthorizedForExecution(record:PreparedRequestRecord):void {
    if(!record.approved_plan_digest || !record.approved_plan_task_id) {
      denied("Prepared request has no trusted plan binding");
    }
    const {session,binding}=this.#activeBinding(record.task_id);
    if(binding.agent!==record.agent_role || binding.completed ||
       record.approved_plan_task_id!==binding.planTaskId ||
       record.approved_plan_digest!==session.digest) {
      denied("Prepared plan digest, task binding or role changed");
    }
    this.#checkAction(session,binding,record.required_permission);
  }

  /** Gateway-confirmed provider results are tracked internally, not via A2A. */
  recordProviderSuccess(record:PreparedRequestRecord, performed:boolean):void {
    if(!performed) return; // mock providers do not prove real effects
    this.assertAuthorizedForExecution(record);
    this.#bindings.get(record.task_id)?.successfulRequests.add(record.request_id);
  }

  /**
   * Called ONLY by authenticated trusted A2A/CI completion coordinator.
   * Requires observed Gateway provider effects and external attestation.
   * No "mark complete" public HTTP route or model-facing MCP tool exists.
   */
  async confirmTaskCompletion(runtimeTaskId:string):Promise<void> {
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
        successful_gateway_request_ids:Object.freeze([...binding.successfulRequests])
      }));
    } catch {
      denied("Trusted task completion attestor failed closed");
    } finally {
      binding.completing=false;
    }
    if(!confirmed || !session.active) {
      denied("No verified A2A task completion attestation");
    }
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

  #checkAction(session:ActivePlan,binding:RuntimeTaskBinding,required:Permission):void {
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
