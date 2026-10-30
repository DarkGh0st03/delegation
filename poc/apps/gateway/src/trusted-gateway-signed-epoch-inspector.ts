/**
 * R126: read-only cross-process consistency proof for the Engineer's
 * durable operational epoch journal, verified against independent
 * Ed25519-signed Engineer approval.
 *
 * This proves an approved MAXIMUM permission envelope, NOT actual Rust
 * root issuance/revocation. NEVER use this as TrustedOperationalEpochIntake
 * or as authorization to admit tasks, issue a child or execute a provider.
 */
import {open,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {TrustedGatewayNativeRootStatusReader}
 from "./trusted-gateway-native-root-status.ts";
import {constants} from "node:fs";
import {isAbsolute,join,resolve} from "node:path";
import {SignedEngineerApprovalFileStore}
 from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedOperationalEpochJournal}
 from "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-journal.mjs";
import {assertApprovedPlanScope,planDigest}
 from "../../../packages/plan-contracts/src/plan.mjs";
import {preflightNextOperationalEpoch}
 from "../../../packages/plan-contracts/src/operational-epoch-scope.mjs";
import {RUST_OPERATIONS} from "./operation-catalog.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u,DIGEST=/^[a-f0-9]{64}$/u;
const OPS=new Set<string>(RUST_OPERATIONS);
const deny=(s:string):never=>{throw Error("Gateway signed epoch inspection NO-GO: "+s);};

export class TrustedGatewaySignedEpochInspector{
 readonly #dir:string;
 readonly #approvals:SignedEngineerApprovalFileStore;
 readonly #nativeRoot?:TrustedGatewayNativeRootStatusReader;
 constructor(config:{directory:string;approvals:SignedEngineerApprovalFileStore;
  nativeRootStatus?:TrustedGatewayNativeRootStatusReader}){
  if(typeof config?.directory!=="string"||
     !isAbsolute(config.directory)||resolve(config.directory)!==config.directory||
     !(config.approvals instanceof SignedEngineerApprovalFileStore))
   deny("trusted absolute directory and real Engineer signed store required");
  if(config.nativeRootStatus!==undefined&&
     !(config.nativeRootStatus instanceof TrustedGatewayNativeRootStatusReader))
   deny("real Gateway-only native status reader required");
  this.#dir=config.directory;this.#approvals=config.approvals;
  this.#nativeRoot=config.nativeRootStatus;
 }
 nativeRootStatusConfigured(){return !!this.#nativeRoot;}
 async assertReady(){
  const m=await lstat(this.#dir);
  if(!m.isDirectory()||m.isSymbolicLink()||(m.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&m.uid!==process.getuid()))
   deny("directory is not owner-only 0700");
 }
 async inspect(pins:Readonly<{
  session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
 }>){
  if(!pins||!ID.test(pins.session_id)||!DIGEST.test(pins.root_plan_digest)||
     !DIGEST.test(pins.plan_digest)||!Number.isSafeInteger(pins.epoch)||
     pins.epoch<1||pins.epoch>3)
   deny("source-free original-root and epoch pins required");
  await this.assertReady();
  // A caller cannot select a path. O_NOFOLLOW, link count, owner & modes
  // protect the on-disk root identification bootstrap from symlink tricks.
  const fd=await open(join(this.#dir,"epoch-001.json"),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  let row:Record<string,unknown>;
  try{
   const m=await fd.stat();
   if(!m.isFile()||m.isSymbolicLink()||m.nlink!==1||
      (m.mode&0o777)!==0o600||m.size<30||m.size>131072||
      (typeof process.getuid==="function"&&m.uid!==process.getuid()))
    deny("initial epoch file unsafe");
   row=JSON.parse(await fd.readFile("utf8"));
  }finally{await fd.close();}
  if(!row||typeof row!=="object"||Array.isArray(row)||
     row.schema!=="trusted-operational-epoch-v1"||
     row.session_id!==pins.session_id||row.epoch!==1||
     row.original_plan_digest!==pins.root_plan_digest||
     row.plan_digest!==pins.root_plan_digest||
     typeof row.root_credential_id!=="string"||!ID.test(row.root_credential_id)||
     typeof row.base_revision!=="string"||!SHA.test(row.base_revision))
   deny("initial epoch differs from original signed session");
  // An attacker who edits the journal cannot forge this signed receipt.
  const verified=await this.#approvals.loadAuthenticatedApproval(pins.session_id);
  const original=verified.plan as any;
  if(original?.session_id!==pins.session_id||
     original?.base_revision!==row.base_revision||
     planDigest(original)!==pins.root_plan_digest)
   deny("independent Ed25519 approval does not match journal");
  const approved=assertApprovedPlanScope(original,verified.approval,{
   expectedEngineerDid:verified.authenticated_engineer_did,
   allowedOperations:OPS
  }) as Array<{resource:string;operation:string}>;
  const pairs=[...new Map(approved.map(p=>[
   JSON.stringify([p.resource,p.operation]),
   {resource:p.resource,operation:p.operation}
  ])).values()];
  const journal=new TrustedOperationalEpochJournal({
   directory:this.#dir,sessionId:pins.session_id,
   baseRevision:row.base_revision,rootCredentialId:row.root_credential_id,
   originalPlanDigest:pins.root_plan_digest,allowedOperations:OPS
  });
  const history=await journal.records();
  if(history.length!==pins.epoch||
     history.at(-1)?.plan_digest!==pins.plan_digest)
   deny("durable epoch history does not match pinned exact digest");
  // The actual RUST root grant set is NOT in this process: this is
  // explicitly an upper-bound comparison to SIGNED Engineer permissions.
  const upperBound={
   credential_id:row.root_credential_id,plan_digest:pins.root_plan_digest,
   permissions:pairs
  };
  for(let k=1;k<history.length;k++){
   preflightNextOperationalEpoch({
    originalSignedPlan:original,
    previousEpochPlan:history[k-1].plan,candidatePlan:history[k].plan,
    operationalRoot:upperBound,
    pinnedAgentRegistry:original.candidate_agents,
    priorTaskIds:history.slice(0,k).flatMap((r:any)=>r.plan.tasks.map((t:any)=>t.id)),
    priorPlanIds:history.slice(0,k).map((r:any)=>r.plan.plan_id)
   },{allowedOperations:OPS});
  }
  const after=await journal.records();
  if(after.length!==history.length||
     after.some((r:any,i:number)=>
      r.plan_digest!==history[i].plan_digest||
      r.root_credential_id!==history[i].root_credential_id))
   deny("append or replacement raced signed epoch inspection");
  return Object.freeze({
   status:"signed_epoch_ledger_consistent_not_native_root_verified" as const,
   session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
   plan_digest:pins.plan_digest,epoch:pins.epoch,
   execution_authorized:false as const,
   gateway_epoch_admitted:false as const,
   child_credential_issued:false as const
  });
 }
 /**
  * R127: two independent signed-ledger checks surround a live
  * gateway-authenticated native Rust Adapter status observation. Never
  * use caller JSON as a root ID. Neither an anchored status nor this
  * result proves DC permission contents, expiration or VP/OPA access.
  */
 async inspectNativeRootStatus(pins:Readonly<{
  session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
 }>){
  if(!(this.#nativeRoot instanceof TrustedGatewayNativeRootStatusReader))
   deny("native Rust status inspection not configured");
  await this.inspect(pins);
  const before=await this.#readPinnedRootRecord(pins);
  await this.#nativeRoot.readActiveRoot(before.rootId);
  const after=await this.#readPinnedRootRecord(pins);
  if(after.fileDigest!==before.fileDigest||after.rootId!==before.rootId)
   deny("original root identifier changed during native Adapter inspection");
  await this.inspect(pins);
  return Object.freeze({
   status:"native_root_status_correlated_not_permission_authority" as const,
   session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
   plan_digest:pins.plan_digest,epoch:pins.epoch,
   native_source:"evm_anchored_signed_jwt" as const,
   execution_authorized:false as const,
   gateway_epoch_admitted:false as const,
   child_credential_issued:false as const,
   root_permissions_verified:false as const
  });
 }
 async #readPinnedRootRecord(pins:Readonly<{
  session_id:string;root_plan_digest:string;
 }>){
  const fd=await open(join(this.#dir,"epoch-001.json"),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const m=await fd.stat();
   if(!m.isFile()||m.nlink!==1||(m.mode&0o777)!==0o600||
      m.size<30||m.size>131072||
      (typeof process.getuid==="function"&&m.uid!==process.getuid()))
    deny("native root lookup cannot read insecure original epoch");
   const text=await fd.readFile("utf8");
   const record=JSON.parse(text) as Record<string,unknown>;
   if(record.session_id!==pins.session_id||
      record.original_plan_digest!==pins.root_plan_digest||
      typeof record.root_credential_id!=="string"||
      !ID.test(record.root_credential_id))
    deny("native status root ID not derived from original signed epoch");
   return {rootId:record.root_credential_id,
    fileDigest:createHash("sha256").update(text).digest("hex")};
  }finally{await fd.close();}
 }
}
