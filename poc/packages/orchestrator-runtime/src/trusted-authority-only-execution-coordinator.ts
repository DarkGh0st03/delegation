/**
 * R286 — authority-only operational Coordinator, opt-in admission preflight.
 *
 * An authenticated Engineer signs authority; only the trusted Coordinator
 * chooses Task/agent/epoch within that ceiling. Neither a Task proposal nor
 * this returned registration receipt is Gateway authorization or a Child DC.
 *
 * No model-facing key, DID, URL, root credential, permission elevation, or
 * A2A registration endpoint is exposed by this component.
 */
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TOOL_NAMES} from "../../../apps/gateway/src/types.ts";
import {assertVerifiedAuthorityOnlyGrant}
 from "../../plan-contracts/src/authority-only-approval.mjs";
import {TrustedAuthorityOnlyEngineerSession}
 from "./trusted-authority-only-engineer-session.ts";
import type {TrustedAuthorityOnlyStore}
 from "./signed-authority-only-store.ts";
import type {AuthorityTaskJournal}
 from "./trusted-authority-task-journal.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DID=/^did:[a-z0-9]+:.+$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
const TOOLS=new Set<string>(TOOL_NAMES);
const MAX_TASKS=256;
const PAIR=(p:DelegatedPermission)=>JSON.stringify([p.resource,p.operation]);
function fail(reason:string):never{throw Error("Authority-only Coordinator: "+reason);}
function exact(o:unknown,fields:string[]):o is Record<string,unknown>{
 if(!o||typeof o!=="object"||Array.isArray(o)||
    Object.keys(o).length!==fields.length||
    fields.some(k=>!Object.hasOwn(o,k)))fail("invalid Task fields");
 return true;
}
export interface TrustedAgentCardPin {
 did:string;
 card_ref:string;
 /** Concrete tools that the trusted published card declares. NOT rights. */
 capabilities:readonly string[];
}
export interface AuthorityOnlyTaskProposal {
 session_id:string;
 requirement_sha256:string;
 base_revision:string;
 branch:string;
 task_id:string;
 epoch:number;
 agent_id:string;
 depends_on:readonly string[];
 permissions:readonly DelegatedPermission[];
}
export interface RegisteredAuthorityOnlyTask {
 readonly status:"task_registered_preflight_only";
 readonly session_id:string;
 readonly task_id:string;
 readonly epoch:number;
 readonly agent_id:string;
 readonly agent_did:string;
 readonly card_ref:string;
 readonly depends_on:readonly string[];
 readonly permissions:readonly DelegatedPermission[];
 readonly root_credential_id:string;
 readonly authority_digest:string;
 readonly execution_authorized:false;
 readonly child_credential_issued:false;
 readonly gateway_registered:false;
}
type Phase="inactive"|"activating"|"active"|"failed_closed";
export class TrustedAuthorityOnlyExecutionCoordinator{
 readonly #sessionId:string;
 readonly #engineer:TrustedAuthorityOnlyEngineerSession;
 readonly #approvals:TrustedAuthorityOnlyStore;
 readonly #journal:AuthorityTaskJournal;
 readonly #registry:Readonly<Record<string,TrustedAgentCardPin>>;
 readonly #nowMs:()=>number;
 #phase:Phase="inactive";
 #authority?:Readonly<{
  authorization:any;authority_digest:string;expires_at:string;
  authenticated_engineer_did:string
 }>;
 #rootCredentialId?:string;
 #rootExpiry?:string;
 #epoch=0;
 readonly #taskIds=new Set<string>();
 readonly #registered=new Map<string,RegisteredAuthorityOnlyTask>();
 #bindingInFlight=false;

 constructor(opts:{
  sessionId:string;
  engineer:TrustedAuthorityOnlyEngineerSession;
  approvals:TrustedAuthorityOnlyStore;
  journal:AuthorityTaskJournal;
  trustedAgentRegistry:Record<string,TrustedAgentCardPin>;
  nowMs?:()=>number;
 }){
  if(!opts||typeof opts.sessionId!=="string"||!ID.test(opts.sessionId)||
     !(opts.engineer instanceof TrustedAuthorityOnlyEngineerSession)||
     !opts.approvals?.loadAuthenticatedAuthority||
     !opts.journal?.reserveActivation||!opts.journal?.reserveTask||
     !opts.trustedAgentRegistry||
     typeof opts.trustedAgentRegistry!=="object"||
     Array.isArray(opts.trustedAgentRegistry)||
     Object.keys(opts.trustedAgentRegistry).length===0)
   fail("trusted Coordinator dependencies missing");
  const pins:Record<string,TrustedAgentCardPin>={};
  for(const [id,p] of Object.entries(opts.trustedAgentRegistry)){
   if(!ID.test(id)||!p||typeof p.did!=="string"||!DID.test(p.did)||
      typeof p.card_ref!=="string"||!p.card_ref.startsWith("trusted:")||
      p.card_ref.length>256||!Array.isArray(p.capabilities)||
      p.capabilities.length===0||p.capabilities.length>TOOLS.size||
      p.capabilities.some(x=>typeof x!=="string"||!TOOLS.has(x))||
      new Set(p.capabilities).size!==p.capabilities.length)
    fail("untrusted agent card binding");
   pins[id]=Object.freeze({did:p.did,card_ref:p.card_ref,
     capabilities:Object.freeze([...p.capabilities])});
  }
  this.#sessionId=opts.sessionId;
  this.#engineer=opts.engineer;
  this.#approvals=opts.approvals;
  this.#journal=opts.journal;
  this.#registry=Object.freeze(pins);
  this.#nowMs=opts.nowMs??Date.now;
 }
 get phase():Phase{return this.#phase;}
 get registeredTaskCount():number{return this.#taskIds.size;}
 #assertCurrentRoot(){
  if(this.#phase!=="active"||!this.#authority||
     !this.#rootCredentialId||!this.#rootExpiry)
    fail("operational authority not activated");
  const root=this.#engineer.assertLiveOperationalRoot();
  const now=this.#nowMs();
  if(now>=Date.parse(this.#rootExpiry)||
     now>=Date.parse(this.#authority.expires_at)||
     root.session_id!==this.#sessionId||
     root.credential_id!==this.#rootCredentialId||
     root.authority_digest!==this.#authority.authority_digest||
     root.root_expires_at!==this.#rootExpiry)
    fail("operational authority expired or changed");
  return root;
 }
 async activate():Promise<Readonly<{
  status:"authority_session_activated_preflight_only";
  authority_digest:string;root_credential_id:string;
  execution_authorized:false
 }>>{
  if(this.#phase!=="inactive")fail("Coordinator activation already attempted");
  this.#phase="activating";
  try{
   const root=this.#engineer.assertLiveOperationalRoot();
   const loaded=await this.#approvals.loadAuthenticatedAuthority(this.#sessionId);
   const verified=assertVerifiedAuthorityOnlyGrant(loaded,{
     allowedOperations:OPERATIONS,nowMs:this.#nowMs()
   });
   const grant=verified.authorization;
   if(this.#nowMs()>=Date.parse(root.root_expires_at)||
      this.#nowMs()>=Date.parse(verified.expires_at))
    fail("operational root or signed authority expired");
   if(root.session_id!==this.#sessionId||
      grant.session_id!==this.#sessionId||
      root.authority_digest!==verified.authority_digest||
      root.engineer_did!==verified.authenticated_engineer_did||
      !ID.test(root.credential_id)||
      !SHA40.test(grant.base_revision)||
      !SHA64.test(grant.requirement_sha256)||
      !isDeepStrictEqual(root.permissions,grant.permissions)||
      Date.parse(root.root_expires_at)>Date.parse(verified.expires_at))
    fail("operational root does not match signed Engineer authority");
   await this.#journal.reserveActivation(this.#sessionId,
     root.credential_id,verified.authority_digest);
   // Ambiguous expiry AFTER a durable reservation is terminal, not replayable.
   if(this.#nowMs()>=Date.parse(root.root_expires_at)||
      this.#nowMs()>=Date.parse(verified.expires_at))
    fail("root or authority expired during activation");
   this.#authority=verified;
   this.#rootCredentialId=root.credential_id;
   this.#rootExpiry=root.root_expires_at;
   this.#phase="active";
   return Object.freeze({
    status:"authority_session_activated_preflight_only",
    authority_digest:verified.authority_digest,
    root_credential_id:root.credential_id,
    execution_authorized:false
   });
  }catch(error){
   this.#phase="failed_closed";
   throw error;
  }
 }
 /**
  * Host-private projection for an opt-in Gateway authority admission gate.
  * Never an HTTP/MCP/A2A handler. The Gateway MUST still independently
  * verify the signed receipt, root status/VP, OPA and provider effects.
  */
 assertTrustedGatewayAuthorityBinding(){
  const root=this.#assertCurrentRoot();
  const grant=this.#authority!.authorization;
  return Object.freeze({
   session_id:this.#sessionId,
   repository:structuredClone(grant.repository),
   branch:grant.branch,
   base_revision:grant.base_revision,
   requirement_sha256:grant.requirement_sha256,
   authority_digest:this.#authority!.authority_digest,
   engineer_did:this.#authority!.authenticated_engineer_did,
   expires_at:this.#authority!.expires_at,
   root_credential_id:root.credential_id,
   root_expires_at:root.root_expires_at,
   root_permissions:structuredClone(root.permissions)
  });
 }
 /** The Gateway obtains Task grants from THIS admitted Coordinator state,
  * never from an A2A/LLM-supplied serialized registration receipt. */
 assertTrustedGatewayRegisteredTask(taskId:string):RegisteredAuthorityOnlyTask{
  this.#assertCurrentRoot();
  if(typeof taskId!=="string"||!ID.test(taskId))
   fail("invalid trusted Task lookup");
  const row=this.#registered.get(taskId);
  if(!row||!this.#taskIds.has(taskId))
   fail("Task not admitted in trusted Coordinator");
  return structuredClone(row);
 }
 /**
  * Host-only registration of an epoch-specific Task. A trusted registry
  * supplies DID and card_ref: the model supplies neither. Dependencies must
  * name earlier registered Tasks (not model-claimed completed Tasks).
  *
  * This registration still cannot call the Gateway or issue child rights.
  */
 async registerTask(raw:AuthorityOnlyTaskProposal):Promise<RegisteredAuthorityOnlyTask>{
  const root=this.#assertCurrentRoot();
  if(this.#bindingInFlight)fail("concurrent Task registration denied");
  exact(raw,["session_id","requirement_sha256","base_revision","branch",
    "task_id","epoch","agent_id","depends_on","permissions"]);
  const grant=this.#authority!.authorization;
  if(raw.session_id!==this.#sessionId||
     raw.requirement_sha256!==grant.requirement_sha256||
     raw.base_revision!==grant.base_revision||
     raw.branch!==grant.branch)
    fail("Task outside signed session, objective, revision or branch");
  if(!Number.isSafeInteger(raw.epoch)||raw.epoch!==this.#epoch+1||
     raw.epoch<1||raw.epoch>MAX_TASKS||
     typeof raw.task_id!=="string"||!ID.test(raw.task_id)||
     raw.task_id.includes("..")||this.#taskIds.has(raw.task_id))
    fail("invalid epoch or replayed Task ID");
  if(typeof raw.agent_id!=="string"||!ID.test(raw.agent_id)||
     !Object.hasOwn(this.#registry,raw.agent_id))
    fail("unregistered agent");
  const pinned=this.#registry[raw.agent_id]!;
  if(!Array.isArray(raw.depends_on)||
     raw.depends_on.length>MAX_TASKS||
     new Set(raw.depends_on).size!==raw.depends_on.length||
     raw.depends_on.some(id=>typeof id!=="string"||
      !this.#taskIds.has(id)||id===raw.task_id))
    fail("unverified dependency or dependency replay");
  if(!Array.isArray(raw.permissions)||raw.permissions.length<1||
     raw.permissions.length>128)
    fail("invalid Task permission count");
  const approved=new Set(grant.permissions.map(PAIR));
  const issued=new Set(root.permissions.map(PAIR));
  const seen=new Set<string>();
  for(const p of raw.permissions){
   exact(p,["resource","operation"]);
   if(typeof p.resource!=="string"||
      typeof p.operation!=="string"||!OPERATIONS.has(p.operation)||
      !TOOLS.has(p.operation))
    fail("unknown Task operation or resource");
   const key=PAIR(p);
   if(seen.has(key)||!approved.has(key)||!issued.has(key))
    fail("Task attempts authority escalation or duplicate pair");
   if(!pinned.capabilities.includes(p.operation))
    fail("agent does not advertise requested capability");
   seen.add(key);
  }
  const receipt:RegisteredAuthorityOnlyTask=Object.freeze({
   status:"task_registered_preflight_only",
   session_id:this.#sessionId,task_id:raw.task_id,epoch:raw.epoch,
   agent_id:raw.agent_id,agent_did:pinned.did,card_ref:pinned.card_ref,
   depends_on:Object.freeze([...raw.depends_on]),
   permissions:Object.freeze(structuredClone(raw.permissions)),
   root_credential_id:root.credential_id,
   authority_digest:this.#authority!.authority_digest,
   execution_authorized:false,child_credential_issued:false,
   gateway_registered:false
  });
  // Reserve before reporting a Task admission; never retry an ambiguous write.
  this.#bindingInFlight=true;
  try{
   const digest=createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
   await this.#journal.reserveTask(this.#sessionId,raw.epoch,raw.task_id,digest);
   this.#assertCurrentRoot();
   this.#epoch=raw.epoch;
   this.#taskIds.add(raw.task_id);
   this.#registered.set(raw.task_id,structuredClone(receipt));
   return receipt;
  }catch(error){
   this.#phase="failed_closed";
   throw error;
  }finally{this.#bindingInFlight=false;}
 }
}
