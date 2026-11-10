/**
 * Role-pinned, worker-side Google ADK BaseLlm adapter for the ORIGINAL
 * disposable owner-model HMAC Unix IPC protocol.
 *
 * This does NOT load a Gemini client, API key, owner private key, Root or
 * Gateway. Model choice is pinned locally and re-pinned by the OWNER.
 * The task identifiers supplied to this constructor are only claims:
 * ONLY the original native owner/Child/Gateway admission validates them.
 *
 * Each Task is bound only after the ORIGINAL owner HMAC bind/ADK registry
 * has selected the exact signed Child. One worker PID can accept sequential
 * Tasks of the SAME owner-pinned session with independent model-turn limits.
 * Concurrent Task replacement and identity replay fail closed.
 * No multi-Task ambient inference, remote model selection, HTTP open proxy or
 * direct fallback to Google. Paid startup remains explicitly DISABLED:
 * this adapter does not establish OS-level process/UID isolation.
 */
import {BaseLlm} from "@google/adk";
import {randomBytes} from "node:crypto";
const ROLES=Object.freeze({backend:20,frontend:14,test:10});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TASK=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const CLAIM_KEYS="credential_id,runtime_task_id,session_id,task_id";
const MODEL="gemini-3.8-flash";
const REQUEST_KEYS=new Set([
 "contents","config","tools","systemInstruction",
 "allowedTools","previousInteractionId"
]);
const ADK_INTERNAL_ONLY=new Set([
 // @google/adk LlmRequest v2.2.1: toolsDict maps trusted local
 // FunctionTool implementations with closures; never serialize this.
 "toolsDict",
 // connect() is permanently disabled: no live/realtime transport.
 "liveConnectConfig",
 // Provider selection is owner-pinned, never from a worker request.
 "model"
]);
const deny=()=>{throw Error("Disposable original worker ADK IPC model NO-GO");};
function validClaim(v){
 return !!v&&typeof v==="object"&&!Array.isArray(v)&&
  Object.keys(v).sort().join(",")===CLAIM_KEYS&&
  ID.test(v.task_id??"")&&ID.test(v.credential_id??"")&&
  ID.test(v.session_id??"")&&TASK.test(v.runtime_task_id??"");
}
function snapshotRequest(request){
 if(!request||typeof request!=="object"||Array.isArray(request))deny();
 const raw={};
 // Never forward request-selected provider model, API credentials or
 // network overrides. No automatic inclusion of new SDK fields.
 for(const [key,value] of Object.entries(request)){
  if(ADK_INTERNAL_ONLY.has(key))continue;
  if(!REQUEST_KEYS.has(key))deny();
  if(value!==undefined)raw[key]=value;
 }
 let json;
 try{json=JSON.stringify(raw);}
 catch{deny();}
 if(typeof json!=="string"||Buffer.byteLength(json)>120*1024)deny();
 let result;
 try{result=JSON.parse(json);}
 catch{deny();}
 if(!Array.isArray(result.contents)||
    result.contents.length<1||result.contents.length>128||
    (result.allowedTools!==undefined&&
     (!Array.isArray(result.allowedTools)||
      result.allowedTools.length>64||
      result.allowedTools.some(name=>typeof name!=="string"||
       !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(name))))||
    (result.previousInteractionId!==undefined&&
     (typeof result.previousInteractionId!=="string"||
      !ID.test(result.previousInteractionId))))deny();
 // SDK session metadata may restrict functions but never supplies any
 // privileged owner callback, authorization proof or provider credentials.
 return result;
}

/** Task identity must be provisioned from the authenticated owner->agent
 * binding (not from incoming A2A text). The owner separately validates
 * every IPC call against the one-use native prebind and live Root. */
export class DisposableOriginalWorkerIpcAdkModel extends BaseLlm {
 #role;#task=null;#sessionId;#staticTask;#client;#limit;
 #started=0;#taskStarted=0;#retired=false;#inFlight=false;
 #lastOwnerCalls=0;#lastOwnerTokens=0;
 #usedTaskIds=new Set();#usedChildIds=new Set();#usedRuntimeIds=new Set();
 constructor({role,task,sessionId,client,maxCalls}={}){
  if(!Object.hasOwn(ROLES,role??"")||
     (task===undefined?!(typeof sessionId==="string"&&ID.test(sessionId)):
      !validClaim(task)||sessionId!==undefined)||
     !client||client.role!==role||typeof client.call!=="function"||
     !Number.isSafeInteger(maxCalls)||
     maxCalls<1||maxCalls>ROLES[role])deny();
  super({model:MODEL});
  this.#role=role;this.#staticTask=task!==undefined;
  this.#sessionId=task?.session_id??sessionId;
  this.#task=task?Object.freeze({...task}):null;
  this.#client=client;this.#limit=maxCalls;
 }
 get role(){return this.#role;}
 get retired(){return this.#retired;}
 get callsStarted(){return this.#started;}
 get activeTask(){return this.#task?.runtime_task_id??null;}
 /**
  * Original A2A handler calls this ONLY after the authenticated
  * TrustedEffectStagingTaskRegistry.selectFor has matched exact owner-pinned
  * Task/Child/role/operation. The session comes from the trusted bootstrap,
  * not A2A text, Gemini responses or a provider configuration.
  */
 beginOwnerBoundTask({role,task_id,credential_id,runtime_task_id}={}){
  if(this.#staticTask||this.#retired||this.#inFlight||this.#task||
     role!==this.#role||this.#usedRuntimeIds.size>=64)deny();
  const task={task_id,credential_id,runtime_task_id,session_id:this.#sessionId};
  if(!validClaim(task)||this.#usedTaskIds.has(task_id)||
     this.#usedChildIds.has(credential_id)||
     this.#usedRuntimeIds.has(runtime_task_id))deny();
  const pin=Object.freeze(task);
  this.#usedTaskIds.add(task_id);this.#usedChildIds.add(credential_id);
  this.#usedRuntimeIds.add(runtime_task_id);
  this.#task=pin;this.#taskStarted=0;
  let released=false;
  return ()=>{
   if(released)return;
   released=true;
   // In-flight replies may never be attributed to a subsequent Child.
   if(this.#task!==pin||this.#inFlight)this.#retired=true;
   if(this.#task===pin)this.#task=null;
  };
 }
 retire(){this.#retired=true;this.#task=null;}
 async *generateContentAsync(request,stream,signal){
  if(this.#retired||!this.#task||this.#inFlight||
     this.#taskStarted>=this.#limit||signal?.aborted||
     (stream!==undefined&&typeof stream!=="boolean"))deny();
  const boundTask=this.#task;
  // Local per-Task budget is distinct from the original owner-wide budget.
  // Every ambiguous attempt consumes a slot with no automatic retry.
  this.#started++;this.#taskStarted++;this.#inFlight=true;
  try{
   const payload=snapshotRequest(request);
   const callId="modelcall-"+randomBytes(16).toString("hex");
   const result=await this.#client.call({task:boundTask,callId,payload,signal});
   if(this.#retired||this.#task!==boundTask||signal?.aborted||
      !result||typeof result!=="object"||Array.isArray(result)||
      !Array.isArray(result.chunks)||
      result.chunks.length<1||result.chunks.length>128||
      !Number.isSafeInteger(result.metered_calls_started)||
      result.metered_calls_started<=this.#lastOwnerCalls||
      !Number.isSafeInteger(result.metered_total_tokens)||
      result.metered_total_tokens<=this.#lastOwnerTokens||
      result.owner_original_signed_task_verified_here!==false||
      result.provider_billed_amount_verified!==false||
      result.model_generated_source_proven!==false)deny();
   const chunks=result.chunks.map(chunk=>{
    if(!chunk||typeof chunk!=="object"||Array.isArray(chunk)||
       !chunk.content||typeof chunk.content!=="object")deny();
    const json=JSON.stringify(chunk);
    if(typeof json!=="string"||Buffer.byteLength(json)>128*1024)deny();
    return JSON.parse(json);
   });
   this.#lastOwnerCalls=result.metered_calls_started;
   this.#lastOwnerTokens=result.metered_total_tokens;
   for(const chunk of chunks){
    if(this.#retired||this.#task!==boundTask||signal?.aborted)deny();
    yield chunk;
   }
  }catch{
   this.#retired=true;deny();
  }finally{
   this.#inFlight=false;
  }
 }
 connect(){deny();}
}

/** A callback cannot be inferred from model-provided task data. */
export function createDisposableOriginalWorkerIpcAdkModel(config){
 return new DisposableOriginalWorkerIpcAdkModel(config);
}
