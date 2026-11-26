/**
 * Phase W (W3): owner-private reads -> write-set coordinator. NO endpoint,
 * NO provider authorization: it sequences, for ONE write-set Task, the
 * owner-side steps around the Gateway Executes:
 *   read_ready -> read_pending -> ... (each signed read staged and attested)
 *   -> reads_done -> write_set_staged (owner preflight + durable write-set
 *   flight for the Gateway write batch) -> attested (every per-file evidence,
 *   in canonical order, after the single HEAD-CAS) -> finalized.
 * The agent supplies only Gateway request/batch IDs; paths, contents, blob
 * SHAs and the write plan come from the Gateway records, the owner Gitea
 * reads and the durable manifest. Any failure is terminal ("failed").
 */
import {InMemoryRequestStore} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyWriteSetPreflight} from "./trusted-authority-only-write-set-preflight.ts";
import {AuthenticatedWriteSetCompletionObserver} from "./trusted-authority-only-write-set-evidence.ts";
import {TrustedWriteBatchStore,stageWriteBatch} from "./trusted-write-batch.ts";

const SHA40=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
type State="read_ready"|"read_pending"|"reads_done"|"write_set_staged"|"finalized"|"failed";
function deny(reason:string):never{
 throw Error("Authority-only write-set owner NO-GO: "+reason);
}
export class TrustedAuthorityOnlySequentialWriteSetStager{
 readonly stagedTool="read_then_write_set" as const;
 get plannedReads():number{return this.#plannedReads;}
 get plannedWrites():number{return this.#plannedWrites;}
 readonly #store:InMemoryRequestStore;
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #batches:TrustedWriteBatchStore;
 readonly #preflight:TrustedAuthorityOnlyWriteSetPreflight;
 readonly #observer:AuthenticatedWriteSetCompletionObserver;
 readonly #planTaskId:string;
 readonly #runtimeTaskId:string;
 readonly #plannedReads:number;
 readonly #plannedWrites:number;
 readonly #nowMs?:()=>number;
 #state:State;
 #attestedReads=0;
 #pendingRead?:string;
 #batchId?:string;
 #digest?:string;
 private constructor(o:{store:InMemoryRequestStore;admissions:TrustedAuthorityOnlyGatewayAdmissions;
  batches:TrustedWriteBatchStore;preflight:TrustedAuthorityOnlyWriteSetPreflight;
  observer:AuthenticatedWriteSetCompletionObserver;planTaskId:string;runtimeTaskId:string;
  plannedReads:number;plannedWrites:number;nowMs?:()=>number}){
  this.#store=o.store;this.#admissions=o.admissions;this.#batches=o.batches;
  this.#preflight=o.preflight;this.#observer=o.observer;this.#planTaskId=o.planTaskId;
  this.#runtimeTaskId=o.runtimeTaskId;this.#plannedReads=o.plannedReads;this.#plannedWrites=o.plannedWrites;
  this.#nowMs=o.nowMs;
  this.#state=o.plannedReads>0?"read_ready":"reads_done";
 }
 static async begin(o:{store:InMemoryRequestStore;admissions:TrustedAuthorityOnlyGatewayAdmissions;
  batches:TrustedWriteBatchStore;preflight:TrustedAuthorityOnlyWriteSetPreflight;
  observer:AuthenticatedWriteSetCompletionObserver;planTaskId:string;runtimeTaskId:string;
  expectedHeadSha:string;nowMs?:()=>number}):Promise<TrustedAuthorityOnlySequentialWriteSetStager>{
  if(!(o?.store instanceof InMemoryRequestStore)||
     !(o.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(o.batches instanceof TrustedWriteBatchStore)||
     !TrustedAuthorityOnlyWriteSetPreflight.isNativeForAdmissions(o.preflight,o.admissions)||
     !AuthenticatedWriteSetCompletionObserver.isNative(o.observer)||
     !ID.test(o.planTaskId)||!ID.test(o.runtimeTaskId)||!SHA40.test(o.expectedHeadSha)||
     (o.nowMs!==undefined&&typeof o.nowMs!=="function"))
   deny("same trusted owner, write-set preflight, observer, exact Task and pinned HEAD required");
  const started=await o.admissions.beginTrustedSequentialWriteSetTask(o.planTaskId,o.runtimeTaskId,
   o.expectedHeadSha);
  if(started.status!=="sequential_write_set_manifest_reserved_staged"||started.task_id!==o.planTaskId||
     started.writes<2||started.writes>8||started.reads<0||started.reads>15||
     started.gateway_execution_authorized!==false)
   deny("original immutable write-set manifest is not durably reserved");
  return new TrustedAuthorityOnlySequentialWriteSetStager({...o,plannedReads:started.reads,
   plannedWrites:started.writes});
 }
 static isNativeForOwner(value:unknown,admissions:TrustedAuthorityOnlyGatewayAdmissions,
  planTaskId:string,runtimeTaskId:string):value is TrustedAuthorityOnlySequentialWriteSetStager{
  return value instanceof TrustedAuthorityOnlySequentialWriteSetStager&&#admissions in value&&
   value.#admissions===admissions&&value.#planTaskId===planTaskId&&value.#runtimeTaskId===runtimeTaskId;
 }
 /** A signed read (between its Prepare and its VP). */
 async stage(requestId:string):Promise<unknown>{
  if(this.#state!=="read_ready")deny("out-of-order, duplicate or terminated owner read");
  this.#state="failed";
  const record=typeof requestId==="string"&&ID.test(requestId)?this.#store.get(requestId):undefined;
  if(!record||record.task_id!==this.#runtimeTaskId||record.request.tool!=="read_file")
   deny("only a signed read of this Task can be staged before the write-set");
  const result=await this.#admissions.stageTrustedSequentialReadEffect(record);
  if(result.status!=="sequential_read_effect_reserved_staged"||
     result.sequence!==this.#attestedReads+1||result.task_id!==this.#planTaskId)
   deny("owner read flight was not durably staged");
  this.#pendingRead=requestId;this.#state="read_pending";
  return result;
 }
 /** After the Gateway read and its MAC receipt; reads only. */
 async attest(requestId:string,tool:"read_file"|"update_file"|"create_file"):Promise<void>{
  if(tool!=="read_file"||this.#state!=="read_pending"||requestId!==this.#pendingRead)
   deny("unverified, foreign or duplicate source read");
  this.#state="failed";
  const r=await this.#admissions.attestTrustedSequentialReadEffect(this.#planTaskId,this.#runtimeTaskId);
  if(r.status!=="sequential_read_effect_attested_staged"||r.sequence!==this.#attestedReads+1)
   deny("original read not independently attested in sequence");
  this.#attestedReads=r.sequence;this.#pendingRead=undefined;
  this.#state=this.#attestedReads===this.#plannedReads?"reads_done":"read_ready";
 }
 /** Between the write-batch Prepare and its VP: owner preflight + durable flight. */
 async stageWriteSet(batchId:string):Promise<{write_set_digest:string}>{
  if(this.#state!=="reads_done")deny("every signed read must be attested before the write-set");
  this.#state="failed";
  const batch=typeof batchId==="string"&&ID.test(batchId)?this.#batches.get(batchId):undefined;
  if(!batch||batch.task_id!==this.#runtimeTaskId||batch.request_ids.length!==this.#plannedWrites)
   deny("write batch is not the exact signed write-set of this Task");
  const staged=await stageWriteBatch(batchId,{batches:this.#batches,store:this.#store,
   admissions:this.#admissions,preflight:this.#preflight,
   ...(this.#nowMs?{nowMs:this.#nowMs}:{})});
  this.#batchId=batchId;this.#digest=staged.write_set_digest;this.#state="write_set_staged";
  return staged;
 }
 /** After the single HEAD-CAS: every per-file evidence in order, then final. */
 async attestWriteSet(batchId:string):Promise<void>{
  if(this.#state!=="write_set_staged"||batchId!==this.#batchId||!this.#digest)
   deny("write-set is not staged for this batch");
  this.#state="failed";
  for(let i=0;i<this.#plannedWrites;i++){
   const r=await this.#admissions.attestTrustedWriteSetEffect(this.#planTaskId,this.#runtimeTaskId,
    this.#digest,this.#observer);
   if(r.status!=="write_set_effect_attested_staged"||r.sequence!==this.#plannedReads+1+i)
    deny("write evidence not attested in canonical order");
  }
  const complete=await this.#admissions.finalizeTrustedSequentialReadTask(this.#planTaskId,this.#runtimeTaskId);
  if(complete.status!=="sequential_read_task_complete_staged"||
     complete.total_effects!==this.#plannedReads+this.#plannedWrites)
   deny("write-set Task final evidence not durably sealed");
  this.#state="finalized";
 }
 get finalized():boolean{return this.#state==="finalized";}
}
