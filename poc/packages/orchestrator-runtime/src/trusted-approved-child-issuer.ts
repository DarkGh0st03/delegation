/**
 * Trusted, task-scoped delegation issuer for opt-in approved DAG execution.
 *
 * The only permission source is the authenticated Engineer-signed approval.
 * Each child is a strict, nonempty subset of the *actually issued*
 * operational parent root, not a static role template or caller payload.
 *
 * Rust independently enforces parent-child attenuation and status validity.
 * The legacy DeterministicOrchestratorAuthorityIssuer is unchanged.
 */
import {assertApprovedPlanScope,planDigest} from
  "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedChildIssuanceJournal} from "./trusted-child-issuance-journal.mjs";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import {TrustedApprovedExecutionPlans} from "../../../apps/gateway/src/approved-execution-plans.ts";
import {prepareTrustedRepairFeedback,preflightTrustedRemoteRepairDiscovery} from "./trusted-validation-repair-feedback.ts";
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {SpecializedAgentRole} from "@thesis/agent-runtime";
import type {AuthenticatedPlanStore} from
  "../../../apps/gateway/src/approved-execution-plans.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import type {ChildIssuanceInput,IssuedDelegationCredential} from "./authority-client.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

type FetchLike=typeof fetch;
type ScopedInput=ChildIssuanceInput;
type Role=SpecializedAgentRole;
const ROLES=new Set(["backend","frontend","test"]);
const OPS=new Set<string>(RUST_OPERATIONS);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_PERMISSIONS=128;
const KEY=(x:DelegatedPermission)=>JSON.stringify([x.operation,x.resource]);
function reject(message:string):never{throw new Error("Trusted child DC: "+message);}
function exactRole(value:unknown):Role{
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).length!==1||
    typeof (value as {role?:unknown}).role!=="string"||
    !ROLES.has((value as {role:string}).role)){
    reject("only the approved specialized role may be selected");
  }
  return (value as {role:Role}).role;
}
function allUnique(rows:readonly DelegatedPermission[],label:string):Set<string>{
  if(!Array.isArray(rows)||rows.length>MAX_PERMISSIONS)reject(label+" exceeds permission limit");
  const keys=new Set<string>();
  for(const p of rows){
    if(!p||typeof p.operation!=="string"||!OPS.has(p.operation)||
       typeof p.resource!=="string"||!p.resource.startsWith("gitea://")){
      reject(label+" contains a noncanonical or unknown permission");
    }
    const key=KEY(p);
    if(keys.has(key))reject(label+" contains duplicate permission");
    keys.add(key);
  }
  return keys;
}
function exactCredentialPermissions(
  credential:IssuedDelegationCredential,expected:readonly DelegatedPermission[]
):boolean{
  const actual=credential.credentialSubject?.per;
  return Array.isArray(actual)&&actual.length===expected.length&&
    actual.every((x,i)=>x?.operation===expected[i]!.operation&&
      x?.resource===expected[i]!.resource);
}
export interface ApprovedChildIssuerConfig{
  approvals:AuthenticatedPlanStore;
  coordinator:Pick<TrustedExecutionCoordinator,"trustedOperationalAuthority"|"phase">;
  sessionId:string;
  engineerDid:string;
  /** Only this trusted service holds the Orchestrator's Adapter bearer. */
  adapterBaseUrl:string;
  bearerToken:string;
  fetchFn?:FetchLike;
  timeoutMs?:number;
  /** Optional in legacy tests; trusted R5 host provisions a durable journal. */
  issuanceJournal?:TrustedChildIssuanceJournal;
}
export class TrustedApprovedPlanChildAuthorityIssuer {
  readonly #sessionId:string;
  readonly #engineerDid:string;
  readonly #coordinator:ApprovedChildIssuerConfig["coordinator"];
  readonly #adapterBaseUrl:string;
  readonly #bearerToken:string;
  readonly #fetch:FetchLike;
  readonly #timeoutMs:number;
  readonly #rootId:string;
  readonly #digest:string;
  readonly #journal?:TrustedChildIssuanceJournal;
  readonly #approved=new Map<string,{role:Role;permissions:DelegatedPermission[]}>();
  readonly #attempted=new Set<string>();
  #remoteDiscoveryFence? : ()=>Promise<void>;

  private constructor(c:Omit<ApprovedChildIssuerConfig,"approvals">,
    root:{credential_id:string;plan_digest:string;permissions:DelegatedPermission[]},
    tasks:Map<string,{role:Role;permissions:DelegatedPermission[]}>){
    this.#sessionId=c.sessionId;
    this.#engineerDid=c.engineerDid;
    this.#coordinator=c.coordinator;
    this.#adapterBaseUrl=c.adapterBaseUrl.replace(/\/+$/u,"");
    this.#bearerToken=c.bearerToken;
    this.#fetch=c.fetchFn??fetch;
    this.#timeoutMs=c.timeoutMs??5000;
    this.#rootId=root.credential_id;
    this.#digest=root.plan_digest;
    this.#journal=c.issuanceJournal;
    this.#approved=tasks;
  }

  static async create(config:ApprovedChildIssuerConfig){
    if(config.coordinator.phase!=="execution"||
       !ID.test(config.sessionId)||!config.engineerDid.startsWith("did:")||
       !config.adapterBaseUrl||!config.bearerToken||
       !Number.isFinite(config.timeoutMs??5000)||
       (config.timeoutMs??5000)<=0){
      reject("missing active trusted Coordinator, approval context or private Adapter");
    }
    const root=config.coordinator.trustedOperationalAuthority();
    if(!ID.test(root.credential_id)||!/^[a-f0-9]{64}$/u.test(root.plan_digest)){
      reject("operational root identity or digest not verified");
    }
    const parentKeys=allUnique(root.permissions,"operational root");
    if(parentKeys.size===0)reject("operational parent grants no permissions");
    const signed=await config.approvals.loadAuthenticatedApproval(config.sessionId);
    if(signed.authenticated_engineer_did!==config.engineerDid)reject("Engineer identity mismatch");
    const plan=signed.plan as any;
    const rows=assertApprovedPlanScope(plan,signed.approval,{
      allowedOperations:OPS,expectedEngineerDid:config.engineerDid
    }) as {task_id:string;agent_id:string;operation:string;resource:string}[];
    if(plan.session_id!==config.sessionId||planDigest(plan)!==root.plan_digest){
      reject("signed plan does not match active operational root");
    }
    if(config.issuanceJournal!==undefined){
      if(!(config.issuanceJournal instanceof TrustedChildIssuanceJournal))
        reject("real protected child issuance journal required");
      config.issuanceJournal.assertBound({
        sessionId:config.sessionId,baseRevision:plan.base_revision,
        planDigest:root.plan_digest,parentCredentialId:root.credential_id
      });
    }
    const mapping=new Map<string,{role:Role;permissions:DelegatedPermission[]}>();
    for(const row of rows){
      if(!ROLES.has(row.agent_id))continue;
      const permission={resource:row.resource,operation:row.operation} as DelegatedPermission;
      if(!parentKeys.has(KEY(permission))){
        reject("approved Task permission is outside the operational root");
      }
      const task=mapping.get(row.task_id);
      if(task&&task.role!==row.agent_id)reject("Task approved for multiple agent roles");
      if(!task)mapping.set(row.task_id,{
        role:row.agent_id as Role,permissions:[permission]
      });
      else task.permissions.push(permission);
    }
    for(const task of mapping.values()){
      const keys=allUnique(task.permissions,"Task child");
      if(keys.size===0)reject("Task has no approved child permissions");
    }
    return new TrustedApprovedPlanChildAuthorityIssuer(
      config,root,mapping
    );
  }

  /**
   * Opt-in R102.1: derive Task-specific child scope from the newest durable
   * operational epoch under the SAME Engineer-authorized Rust root.
   * This does not install Gateway Task authorization or dispatch A2A.
   */
  static async createForOperationalEpoch(config:
    Omit<ApprovedChildIssuerConfig,"approvals"> & {
      intake:TrustedOperationalEpochIntake;epochVersion:number
    }):Promise<TrustedApprovedPlanChildAuthorityIssuer>{
    if(!(config.intake instanceof TrustedOperationalEpochIntake)||
       !(config.issuanceJournal instanceof TrustedChildIssuanceJournal)||
       !Number.isSafeInteger(config.epochVersion)||config.epochVersion<2||
       config.coordinator.phase!=="execution"||
       !ID.test(config.sessionId)||!config.engineerDid.startsWith("did:")||
       !config.adapterBaseUrl||!config.bearerToken)
      reject("trusted current epoch and durable child-issuance journal required");
    config.intake.assertSameCoordinator(config.coordinator);
    const root=config.coordinator.trustedOperationalAuthority();
    const issued=allUnique(root.permissions,"issued operational root");
    if(!issued.size)reject("empty issued root");
    const history=await config.intake.verifiedEpochHistory();
    const current=history.at(-1);
    if(!current||current.epoch!==config.epochVersion||
       current.root_credential_id!==root.credential_id||
       history[0].plan_digest!==root.plan_digest||
       current.plan.session_id!==config.sessionId)
      reject("stale, missing or foreign operational epoch");
    config.issuanceJournal.assertBound({
      sessionId:config.sessionId,baseRevision:current.plan.base_revision,
      planDigest:root.plan_digest,parentCredentialId:root.credential_id
    });
    const tasks=new Map<string,{role:Role;permissions:DelegatedPermission[]}>();
    for(const row of current.plan.requested_permissions){
      if(!ROLES.has(row.agent_id))continue;
      const permission={resource:row.resource,operation:row.operation} as DelegatedPermission;
      if(!issued.has(KEY(permission)))reject("epoch permission exceeds issued root");
      const entry=tasks.get(row.task_id);
      if(entry&&entry.role!==row.agent_id)reject("epoch Task has conflicting role");
      if(entry)entry.permissions.push(permission);
      else tasks.set(row.task_id,{role:row.agent_id as Role,permissions:[permission]});
    }
    if(!tasks.size)reject("no specialized Tasks in current epoch");
    for(const entry of tasks.values())
      if(!allUnique(entry.permissions,"epoch Task").size)reject("Task without permission");
    if(config.coordinator.phase!=="execution")reject("root revoked during epoch verification");
    const active=config.coordinator.trustedOperationalAuthority();
    const activePairs=allUnique(active.permissions,"active operational root");
    if(active.credential_id!==root.credential_id||
       active.plan_digest!==root.plan_digest||
       activePairs.size!==issued.size||
       [...activePairs].some(x=>!issued.has(x)))
      reject("operational root changed during epoch verification");
    return new TrustedApprovedPlanChildAuthorityIssuer(config,root,tasks);
  }

  /**
   * R109: issue a fresh READ-ONLY discovery child via the SAME Rust Adapter
   * /v1/credentials/child endpoint, even though the Task ID does not occur
   * in the original DAG. The old Engineer approval still fixes the root's
   * exact maximum grants; the Gateway supplies corroborated failed Runner
   * evidence. No extra Engineer signature or parallel authorization token.
   */
  static async createForRepairDiscovery(config:
    Omit<ApprovedChildIssuerConfig,"approvals"> & {
      intake:TrustedOperationalEpochIntake;
      gateway:TrustedApprovedExecutionPlans;
      failedRuntimeTestTaskId:string;
      discoveryTaskId:string;
      role:Role;
      resource:string;
    }):Promise<TrustedApprovedPlanChildAuthorityIssuer>{
    if(!(config.intake instanceof TrustedOperationalEpochIntake)||
       !(config.gateway instanceof TrustedApprovedExecutionPlans)||
       !config.gateway.isBoundToOperationalEpochIntake(config.intake)||
       !(config.issuanceJournal instanceof TrustedChildIssuanceJournal)||
       !ID.test(config.sessionId)||!ID.test(config.discoveryTaskId)||
       !ROLES.has(config.role)||
       !config.engineerDid.startsWith("did:")||
       !config.adapterBaseUrl||!config.bearerToken||
       config.coordinator.phase!=="execution")
      reject("trusted parent, Gateway failed Test and issuance journal required");
    config.intake.assertSameCoordinator(config.coordinator);
    const feedback=await prepareTrustedRepairFeedback({
      gateway:config.gateway,intake:config.intake,
      sessionId:config.sessionId,
      runtimeTestTaskId:config.failedRuntimeTestTaskId
    });
    if(feedback.status!=="repair_planning_eligible")
      reject("no remaining repair budget for source discovery");
    const proof=await config.intake.preflightRepairDiscovery({
      sessionId:config.sessionId,taskId:config.discoveryTaskId,
      agentId:config.role,resource:config.resource
    });
    if(proof.epoch!==feedback.failed_epoch||
       proof.work_branch!==feedback.work_branch||
       proof.root_plan_digest!==feedback.root_plan_digest)
      reject("discovery and failed Runner do not share active root epoch");
    const root=config.coordinator.trustedOperationalAuthority();
    const parents=allUnique(root.permissions,"issued Rust parent");
    if(root.credential_id!==proof.root_credential_id||
       root.plan_digest!==proof.root_plan_digest||
       !parents.has(KEY({resource:config.resource,operation:"read_file"})))
      reject("discovery child exceeds actually issued Rust parent");
    const epochs=await config.intake.verifiedEpochHistory();
    config.issuanceJournal.assertBound({
      sessionId:config.sessionId,baseRevision:epochs[0].plan.base_revision,
      planDigest:root.plan_digest,parentCredentialId:root.credential_id
    });
    if(config.coordinator.phase!=="execution")
      reject("root revoked while preparing discovery");
    const active=config.coordinator.trustedOperationalAuthority();
    if(active.credential_id!==root.credential_id||
       active.plan_digest!==root.plan_digest||
       allUnique(active.permissions,"active Rust parent").size!==parents.size||
       active.permissions.some(p=>!parents.has(KEY(p))))
      reject("Rust root changed while preparing discovery");
    const tasks=new Map<string,{role:Role;permissions:DelegatedPermission[]}>([
      [config.discoveryTaskId,{
        role:config.role,
        permissions:[{resource:config.resource,operation:"read_file"}]
      }]
    ]);
    return new TrustedApprovedPlanChildAuthorityIssuer(config,root,tasks);
  }

  /**
   * R151.24: prepare an exact read-only child using the authenticated remote
   * Gateway. Issuance is separate from Task admission and source execution.
   * Recheck the pinned FAIL/root before the Adapter request and before return.
   */
  static async createForRemoteRepairDiscovery(config:
    Omit<ApprovedChildIssuerConfig,"approvals"> & {
      intake:TrustedOperationalEpochIntake;
      gateway:TrustedPlanIpcClient;
      failedRuntimeTestTaskId:string;
      discoveryTaskId:string;
      role:"backend";
      resource:string;
    }):Promise<TrustedApprovedPlanChildAuthorityIssuer>{
    const c={...config};
    if(!(c.intake instanceof TrustedOperationalEpochIntake)||
       !(c.gateway instanceof TrustedPlanIpcClient)||
       !(c.issuanceJournal instanceof TrustedChildIssuanceJournal)||
       c.role!=="backend"||!ID.test(c.sessionId)||!ID.test(c.discoveryTaskId)||
       !c.engineerDid.startsWith("did:")||!c.adapterBaseUrl||!c.bearerToken||
       !Number.isFinite(c.timeoutMs??5000)||(c.timeoutMs??5000)<=0||
       c.coordinator.phase!=="execution")
      reject("remote discovery requires trusted owner, Backend and durable journal");
    c.intake.assertSameCoordinator(c.coordinator);
    const request=Object.freeze({
      gateway:c.gateway,intake:c.intake,coordinator:c.coordinator,
      sessionId:c.sessionId,runtimeTestTaskId:c.failedRuntimeTestTaskId,
      discoveryTaskId:c.discoveryTaskId,resource:c.resource
    });
    const proof=await preflightTrustedRemoteRepairDiscovery(request);
    const root=c.coordinator.trustedOperationalAuthority();
    const parents=allUnique(root.permissions,"issued Rust parent");
    if(root.plan_digest!==proof.root_plan_digest||
       !parents.has(KEY({resource:c.resource,operation:"read_file"})))
      reject("remote discovery child exceeds issued Rust parent");
    const history=await c.intake.verifiedEpochHistory();
    if(history.length!==proof.failed_epoch||
       history.at(-1)?.root_credential_id!==root.credential_id)
      reject("remote discovery epoch changed during preparation");
    c.issuanceJournal.assertBound({
      sessionId:c.sessionId,baseRevision:history[0].plan.base_revision,
      planDigest:root.plan_digest,parentCredentialId:root.credential_id
    });
    const fence=async()=>{
      const current=await preflightTrustedRemoteRepairDiscovery(request);
      const active=c.coordinator.trustedOperationalAuthority();
      const activePairs=allUnique(active.permissions,"active Rust parent");
      if(JSON.stringify(current)!==JSON.stringify(proof)||
         active.credential_id!==root.credential_id||
         active.plan_digest!==root.plan_digest||
         activePairs.size!==parents.size||
         [...activePairs].some(p=>!parents.has(p)))
        reject("remote discovery FAIL, epoch or Rust parent changed");
    };
    await fence();
    const tasks=new Map<string,{role:Role;permissions:DelegatedPermission[]}>([
      [c.discoveryTaskId,{role:"backend",
        permissions:[{resource:c.resource,operation:"read_file"}]}]
    ]);
    const issuer=new TrustedApprovedPlanChildAuthorityIssuer(c,root,tasks);
    issuer.#remoteDiscoveryFence=fence;
    return issuer;
  }

  /**
   * Recheck the real Coordinator/root at the final protected A2A boundary.
   * An Engineer shutdown can occur while the Adapter HTTP issuance is in
   * flight. The issued child cannot justify a new Agent Task after that.
   */
  assertActiveBeforeA2ASend():void{
    if(this.#coordinator.phase!=="execution")
      reject("operational parent is no longer active");
    const current=this.#coordinator.trustedOperationalAuthority();
    if(current.credential_id!==this.#rootId||
       current.plan_digest!==this.#digest)
      reject("operational parent is no longer active");
  }

  /** R151.49.3: a private discovery issuer may be paired ONLY with the
   * SAME live Coordinator/root and the exact Backend Task/resource.
   * Prevent a valid Child issued under another original root from being
   * dispatched through this owner's otherwise-valid remote A2A handoff. */
  assertExactRemoteDiscoveryOwner(pins:Readonly<{
    coordinator:ApprovedChildIssuerConfig["coordinator"];
    sessionId:string;taskId:string;resource:string;
  }>):void{
    const task=this.#approved.get(pins.taskId);
    if(!this.#remoteDiscoveryFence||
       this.#coordinator!==pins.coordinator||
       this.#sessionId!==pins.sessionId||
       this.#approved.size!==1||!task||task.role!=="backend"||
       task.permissions.length!==1||
       task.permissions[0]?.resource!==pins.resource||
       task.permissions[0]?.operation!=="read_file")
      reject("issuer and A2A handoff are not the same native root and exact Backend read");
    this.assertActiveBeforeA2ASend();
  }

  async issueSpecializedChild(input:ScopedInput):Promise<{
    role:Role;credential:IssuedDelegationCredential;
  }>{
    this.assertActiveBeforeA2ASend();
    const role=exactRole(input.selection);
    if(typeof input.approved_task_id!=="string"||!ID.test(input.approved_task_id)){
      reject("missing immutable approved Task binding");
    }
    const task=this.#approved.get(input.approved_task_id);
    if(!task||task.role!==role){
      reject("Task/role not authorized by signed Engineer approval");
    }
    if(input.parent_credential_id!==this.#rootId||
       typeof input.credential_id!=="string"||
       !input.credential_id.trim()||
       !input.valid_from||!Number.isFinite(Date.parse(input.valid_from))||
       !Number.isSafeInteger(input.validity_seconds)||
       input.validity_seconds<1||input.validity_seconds>7200||
       input.credential_status?.type!=="BitstringStatusListEntry"||
       input.credential_status.statusPurpose!=="revocation"||
       !/^\d+$/u.test(input.credential_status.statusListIndex)||
       !input.credential_status.statusListCredential?.trim()){
      reject("child parent, validity or status entry is not trusted");
    }
    const issueKey=this.#sessionId+":"+input.approved_task_id;
    if(this.#attempted.has(issueKey))reject("Task child issuance already attempted");
    // Reserve BEFORE any external request: an uncertain HTTP response must
    // never cause a second, silently repeated credential issuance.
    this.#attempted.add(issueKey);
    const permissions=task.permissions.map(x=>({...x}));
    // Persist the exact issued-child identity BEFORE the first side-effecting
    // HTTP request. A crash, timeout or malformed reply leaves an UNCERTAIN
    // durable intent that cannot be silently retried on host restart.
    if(this.#journal){
      await this.#journal.recordIntent({
        taskId:input.approved_task_id,role,
        credentialId:input.credential_id,
        statusListCredential:input.credential_status.statusListCredential,
        statusListIndex:input.credential_status.statusListIndex
      });
      this.assertActiveBeforeA2ASend();
    }
    // A durable intent remains non-retryable if this live remote fence fails.
    await this.#remoteDiscoveryFence?.();
    this.assertActiveBeforeA2ASend();
    const response=await this.#fetch(
      this.#adapterBaseUrl+"/v1/credentials/child",{
        method:"POST",
        headers:{authorization:"Bearer "+this.#bearerToken,
          "content-type":"application/json",accept:"application/json"},
        body:JSON.stringify({
          parent_credential_id:this.#rootId,credential_id:input.credential_id,
          delegatee:role,valid_from:input.valid_from,
          validity_seconds:input.validity_seconds,
          credential_status:input.credential_status,
          permissions
        }),
        signal:AbortSignal.timeout(this.#timeoutMs)
      }
    );
    if(!response.ok){
      reject("Adapter rejected exact signed Task child issuance");
    }
    let credential:IssuedDelegationCredential;
    try{credential=await response.json() as IssuedDelegationCredential;}
    catch{reject("Adapter child issuance response is malformed");}
    if(!credential||credential.id!==input.credential_id||
       !exactCredentialPermissions(credential,permissions)){
      reject("Adapter child response differs from exact approved permissions");
    }
    // Acknowledgement records an exact verified Adapter response, not an
    // independently attested chain event or completed A2A Task.
    if(this.#journal)await this.#journal.recordVerifiedResponse({
      taskId:input.approved_task_id,credentialId:input.credential_id
    });
    // A successful HTTP response may arrive AFTER human-initiated root
    // revocation. Never hand an Agent a formerly valid child on that path.
    this.assertActiveBeforeA2ASend();
    await this.#remoteDiscoveryFence?.();
    this.assertActiveBeforeA2ASend();
    return {role,credential};
  }
}
