/**
 * R359.4 owner-private reads->single write coordinator.
 * A typed native Child grants N read_file permissions plus ONE write: the
 * CAS update_file of a file read in this Task (the edited file and its
 * signed context files), or the create_file of a NEW file written from the
 * files read (e.g. a new test for a component). Every granted read is
 * staged, executed and independently attested once, one at a time; only
 * then the single write (a create also proves absence at the pinned HEAD).
 * Owner-held shared Prepare store and exact Gitea HEAD are mandatory.
 * This object has NO HTTP/A2A/MCP endpoint and never authorizes provider I/O.
 */
import {InMemoryRequestStore} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight}
 from "./trusted-authority-only-mutation-preflight.ts";
import {AuthenticatedGiteaMutationCompletionObserver}
 from "./trusted-authority-only-gitea-mutation-evidence.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight}
 from "./trusted-authority-only-create-preflight.ts";

const SHA40=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
type State="read_ready"|"read_pending"|"read_verified"|
 "mutation_pending"|"finalized"|"failed";
function deny(reason:string):never{
 throw Error("Authority-only sequential read/update owner NO-GO: "+reason);
}
export class TrustedAuthorityOnlySequentialReadUpdateStager{
 /** Reads then the write fixed by the signed grant (durable manifest). */
 get stagedTool():"read_then_update"|"read_then_create"{
  return this.#write==="create_file"?"read_then_create":"read_then_update";
 }
 /** Signed reads before the update, from the durable effect manifest. */
 get plannedReads():number{return this.#plannedReads;}
 readonly #store:InMemoryRequestStore;
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
 readonly #observer:AuthenticatedGiteaMutationCompletionObserver;
 readonly #create?:TrustedAuthorityOnlyGiteaCreatePreflight;
 readonly #write:"update_file"|"create_file";
 readonly #planTaskId:string;
 readonly #runtimeTaskId:string;
 readonly #head:string;
 #state:State="read_ready";
 /** Reads planned by the durable manifest (N) and already attested. */
 readonly #plannedReads:number;
 #attestedReads=0;
 #readRequestIds=new Set<string>();
 #pendingReadRequestId?:string;
 #updateRequestId?:string;
 #readPaths=new Set<string>();
 #noChange?:ReturnType<TrustedAuthorityOnlyGatewayAdmissions["fenceTrustedSequentialTaskBeforeWrite"]>;
 private constructor(opts:{
  store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
  mutationObserver:AuthenticatedGiteaMutationCompletionObserver;
  createPreflight?:TrustedAuthorityOnlyGiteaCreatePreflight;
  planTaskId:string;runtimeTaskId:string;expectedHeadSha:string;
  plannedReads:number;write:"update_file"|"create_file";
 }){
  this.#plannedReads=opts.plannedReads;
  this.#write=opts.write;this.#create=opts.createPreflight;
  this.#store=opts.store;this.#admissions=opts.admissions;
  this.#mutation=opts.mutation;this.#observer=opts.mutationObserver;
  this.#planTaskId=opts.planTaskId;this.#runtimeTaskId=opts.runtimeTaskId;
  this.#head=opts.expectedHeadSha;
 }
 static async begin(opts:{
  store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
  mutationObserver:AuthenticatedGiteaMutationCompletionObserver;
  /** Owner CREATE preflight (absence proof); required for reads + create. */
  createPreflight?:TrustedAuthorityOnlyGiteaCreatePreflight;
  planTaskId:string;runtimeTaskId:string;expectedHeadSha:string;
 }):Promise<TrustedAuthorityOnlySequentialReadUpdateStager>{
  if(!(opts?.store instanceof InMemoryRequestStore)||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.mutation instanceof TrustedAuthorityOnlyGiteaMutationPreflight)||
     !(opts.mutationObserver instanceof AuthenticatedGiteaMutationCompletionObserver)||
     !opts.mutation.isForAdmissions(opts.admissions)||
     (opts.createPreflight!==undefined&&
      !(opts.createPreflight instanceof TrustedAuthorityOnlyGiteaCreatePreflight))||
     !ID.test(opts.planTaskId)||!ID.test(opts.runtimeTaskId)||
     !SHA40.test(opts.expectedHeadSha))
   deny("same trusted owner, exact native Task and pinned HEAD required");
  const started=await opts.admissions.beginTrustedSequentialReadUpdateTask(
   opts.planTaskId,opts.runtimeTaskId,opts.expectedHeadSha);
  if(started.status!=="sequential_read_update_manifest_reserved_staged"||
     started.task_id!==opts.planTaskId||
     !Number.isSafeInteger(started.total_effects)||
     started.total_effects<2||started.total_effects>16||
     (started.write_operation!=="update_file"&&started.write_operation!=="create_file")||
     (started.write_operation==="create_file"&&!opts.createPreflight)||
     started.gateway_execution_authorized!==false)
   deny("original immutable read/write manifest is not durably reserved");
  return new TrustedAuthorityOnlySequentialReadUpdateStager({
   ...opts,plannedReads:started.total_effects-1,write:started.write_operation});
 }
 /** Native private owner stager identity, never derived from an A2A claim. */
 static isNativeForOwner(value:unknown,
  admissions:TrustedAuthorityOnlyGatewayAdmissions,
  planTaskId:string,runtimeTaskId:string):
  value is TrustedAuthorityOnlySequentialReadUpdateStager{
  return value instanceof TrustedAuthorityOnlySequentialReadUpdateStager&&
   #admissions in value&&value.#admissions===admissions&&
   value.#planTaskId===planTaskId&&value.#runtimeTaskId===runtimeTaskId;
 }
 /**
  * Called by the original owner only. Burn the stager synchronously before
  * checking the Gateway, so a late update cannot race the fence.
  */
 fenceBeforeWrite(){
  // After at least one attested read and before any update attempt.
  if((this.#state!=="read_verified"&&this.#state!=="read_ready")||
     this.#attestedReads<1)
   deny("pre-write fence requires an independently attested read and no update attempt");
  this.#state="failed";
  return this.#admissions.fenceTrustedSequentialTaskBeforeWrite(
   this.#planTaskId,this.#runtimeTaskId);
 }
 async reportNoChange(requestId:string):Promise<void>{
  if(!this.#readRequestIds.has(requestId)||requestId===this.#pendingReadRequestId)
   deny("no-change report must match an attested original read request");
  this.#noChange=this.fenceBeforeWrite();
 }
 getReportedNoChange(){return this.#noChange;}
 /** Native IPC acknowledgement is independently verified, not a PASS flag. */
 async attest(requestId:string,tool:"read_file"|"update_file"|"create_file"):Promise<void>{
  if(tool==="read_file")return this.attestRead(requestId);
  if(tool===this.#write)return this.attestMutation(requestId);
  deny("unknown native mixed effect operation");
 }
 /** Called only between Gateway Prepare and signed VP, never from the model. */
 async stage(requestId:string):Promise<unknown>{
  if(this.#state!=="read_ready"&&this.#state!=="read_verified")
   deny("out-of-order, duplicate or terminated owner effect");
  const phase=this.#state;
  // A malformed/mismatched Prepare consumes the owner slot, including
  // failures detected before the durable journal's first write.
  this.#state="failed";
  if(!ID.test(requestId))deny("malformed native Task request ID");
  const record=this.#store.get(requestId);
  if(!record||record.task_id!==this.#runtimeTaskId||
     record.consumed!==false||record.expires_at_ms<=Date.now()||
     record.pinned_revision!==this.#head||
     !record.request?.arguments||
     typeof record.request.arguments.path!=="string")
   deny("read/update Prepare lacks original Task, path or expected HEAD");
  const tool=record.request.tool;
  const path=record.request.arguments.path;
  if(phase==="read_ready"){
   // Every granted read comes first, each file once, one at a time.
   if(tool!=="read_file")
    deny("all granted reads must precede the write");
   if(this.#readPaths.has(path))deny("a granted file may be read only once per Task");
   const result=await this.#admissions.stageTrustedSequentialReadEffect(record);
   if(result.status!=="sequential_read_effect_reserved_staged"||
      result.sequence!==this.#attestedReads+1||result.task_id!==this.#planTaskId||
      result.gateway_execution_authorized!==false)
    deny("owner read flight was not durably staged");
   this.#readPaths.add(path);
   this.#readRequestIds.add(requestId);
   this.#pendingReadRequestId=requestId;
   this.#state="read_pending";
   return result;
  }
  if(tool!==this.#write)deny("final effect differs from the signed Task write");
  if(tool==="update_file"){
   if(!this.#readPaths.has(path))
    deny("mutation must target a file independently read in this Task");
   const intent=await this.#mutation.stageUpdate(record,this.#head);
   if(intent.status!=="gitea_update_intent_reserved_without_execution"||
      intent.provider_write_authorized!==false)
    deny("native Gitea CAS intent not reserved");
  }else{
   // A NEW file: never one of the files read, absent at the pinned HEAD.
   if(this.#readPaths.has(path)||!this.#create)
    deny("create must target a new file, not one read in this Task");
   const staged=await this.#create.stageCreate(record,this.#head);
   if(staged.status!=="gitea_create_intent_reserved_without_execution"||
      staged.provider_write_authorized!==false||
      staged.intent.expected_head_sha!==this.#head||
      staged.intent.request_id!==requestId)
    deny("native Gitea CREATE intent not reserved at the pinned HEAD");
  }
  const result=await this.#admissions.stageTrustedSequentialMutationEffect(record);
  if(result.status!=="sequential_mutation_effect_reserved_staged"||
     result.sequence!==this.#plannedReads+1||result.task_id!==this.#planTaskId||
     result.gateway_execution_authorized!==false)
   deny("second native mutation flight not chained to read evidence");
  this.#updateRequestId=requestId;
  this.#state="mutation_pending";
  return result;
 }
 /** Only AFTER actual Gateway read, Rust VP, OPA and MAC source publication. */
 async attestRead(requestId:string):Promise<void>{
  if(this.#state!=="read_pending"||requestId!==this.#pendingReadRequestId)
   deny("unverified, foreign or duplicate source read");
  this.#state="failed";
  const result=await this.#admissions.attestTrustedSequentialReadEffect(
   this.#planTaskId,this.#runtimeTaskId);
  if(result.status!=="sequential_read_effect_attested_staged"||
     result.sequence!==this.#attestedReads+1||result.task_id!==this.#planTaskId||
     result.gateway_execution_authorized!==false)
   deny("original read not independently attested in sequence");
  this.#attestedReads=result.sequence;
  this.#pendingReadRequestId=undefined;
  // More granted reads may follow; the update needs ALL of them attested.
  this.#state=this.#attestedReads===this.#plannedReads?"read_verified":"read_ready";
 }
 /** Only AFTER actual Gateway CAS; independent mutation observer seals it. */
 async attestMutation(requestId:string):Promise<void>{
  if(this.#state!=="mutation_pending"||requestId!==this.#updateRequestId)
   deny("unverified, foreign or duplicate CAS result");
  this.#state="failed";
  const result=await this.#admissions.attestTrustedSequentialMutationEffect(
   this.#planTaskId,this.#runtimeTaskId,this.#observer.toTrustedObserver());
  if(result.status!=="sequential_mutation_effect_attested_staged"||
     result.sequence!==this.#plannedReads+1||result.task_id!==this.#planTaskId||
     result.gateway_execution_authorized!==false)
   deny("original CAS mutation not independently attested");
  const complete=await this.#admissions.finalizeTrustedSequentialReadTask(
   this.#planTaskId,this.#runtimeTaskId);
  if(complete.status!=="sequential_read_task_complete_staged"||
     complete.total_effects!==this.#plannedReads+1||complete.task_id!==this.#planTaskId||
     complete.gateway_execution_authorized!==false)
   deny("mixed Task final evidence not durably sealed");
  this.#state="finalized";
 }
}
