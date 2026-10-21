/**
 * Single-process trusted handoff:
 * Planning read-only DC -> signed Engineer approval -> confirmed DC revocation
 * -> independent operational root -> trusted Gateway plan activation.
 *
 * The legacy Account Suspension coordinator is deliberately untouched.
 * This coordinator is NOT exposed to Gemini, MCP or public Gateway HTTP.
 */
import type {AgentRole} from "../../../apps/gateway/src/types.ts";
import type {
  RootParameters,TrustedEngineerAuthoritySession
} from "./trusted-engineer-authority.ts";
import type {TrustedApprovedExecutionPlans} from "../../../apps/gateway/src/approved-execution-plans.ts";

type Phase="idle"|"planning"|"activating"|"execution"|"closed"|"failed_closed";

export class TrustedExecutionCoordinator {
  readonly #authority:TrustedEngineerAuthoritySession;
  readonly #gateway:TrustedApprovedExecutionPlans;
  readonly #credentials:{revokeRoot(id:string):Promise<void>};
  readonly #sessionId:string;
  readonly #baseRevision:string;
  #phase:Phase="idle";
  #operationalId?:string;

  constructor(config:{
    authority:TrustedEngineerAuthoritySession;
    approvedGatewayPlans:TrustedApprovedExecutionPlans;
    credentials:{revokeRoot(id:string):Promise<void>};
    sessionId:string;
    baseRevision:string;
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
  }

  get phase():Phase{return this.#phase;}

  async beginPlanning(root:RootParameters){
    if(this.#phase!=="idle")throw new Error("Trusted Planning is not idle");
    this.#phase="failed_closed";
    const result=await this.#authority.startPlanning(root);
    if(result.phase!=="planning")throw new Error("Read-only authority not confirmed");
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
    this.#phase="activating";
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
      this.#phase="execution";
      return {credential_id:issued.credential_id,plan_digest:gatewayDigest};
    }catch(error){
      this.#phase="failed_closed";
      // When an operational credential exists but the plan was not installed,
      // revoke its status entry rather than leave a usable orphaned root.
      if(operationalId){
        try{this.#gateway.closeSession(this.#sessionId);}catch{/** not activated */}
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
  bindDispatchedTask(planTaskId:string,runtimeTaskId:string,role:AgentRole):void {
    if(this.#phase!=="execution")throw new Error("Execution not active");
    this.#gateway.bindTask(this.#sessionId,planTaskId,runtimeTaskId,role);
  }

  /** The Gateway separately checks provider evidence and task attestation. */
  async confirmTask(runtimeTaskId:string):Promise<void>{
    if(this.#phase!=="execution")throw new Error("Execution not active");
    await this.#gateway.confirmTaskCompletion(runtimeTaskId);
  }

  /**
   * This ends new Gateway effects. Ending/revoking the operational root
   * remains a separate necessary action and is always attempted.
   */
  async closeExecution():Promise<void>{
    if(this.#phase!=="execution"||!this.#operationalId){
      throw new Error("No operational session available to close");
    }
    this.#phase="closed";
    let gatewayClosed=false;
    try {
      this.#gateway.closeSession(this.#sessionId);
      gatewayClosed=true;
    } finally {
      // An error in plan-session shutdown must NEVER skip revocation of
      // the independently issued root credential.
      await this.#credentials.revokeRoot(this.#operationalId);
    }
    if(!gatewayClosed)throw new Error("Gateway plan shutdown is not confirmed");
  }
}
