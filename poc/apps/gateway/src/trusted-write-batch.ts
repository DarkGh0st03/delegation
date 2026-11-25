/**
 * Phase W (W2) — operational write-set batches with ONE signed VP.
 *
 * `prepareWriteBatch` creates N ORDINARY update/create records, one per file,
 * through the unchanged `prepareAuthorization` (role-bound Prepare,
 * Gateway-derived permission, authority-only Task preflight, pinned HEAD,
 * per-file fingerprint that binds path and content). They share one fresh
 * challenge and a batch window (60 s, never the Prepare TTL).
 *
 * `stageWriteBatch` (owner only) runs the owner write-set preflight and
 * reserves the ONE durable write-set flight; the admissions return the
 * write_set_digest, bound to this batch ID.
 *
 * `verifyWriteBatchItem` is used by Execute: the FIRST item verifies the VP
 * once with the native multi-permission verifier over ALL batch
 * permissions; later items reuse it only for the byte-identical VP. The
 * VP is kept (owner memory) for the second verification before the CAS.
 */
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {prepareAuthorization,type PrepareDependencies} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyWriteSetPreflight} from "./trusted-authority-only-write-set-preflight.ts";
import {MAX_FILE_BYTES,MAX_WRITE_SET_BYTES} from "./trusted-authority-only-write-set-intent-journal.ts";
import {VerificationRejectedError,VerificationUnavailableError} from "./errors.ts";
import type {AgentRole,GatewayPrepareConfig,Permission,PreparedRequestRecord,
 VerifierPort,VerifiedDelegation} from "./types.ts";

export const WRITE_BATCH_TOOL="write_files";
export const WRITE_BATCH_TTL_MS=60_000;
/** JSON size of the whole write_files request (decision: 6 MiB). */
export const MAX_WRITE_FILES_REQUEST_BYTES=6*1024*1024;
const MAX_WRITES=8;

type BatchState="prepared"|"staging"|"staged"|"verifying"|"verified"|"failed";
export interface WriteBatch{
 readonly batch_id:string;
 readonly task_id:string;
 readonly agent_role:AgentRole;
 readonly request_ids:readonly string[];
 readonly required_permissions:readonly Permission[];
 readonly challenge:string;
 readonly audience:string;
 readonly pinned_revision:string;
 readonly expires_at_ms:number;
 state:BatchState;
 write_set_digest?:string;
 plan_task_id?:string;
 vp_sha256?:string;
 /** Owner memory only: the exact VP, re-verified before the CAS. */
 signed_vp?:string;
 verified?:Readonly<VerifiedDelegation>;
 admissions?:TrustedAuthorityOnlyGatewayAdmissions;
}
export interface PreparedWriteBatchResponse{
 batch_id:string;audience:string;challenge:string;expires_at:string;
 items:{request_id:string;path:string;operation:"update_file"|"create_file";
  required_permission:Permission}[];
}
function deny(reason:string):never{throw new VerificationRejectedError("Write batch rejected: "+reason);}
const sha256=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
function exactKeys(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).sort().join(",")===[...keys].sort().join(",");
}

export class TrustedWriteBatchStore{
 readonly #batches=new Map<string,WriteBatch>();
 readonly #byRequest=new Map<string,string>();
 register(batch:WriteBatch):void{
  if(this.#batches.has(batch.batch_id)||batch.request_ids.some(id=>this.#byRequest.has(id)))
   throw Error("Duplicate write batch or batched request");
  this.#batches.set(batch.batch_id,batch);
  for(const id of batch.request_ids)this.#byRequest.set(id,batch.batch_id);
 }
 forRequest(requestId:string):WriteBatch|undefined{
  const id=this.#byRequest.get(requestId);
  return id===undefined?undefined:this.#batches.get(id);
 }
 get(batchId:string):WriteBatch|undefined{return this.#batches.get(batchId);}
 /**
  * Fail-closed on ANY failed Execute of a batch item: the batch is
  * terminally failed and the admissions decide, from THEIR state, whether
  * that means "failed" (before the CAS request) or "ambiguous" (after).
  */
 failForRequest(requestId:unknown):void{
  if(typeof requestId!=="string")return;
  const batch=this.forRequest(requestId);
  if(!batch)return;
  batch.state="failed";
  if(batch.admissions&&batch.write_set_digest&&batch.plan_task_id)
   try{batch.admissions.failTrustedWriteSet(batch.plan_task_id,batch.task_id,batch.write_set_digest);}
   catch{/* no matching write-set: nothing staged, nothing to classify */}
 }
 get size():number{return this.#batches.size;}
}

export function prepareWriteBatch(raw:unknown,
 config:GatewayPrepareConfig&{write_batch_ttl_ms?:number},
 dependencies:PrepareDependencies&{batches:TrustedWriteBatchStore}):PreparedWriteBatchResponse{
 const admissions=dependencies.authorityOnlyAdmissions;
 if(!(dependencies.batches instanceof TrustedWriteBatchStore)||
    !(admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
    admissions.batchWritesEnabled!==true||dependencies.planningRevisions)
  throw Error("Write batches require the live authority-only owner Gateway with batch writes enabled");
 const ttl=config.write_batch_ttl_ms??WRITE_BATCH_TTL_MS;
 if(!Number.isSafeInteger(ttl)||ttl<=0||ttl>WRITE_BATCH_TTL_MS)
  throw Error(`Write batch window must be 1-${WRITE_BATCH_TTL_MS} ms`);
 if(Buffer.byteLength(JSON.stringify(raw??null),"utf8")>MAX_WRITE_FILES_REQUEST_BYTES)
  throw Error("write_files request exceeds 6 MiB");
 if(!exactKeys(raw,["task_id","agent_role","tool","arguments"])||raw.tool!==WRITE_BATCH_TOOL||
    !exactKeys(raw.arguments,["branch","changes"]))
  throw Error("Invalid write batch request shape");
 const {branch,changes}=raw.arguments as {branch:unknown;changes:unknown};
 if(!Array.isArray(changes)||changes.length<2||changes.length>MAX_WRITES||
    changes.some(c=>!exactKeys(c,["path","operation","content"])||typeof c.path!=="string"||
     (c.operation!=="update_file"&&c.operation!=="create_file")||typeof c.content!=="string")||
    new Set(changes.map(c=>(c as {path:string}).path)).size!==changes.length)
  throw Error(`A write batch needs 2-${MAX_WRITES} distinct {path, operation, content} changes`);
 let total=0;
 for(const c of changes as {content:string}[]){
  const n=Buffer.byteLength(c.content,"utf8");
  if(n<1||n>MAX_FILE_BYTES||c.content.includes("\0"))throw Error("Each file must be 1 B-2 MB of UTF-8 text");
  total+=n;
 }
 if(total>MAX_WRITE_SET_BYTES)throw Error("A write batch is limited to 4 MB of content");
 const challenge=randomBytes(32).toString("base64url");
 const created=(dependencies.nowMs??Date.now)();
 const records:PreparedRequestRecord[]=[];
 const items:PreparedWriteBatchResponse["items"]=[];
 try{
  for(const c of changes as {path:string;operation:"update_file"|"create_file";content:string}[]){
   const prepared=prepareAuthorization({task_id:raw.task_id,agent_role:raw.agent_role,tool:c.operation,
    arguments:{branch,path:c.path,content:c.content}} as never,config,{...dependencies,challenge:()=>challenge});
   const record=dependencies.store.get(prepared.request_id);
   if(!record)throw Error("Prepared batch item is missing from the store");
   records.push(record);
   items.push({request_id:prepared.request_id,path:c.path,operation:c.operation,
    required_permission:prepared.required_permission});
  }
  const first=records[0]!;
  if(records.some(r=>r.task_id!==first.task_id||r.agent_role!==first.agent_role||r.challenge!==challenge||
     r.audience!==first.audience||!r.authority_only_digest||r.authority_only_digest!==first.authority_only_digest||
     r.authority_only_plan_task_id!==first.authority_only_plan_task_id||
     typeof r.pinned_revision!=="string"||r.pinned_revision!==first.pinned_revision))
   throw Error("Write batch items differ in Task, role, authority or pinned revision");
  const expiresAt=Math.min(created+ttl,...records.map(r=>r.expires_at_ms));
  for(const r of records)r.expires_at_ms=expiresAt;
  const batch:WriteBatch={batch_id:`wbatch_${randomUUID()}`,task_id:first.task_id,
   agent_role:first.agent_role,request_ids:Object.freeze(records.map(r=>r.request_id)),
   required_permissions:Object.freeze(records.map(r=>Object.freeze({...r.required_permission}))),
   challenge,audience:first.audience,pinned_revision:first.pinned_revision!,
   expires_at_ms:expiresAt,state:"prepared"};
  dependencies.batches.register(batch);
  // Canonical order (by resource): the order Execute must follow.
  items.sort((a,b)=>a.required_permission.resource<b.required_permission.resource?-1:1);
  return {batch_id:batch.batch_id,audience:batch.audience,challenge,
   expires_at:new Date(expiresAt).toISOString(),items};
 }catch(error){
  for(const r of records)r.consumed=true;
  throw error;
 }
}

/** Owner only, between Prepare and the VP: owner preflight + durable write-set flight. */
export async function stageWriteBatch(batchId:string,owner:{
 batches:TrustedWriteBatchStore;store:{get(id:string):PreparedRequestRecord|undefined};
 admissions:TrustedAuthorityOnlyGatewayAdmissions;preflight:TrustedAuthorityOnlyWriteSetPreflight;
 nowMs?:()=>number}):Promise<{write_set_digest:string}>{
 const batch=owner.batches.get(batchId);
 if(!batch||batch.state!=="prepared"||(owner.nowMs??Date.now)()>=batch.expires_at_ms)
  deny("no live prepared write batch");
 // "staging" until the durable flight is reserved; an invalidation that
 // arrives meanwhile ("failed") can never be overwritten by "staged".
 batch.state="staging";
 const records=batch.request_ids.map(id=>owner.store.get(id));
 if(records.some(r=>!r||r.consumed))deny("write batch records are missing or consumed");
 const rs=records as PreparedRequestRecord[];
 let staged:Awaited<ReturnType<TrustedAuthorityOnlyGatewayAdmissions["stageTrustedWriteSet"]>>;
 try{
  await owner.preflight.stageWriteSet(rs,batch.pinned_revision);
  staged=await owner.admissions.stageTrustedWriteSet(owner.preflight,rs,batch.batch_id);
 }catch(error){batch.state="failed";throw error;}
 batch.write_set_digest=staged.write_set_digest;
 batch.plan_task_id=staged.task_id;
 batch.admissions=owner.admissions;
 if((batch.state as BatchState)!=="staging"){
  // Invalidated during the asynchronous staging: terminal for the write-set too.
  owner.admissions.failTrustedWriteSet(staged.task_id,batch.task_id,staged.write_set_digest);
  deny("write batch was invalidated during staging");
 }
 batch.state="staged";
 return {write_set_digest:staged.write_set_digest};
}

export interface WriteBatchVerification{
 verified:VerifiedDelegation;batch_id:string;batch_verification:"performed"|"reused";
}
/** Called by Execute AFTER the record was consumed, instead of a single verification. */
export async function verifyWriteBatchItem(batch:WriteBatch,record:PreparedRequestRecord,
 signedVp:string,verifier:VerifierPort,nowMs:number):Promise<WriteBatchVerification>{
 if(batch.state==="failed")deny("batch already failed closed");
 if(!batch.request_ids.includes(record.request_id)||
    (record.request.tool!=="update_file"&&record.request.tool!=="create_file")||
    record.task_id!==batch.task_id||record.agent_role!==batch.agent_role||
    record.challenge!==batch.challenge||record.audience!==batch.audience||
    record.pinned_revision!==batch.pinned_revision||nowMs>=batch.expires_at_ms||
    !batch.write_set_digest){
  batch.state="failed";deny("record does not belong to this live, staged batch");
 }
 if(typeof signedVp!=="string"||!signedVp){batch.state="failed";deny("missing VP");}
 const digest=sha256(signedVp);
 if(batch.state==="verified"){
  if(digest!==batch.vp_sha256||!batch.verified){batch.state="failed";
   deny("a batch item must present the VP verified for the batch");}
  return {verified:batch.verified,batch_id:batch.batch_id,batch_verification:"reused"};
 }
 if(batch.state!=="staged"){batch.state="failed";deny("concurrent or unstaged batch verification");}
 if(typeof verifier.verifyMultiple!=="function"){
  batch.state="failed";throw new VerificationUnavailableError("Multi-permission verifier is not available");
 }
 batch.state="verifying";
 try{
  const verified=await verifier.verifyMultiple({presenter:batch.agent_role,audience:batch.audience,
   challenge:batch.challenge,required_permissions:batch.required_permissions.map(p=>({...p})),
   signed_vp:signedVp});
  if((batch.state as BatchState)!=="verifying")deny("batch failed closed during verification");
  batch.verified=Object.freeze(structuredClone(verified));
  batch.vp_sha256=digest;batch.signed_vp=signedVp;batch.state="verified";
  return {verified:batch.verified,batch_id:batch.batch_id,batch_verification:"performed"};
 }catch(error){batch.state="failed";throw error;}
}
