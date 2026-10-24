/**
 * Trusted handoff (in-process or authenticated private IPC):
 * Planning read-only DC -> signed Engineer approval -> confirmed DC revocation
 * -> independent operational root -> trusted Gateway plan activation.
 *
 * The legacy Account Suspension coordinator is deliberately untouched.
 * This coordinator is NOT exposed to Gemini, MCP or public Gateway HTTP.
 */
import type {TrustedCompletionObservation} from "../../../apps/gateway/src/trusted-task-observation.ts";
import type {AgentRole} from "../../../apps/gateway/src/types.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";
import type {DelegatedA2ARoleTaskResult} from "./a2a-workflow.ts";
import {TrustedOperationalRecoveryStore}
  from "./trusted-operational-recovery-store.ts";
import {observedA2ACompletion,observedOrchestratorProviderCompletion} from "./trusted-a2a-observer.ts";
import type {
  RootParameters,TrustedEngineerAuthoritySession
} from "./trusted-engineer-authority.ts";
/** Structural port permits a separate-process authenticated transport. */
export interface TrustedApprovedPlanControl {
  activate(sessionId:string,baseRevision:string):Promise<string>;
  bindTask(sessionId:string,planTaskId:string,runtimeTaskId:string,role:AgentRole):void|Promise<void>;
  confirmTaskCompletion(runtimeTaskId:string,observation?:TrustedCompletionObservation):Promise<void>;
  closeSession(sessionId:string):void|Promise<void>;
  /** Crash recovery; marks an absent or active Gateway session terminal. */
  retireSession?(sessionId:string):void|Promise<void>;
  /** Optional for legacy tests; REQUIRED for admitted GitHub handoffs. */
  operationalLeaseConfigured?():boolean;
  renewLease?(sessionId:string,expectedDigest:string):void|Promise<void>;
}

type Phase="idle"|"planning"|"activating"|"execution"|"closed"|"failed_closed";

export class TrustedExecutionCoordinator {
  readonly #authority:TrustedEngineerAuthoritySession;
  readonly #gateway:TrustedApprovedPlanControl;
  readonly #credentials:{revokeRoot(id:string):Promise<void>};
  readonly #sessionId:string;
  readonly #baseRevision:string;
  readonly #recovery?:TrustedOperationalRecoveryStore;
  #phase:Phase="idle";
  #planningRoot?:{
    readonly credential_id:string;
    readonly permissions:readonly DelegatedPermission[];
  };
  #operationalId?:string;
  #operationalPermissions?:readonly DelegatedPermission[];
  #approvedDigest?:string;
  /** One terminal shutdown for all callers; retain failures for reconciliation. */
  #shutdown?:Promise<void>;

  constructor(config:{
    authority:TrustedEngineerAuthoritySession;
    approvedGatewayPlans:TrustedApprovedPlanControl;
    credentials:{revokeRoot(id:string):Promise<void>};
    sessionId:string;
    baseRevision:string;
    operationalRecovery?:TrustedOperationalRecoveryStore;
  }){

    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(config.sessionId)||
       !/^[a-f0-9]{40}$/u.test(config.baseRevision)) {
      throw new Error("Trusted coordinator requires one pinned Planning session and Git SHA");
    }
    this.#sessionId=config.sessionId;
    this.#baseRevision=config.baseRevision;
    this.#authority=config.authority;
    this.#gateway=config.approvedGatewayPlans;
    this.#credentials=config.credentials;
    if(config.operationalRecovery!==undefined&&
       !(config.operationalRecovery instanceof TrustedOperationalRecoveryStore))
      throw Error("Invalid trusted operational recovery journal");
    this.#recovery=config.operationalRecovery;
  }

  get phase():Phase{return this.#phase;}

  /** The admitted GitHub path MUST have a crash fence independent of host
   * polling; otherwise it cannot claim to remain safe after Engineer exit. */
  assertOperationalLeaseConfigured():void{
    if(this.#gateway.operationalLeaseConfigured?.()!==true||
       typeof this.#gateway.renewLease!=="function")
      throw new Error("Trusted Coordinator requires Gateway-side operational lease");
  }

  /** Only a trusted in-process host may call this after validating live
   * GitHub run identity. No A2A, MCP or public HTTP method delegates it. */
  async renewExecutionLease():Promise<void>{
    this.assertOperationalLeaseConfigured();
    if(this.#phase!=="execution"||!this.#approvedDigest||
       !this.#operationalId)
      throw new Error("Trusted Coordinator cannot renew lease outside execution");
    await this.#gateway.renewLease!(this.#sessionId,this.#approvedDigest);
  }

  assertOperationalRecoveryStore(store:TrustedOperationalRecoveryStore):void{
    this.assertOperationalRecoveryConfigured();
    if(this.#recovery!==store)
      throw Error("Trusted Coordinator recovery journal differs from verified Engineer host");
  }

  assertOperationalRecoveryConfigured():void{
    if(!(this.#recovery instanceof TrustedOperationalRecoveryStore)||
       typeof this.#gateway.retireSession!=="function")
      throw Error("Trusted Coordinator requires durable operational recovery and Gateway retirement");
  }

  /** Authority facts from the actual, verified operational root issuance.
   * This is a trusted runtime interface, never an ADK or public HTTP API. */
  trustedOperationalAuthority():{
    credential_id:string;
    plan_digest:string;
    permissions:DelegatedPermission[];
  }{
    if(this.#phase!=="execution"||!this.#operationalId||
       !this.#approvedDigest||!this.#operationalPermissions){
      throw new Error("Verified operational root is not active");
    }
    return {
      credential_id:this.#operationalId,
      plan_digest:this.#approvedDigest,
      permissions:this.#operationalPermissions.map(x=>({...x}))
    };
  }

  /** Private trusted-only view: never pass this object to an LLM or A2A. */
  trustedPlanningAuthority():{
    credential_id:string;
    session_id:string;
    base_revision:string;
    permissions:DelegatedPermission[];
  }{
    if(this.#phase!=="planning"||!this.#planningRoot)
      throw new Error("Active verified Planning root is required");
    return {
      credential_id:this.#planningRoot.credential_id,
      session_id:this.#sessionId,
      base_revision:this.#baseRevision,
      permissions:this.#planningRoot.permissions.map(p=>({...p}))
    };
  }

  async beginPlanning(root:RootParameters){
    if(this.#phase!=="idle")throw new Error("Trusted Planning is not idle");
    // Reserve the one-use Planning transition synchronously, BEFORE the
    // recovery journal filesystem await. Otherwise concurrent callers
    // could both observe "idle" and race into preliminary root issuance.
    // Keep failed_closed on any recovery or issuance uncertainty.
    this.#phase="failed_closed";
    if(this.#recovery){
      this.assertOperationalRecoveryConfigured();
      await this.#recovery.assertClean();
    }
    const result=await this.#authority.startPlanning(root);
    if(result.phase!=="planning")throw new Error("Read-only authority not confirmed");
    this.#planningRoot={credential_id:result.credential_id,
      permissions:result.permissions.map(p=>Object.freeze({...p}))};
    this.#phase="planning";
    return result;
  }

  /**
   * By the time this returns:
   * - the independent operational DC exists, and the old root was revoked;
   * - the same authenticated signed receipt has been checked again by the
   *   Gateway registry against the immutable session and Git SHA.
   *
   * On Gateway activation failure, revoke the new root and fail closed.
   */
  async beginExecution(root:RootParameters):Promise<{
    credential_id:string;plan_digest:string;
  }>{
    if(this.#phase!=="planning")throw new Error("Trusted execution requires prior Planning");
    // Reserve synchronously BEFORE any journal filesystem await: two
    // concurrent activation calls cannot race into issuing separate roots.
    this.#phase="activating";
    this.#planningRoot=undefined; // never reuse provisional authority in Execution
    if(this.#recovery){
      try{
        this.assertOperationalRecoveryConfigured();
        // Persist the chosen future ID before ANY external issuing request.
        await this.#recovery.recordIntent({
          sessionId:this.#sessionId,baseRevision:this.#baseRevision,
          credentialId:root.credential_id
        });
      }catch(error){
        this.#phase="failed_closed";
        throw error;
      }
    }
    let operationalId:string|undefined;
    try {
      const issued=await this.#authority.approveAndIssueOperationalRoot(root);
      operationalId=issued.credential_id;
      const gatewayDigest=await this.#gateway.activate(
        this.#sessionId,this.#baseRevision
      );
      if(gatewayDigest!==issued.plan_digest){
        throw new Error("Gateway approved digest differs from operational authority");
      }
      this.#operationalId=issued.credential_id;
      this.#operationalPermissions=issued.permissions.map(x=>Object.freeze({...x}));
      this.#approvedDigest=issued.plan_digest;
      this.#phase="execution";
      return {credential_id:issued.credential_id,plan_digest:gatewayDigest};
    }catch(error){
      this.#phase="failed_closed";
      if(this.#recovery){
        let tombstone=false,revoked=false;
        try{await this.#gateway.retireSession!(this.#sessionId);
          tombstone=true;}catch{}
        // Even a failed/ambiguous issue may have created an orphan in Rust.
        try{await this.#credentials.revokeRoot(root.credential_id);
          revoked=true;}catch{}
        if(!tombstone||!revoked)
          throw Error("Operational root uncertain; persistent reconciliation required",
            {cause:error});
        await this.#recovery.markReconciled({
          sessionId:this.#sessionId,baseRevision:this.#baseRevision,
          credentialId:root.credential_id
        });
        throw error;
      }
      // When an operational credential exists but the plan was not installed,
      // revoke its status entry rather than leave a usable orphaned root.
      if(operationalId){
        try{await this.#gateway.closeSession(this.#sessionId);}catch{/** not activated */}
        try{
          await this.#credentials.revokeRoot(operationalId);
        }catch{
          // Uncertain revocation: operator reconciliation is required;
          // never resume or silently issue another root in this session.
          throw new Error("Operational DC revocation not confirmed after failed plan activation");
        }
      }
      throw error;
    }
  }

  /** Called by a trusted A2A dispatch observer, not from agent claims. */
  bindDispatchedTask(planTaskId:string,runtimeTaskId:string,role:AgentRole):void|Promise<void> {
    if(this.#phase!=="execution")throw new Error("Execution not active");
    return this.#gateway.bindTask(this.#sessionId,planTaskId,runtimeTaskId,role);
  }

  /** The Gateway separately checks provider evidence and task attestation. */
  async confirmTask(runtimeTaskId:string,observation?:TrustedCompletionObservation):Promise<void>{
    if(this.#phase!=="execution")throw new Error("Execution not active");
    await this.#gateway.confirmTaskCompletion(runtimeTaskId,observation);
  }

  /**
   * Only the trusted caller holding a validated ProtectedA2AClient result
   * invokes this; the Gateway must corroborate its reported commit/Runner
   * status before DAG dependencies can advance.
   */
  async confirmObservedA2AResult(result:DelegatedA2ARoleTaskResult):Promise<void>{
    await this.confirmTask(result.task_id,observedA2ACompletion(result));
  }

  /** Orchestrator Tasks are corroborated using real Gateway provider I/O. */
  async confirmObservedOrchestratorTask(runtimeTaskId:string):Promise<void>{
    await this.confirmTask(
      runtimeTaskId,observedOrchestratorProviderCompletion(runtimeTaskId));
  }

  /**
   * This ends new Gateway effects. Ending/revoking the operational root
   * remains a separate necessary action and is always attempted.
   */
  closeExecution():Promise<void>{
    // Engineer shutdown, A2A rejection and Gateway completion can all
    // request closure simultaneously. Every caller MUST await the same
    // final Gateway + Rust revocation outcome; a premature "closed" phase
    // alone is not evidence of completed revocation.
    if(this.#shutdown)return this.#shutdown;
    if(this.#phase!=="execution"||!this.#operationalId)
      return Promise.reject(Error("No operational session available to close"));
    const operationalId=this.#operationalId;
    this.#phase="closed"; // reject new tool calls before any async teardown
    this.#operationalPermissions=undefined;
    this.#approvedDigest=undefined;
    this.#shutdown=Promise.resolve().then(async()=>{
      let gatewayClosed=false;
      try {
        await this.#gateway.closeSession(this.#sessionId);
        gatewayClosed=true;
      } finally {
        // Even when Gateway closure fails, ALWAYS attempt native revocation.
        await this.#credentials.revokeRoot(operationalId);
      }
      if(!gatewayClosed)
        throw Error("Gateway plan shutdown is not confirmed");
      if(this.#recovery)await this.#recovery.markReconciled({
        sessionId:this.#sessionId,baseRevision:this.#baseRevision,
        credentialId:operationalId
      });
    });
    // Never discard a rejected promise or retry under the same root;
    // durable reconciliation remains mandatory on any failure.
    return this.#shutdown;
  }
}
