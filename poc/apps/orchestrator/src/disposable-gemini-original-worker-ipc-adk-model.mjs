/**
 * Role-pinned, worker-side Google ADK BaseLlm adapter for the ORIGINAL
 * disposable owner-model HMAC Unix IPC protocol.
 *
 * This does NOT load a Gemini client, API key, owner private key, Root or
 * Gateway. Model choice is pinned locally and re-pinned by the OWNER.
 * The task identifiers supplied to this constructor are only claims:
 * ONLY the original native owner/Child/Gateway admission validates them.
 *
 * This is one specialized Task per adapter, with a bounded number of turns.
 * No multi-Task ambient state, remote model selection, HTTP open proxy or
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
 #role;#task;#client;#limit;#started=0;#retired=false;
 #lastOwnerCalls=0;#lastOwnerTokens=0;
 constructor({role,task,client,maxCalls}={}){
  if(!Object.hasOwn(ROLES,role??"")||
     !validClaim(task)||
     !client||client.role!==role||typeof client.call!=="function"||
     !Number.isSafeInteger(maxCalls)||
     maxCalls<1||maxCalls>ROLES[role])deny();
  super({model:MODEL});
  this.#role=role;
  this.#task=Object.freeze({...task});
  this.#client=client;
  this.#limit=maxCalls;
 }
 get role(){return this.#role;}
 get retired(){return this.#retired;}
 get callsStarted(){return this.#started;}
 retire(){this.#retired=true;}
 async *generateContentAsync(request,stream,signal){
  if(this.#retired||this.#started>=this.#limit||signal?.aborted||
     (stream!==undefined&&typeof stream!=="boolean"))deny();
  // Both the local attempt and original native owner call budget are
  // one-way. Never retry after a timed-out, truncated or ambiguous call.
  this.#started++;
  try{
   const payload=snapshotRequest(request);
   const callId="modelcall-"+randomBytes(16).toString("hex");
   const result=await this.#client.call({
    task:this.#task,callId,payload,signal
   });
   if(this.#retired||signal?.aborted||
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
    // Pass plain model responses only; no RPC metadata/owner objects.
    const json=JSON.stringify(chunk);
    if(typeof json!=="string"||Buffer.byteLength(json)>128*1024)deny();
    return JSON.parse(json);
   });
   this.#lastOwnerCalls=result.metered_calls_started;
   this.#lastOwnerTokens=result.metered_total_tokens;
   for(const chunk of chunks){
    if(this.#retired||signal?.aborted)deny();
    yield chunk;
   }
  }catch{
   this.#retired=true;
   deny();
  }
 }
 connect(){deny();}
}

/** A callback cannot be inferred from model-provided task data. */
export function createDisposableOriginalWorkerIpcAdkModel(config){
 return new DisposableOriginalWorkerIpcAdkModel(config);
}
