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
    return {role,credential};
  }
}
