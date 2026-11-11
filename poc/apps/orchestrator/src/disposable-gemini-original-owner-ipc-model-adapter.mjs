/**
 * Owner-only adapter: ORIGINAL metered ADK model -> authenticated Unix RPC.
 *
 * Must be composed with startDisposableOwnerModelIpcServer AND an independent
 * ORIGINAL signed Task/Child authorizer. It does not itself approve a Task
 * or launch a provider, agent, Root or subprocess. Real paid startup remains
 * hard-blocked until separate worker process/OS principal and IPC task
 * provenance are verified end-to-end.
 *
 * The worker receives only JSON LlmResponse chunks and numeric metering.
 * Provider key, model delegate, in-memory fingerprints and owner callback
 * remain inaccessible through the returned response structure.
 */
import {DisposablePrivateBudgetedAdkModel}
 from "./disposable-gemini-live-budgeted-model.mjs";

const ROLES=new Set(["backend","frontend","test"]);
const CALL=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const DENY="Disposable original owner IPC model adapter NO-GO";
const deny=()=>{throw Error(DENY);};
const forbidden=new Set([
 "apiKey","api_key","keyFile","privateKey","authorization",
 "headers","endpoint","baseUrl","provider","model","token"
]);

export function createDisposableOriginalOwnerIpcModelAdapter({role,model}={}){
 if(!ROLES.has(role)||
    !(model instanceof DisposablePrivateBudgetedAdkModel)||
    model.phase!==role||typeof model.publicSummary!=="function")deny();
 let retired=false;
 const retire=()=>{
  if(retired)return;
  retired=true;
  model.fenceOwnerCancellation();
 };
 const invokeModel=async ({role:sourceRole,task,callId,payload,signal}={})=>{
  if(retired||sourceRole!==role||!CALL.test(callId??"")||
     !task||typeof task!=="object"||Array.isArray(task)||
     !payload||typeof payload!=="object"||Array.isArray(payload)||
     !Array.isArray(payload.contents)||payload.contents.length<1||
     payload.contents.length>128||
     Object.keys(payload).some(key=>forbidden.has(key))||
     signal?.aborted)deny();
  const before=model.publicSummary();
  if(before.blocked)deny();
  const chunks=[];
  try{
   for await(const response of model.generateContentAsync(
    payload,false,signal
   )){
    // The existing metered wrapper buffered the complete provider stream
    // and validated final usage before returning any chunk. JSON cloning
    // excludes SDK objects/callbacks from crossing into a worker.
    const encoded=JSON.stringify(response);
    if(typeof encoded!=="string"||Buffer.byteLength(encoded)>128*1024||
       chunks.length>=128)deny();
    chunks.push(JSON.parse(encoded));
   }
   const after=model.publicSummary();
   if(retired||signal?.aborted||after.blocked||
      after.calls_started!==before.calls_started+1||
      after.reported_total_tokens<=before.reported_total_tokens||
      chunks.length===0)deny();
   return Object.freeze({
    chunks,
    metered_calls_started:after.calls_started,
    metered_total_tokens:after.reported_total_tokens,
    owner_original_signed_task_verified_here:false,
    provider_billed_amount_verified:false,
    model_generated_source_proven:false
   });
  }catch{
   // A failed provider call cannot be retried with a new IPC call_id.
   retire();
   deny();
  }
 };
 return Object.freeze({role,invokeModel,retire,
  get retired(){return retired;}});
}
