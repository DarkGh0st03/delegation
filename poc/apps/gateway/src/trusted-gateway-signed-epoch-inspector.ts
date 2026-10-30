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
import {TrustedGatewayRootVpVerifier}
 from "./trusted-root-vp-verification.ts";
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
 readonly #orchestratorDid?:string;
 readonly #rootVp?:TrustedGatewayRootVpVerifier;
 constructor(config:{directory:string;approvals:SignedEngineerApprovalFileStore;
  nativeRootStatus?:TrustedGatewayNativeRootStatusReader;
  trustedOrchestratorDid?:string;
  rootVpVerifier?:TrustedGatewayRootVpVerifier}){
  if(typeof config?.directory!=="string"||
     !isAbsolute(config.directory)||resolve(config.directory)!==config.directory||
     !(config.approvals instanceof SignedEngineerApprovalFileStore))
   deny("trusted absolute directory and real Engineer signed store required");
  if(config.nativeRootStatus!==undefined&&
     !(config.nativeRootStatus instanceof TrustedGatewayNativeRootStatusReader))
   deny("real Gateway-only native status reader required");
  this.#dir=config.directory;this.#approvals=config.approvals;
  this.#nativeRoot=config.nativeRootStatus;
  if(config.trustedOrchestratorDid!==undefined&&
     (typeof config.trustedOrchestratorDid!=="string"||
      !/^did:[A-Za-z0-9:._-]{3,250}$/u.test(config.trustedOrchestratorDid)||
      !(config.nativeRootStatus instanceof TrustedGatewayNativeRootStatusReader)))
   deny("native issued root comparison needs pinned Orchestrator DID and Adapter");
  this.#orchestratorDid=config.trustedOrchestratorDid;
  if(config.rootVpVerifier!==undefined&&
     (!(config.rootVpVerifier instanceof TrustedGatewayRootVpVerifier)||
      !this.nativeIssuedScopeConfigured()))
   deny("native root VP requires independent issued scope and pinned Orchestrator");
  this.#rootVp=config.rootVpVerifier;
 }
 nativeRootVpConfigured(){return !!this.#rootVp&&this.nativeIssuedScopeConfigured();}
 nativeRootStatusConfigured(){return !!this.#nativeRoot;}
 nativeIssuedScopeConfigured(){return !!this.#nativeRoot&&!!this.#orchestratorDid;}
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
 /**
  * R128: compare actual Adapter-issued claims to signed maximum and every
  * requested grant of the pinned current epoch. This is a NON-authorizing
  * issuer-local attestation. A signed VP, accumulator/public-material
  * verification, issued root chain and Gateway live epoch intake remain
  * separate mandatory admission requirements.
  */
 async inspectNativeIssuedRootScope(pins:Readonly<{
  session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
 }>){
  if(!this.nativeIssuedScopeConfigured())
   deny("native issued root scope comparison not configured");
  await this.inspectNativeRootStatus(pins);
  const before=await this.#readPinnedRootRecord(pins);
  const actual=await this.#nativeRoot!.readIssuedRoot(before.rootId);
  const signed=await this.#approvals.loadAuthenticatedApproval(pins.session_id);
  if(actual.issuer_id!==signed.authenticated_engineer_did||
     actual.delegatee_id!==this.#orchestratorDid)
   deny("Rust issued root issuer or delegatee does not match pinned identities");
  const original=signed.plan as any;
  const approved=assertApprovedPlanScope(original,signed.approval,{
   expectedEngineerDid:signed.authenticated_engineer_did,
   allowedOperations:OPS
  }) as Array<{resource:string;operation:string}>;
  const pair=(x:{resource:string;operation:string})=>
   JSON.stringify([x.resource,x.operation]);
  const signedPairs=new Set(approved.map(pair));
  const actualPairs=new Set<string>();
  for(const g of actual.permissions){
   if(!OPS.has(g.operation)||!signedPairs.has(pair(g)))
    deny("native issued root exceeds the originally signed permission envelope");
   actualPairs.add(pair(g));
  }
  const record=await this.#readPinnedRootRecord(pins);
  const journal=new TrustedOperationalEpochJournal({
   directory:this.#dir,sessionId:pins.session_id,
   baseRevision:record.baseRevision,rootCredentialId:before.rootId,
   originalPlanDigest:pins.root_plan_digest,allowedOperations:OPS
  });
  const epochs=await journal.records();
  if(epochs.length!==pins.epoch||
     epochs.at(-1)?.plan_digest!==pins.plan_digest||
     epochs.at(-1)?.root_credential_id!==before.rootId)
   deny("actual issued permissions not bound to the current durable epoch");
  for(const permission of epochs.at(-1)!.plan.requested_permissions){
   if(!actualPairs.has(pair(permission)))
    deny("current signed repair plan requests a grant not actually issued in Rust");
  }
  const after=await this.#readPinnedRootRecord(pins);
  if(before.fileDigest!==after.fileDigest||before.rootId!==after.rootId)
   deny("root changed during native grant inspection");
  await this.inspectNativeRootStatus(pins);
  return Object.freeze({
   status:"native_issued_root_scope_correlated_no_vp_authority" as const,
   session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
   plan_digest:pins.plan_digest,epoch:pins.epoch,
   native_issued_grants_checked:true as const,
   cryptographic_presentation_verified:false as const,
   execution_authorized:false as const,
   gateway_epoch_admitted:false as const,
   child_credential_issued:false as const
  });
 }
 /**
  * R132: the actual Gateway process correlates R126 signed epoch,
  * R127 EVM-root status, R128 issued grants, and an independently
  * verified fresh root VP (R129/R130). NO Task authorization follows.
  * Never accept a credential ID, DID, grant or signed VP from IPC JSON.
  */
 async inspectCryptographicRootVp(pins:Readonly<{
  session_id:string;root_plan_digest:string;plan_digest:string;epoch:number;
 }>){
  if(!this.nativeRootVpConfigured())
   deny("root VP inspection requires real trusted Gateway verifier");
  await this.inspectNativeIssuedRootScope(pins);
  const original=await this.#approvals.loadAuthenticatedApproval(pins.session_id);
  const before=await this.#readPinnedRootRecord(pins);
  const journal=new TrustedOperationalEpochJournal({
   directory:this.#dir,sessionId:pins.session_id,
   baseRevision:before.baseRevision,
   rootCredentialId:before.rootId,
   originalPlanDigest:pins.root_plan_digest,allowedOperations:OPS
  });
  const epochs=await journal.records();
  if(epochs.length!==pins.epoch||
     epochs.at(-1)?.plan_digest!==pins.plan_digest)
   deny("root VP scope does not match exactly pinned current epoch");
  const current=epochs.at(-1)!.plan;
  const unique=new Map<string,{resource:string;operation:string}>();
  for(const g of current.requested_permissions){
   if(!OPS.has(g.operation)||typeof g.resource!=="string")
    deny("untrusted signed operational grant");
   const pair=JSON.stringify([g.resource,g.operation]);
   unique.set(pair,{resource:g.resource,operation:g.operation});
  }
  const grants=[...unique.values()];
  if(!grants.length||grants.length>128)
   deny("root VP requires nonempty scoped grants");
  const verified=await this.#rootVp!.verifyRoot({
   credential_id:before.rootId,
   engineer_did:original.authenticated_engineer_did,
   orchestrator_did:this.#orchestratorDid!,
   required_permissions:grants
  });
  if(verified.cryptographic_presentation_verified!==true||
     verified.credential_id!==before.rootId||
     verified.verified_permission_count!==grants.length||
     verified.execution_authorized!==false)
   deny("native verifier did not corroborate original signed root");
  // The root and all issued grants may have changed WHILE Rust verified
  // the VP. Re-run live anchored checks, not just a stale file hash.
  const after=await this.#readPinnedRootRecord(pins);
  if(after.fileDigest!==before.fileDigest||
     after.rootId!==before.rootId)
   deny("original issued root changed while verifying VP");
  await this.inspectNativeIssuedRootScope(pins);
  return Object.freeze({
   status:"rust_root_vp_correlated_signed_epoch_no_admission" as const,
   session_id:pins.session_id,root_plan_digest:pins.root_plan_digest,
   plan_digest:pins.plan_digest,epoch:pins.epoch,
   native_issued_grants_checked:true as const,
   cryptographic_presentation_verified:true as const,
   gateway_epoch_admitted:false as const,
   execution_authorized:false as const,
   child_credential_issued:false as const
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
   if(typeof record.base_revision!=="string"||!SHA.test(record.base_revision))
    deny("invalid original revision for issued root comparison");
   return {rootId:record.root_credential_id,
    baseRevision:record.base_revision,
    fileDigest:createHash("sha256").update(text).digest("hex")};
  }finally{await fd.close();}
 }
}
