/**
 * Disposable PRIVATE OWNER model-call fence for real Google ADK Gemini.
 *
 * This module NEVER loads credentials, creates a Google provider, or
 * authorizes a paid run. Constructing this wrapper makes no network call.
 * The separately admitted owner-only path must supply a real Gemini model
 * and keep this model outside agent-visible Tools/A2A/HTTP surfaces.
 *
 * A reported-token ceiling is NOT a monetary spending cap: provider charges
 * may be incurred before a response is rejected, and even failed calls can
 * be billed. An out-of-band Google project spending limit is required.
 *
 * Unlike the scripted-only DisposableCIMeteredAdkModel, this private wrapper
 * MAY carry a real Gemini delegate. Never allow it in no-billing CI runs.
 */
import {BaseLlm} from "@google/adk";
import {createHash} from "node:crypto";

const PHASES=new Set(["planning","adaptive-execution","backend","frontend","test"]);
const deny=()=>{throw Error("Disposable private Gemini request budget NO-GO");};
const positive=(value,max)=>Number.isSafeInteger(value)&&value>=1&&value<=max;
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
function usage(value){
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const input=value.promptTokenCount;
 const output=value.candidatesTokenCount;
 const total=value.totalTokenCount;
 if(!nonnegative(input)||!nonnegative(output)||!nonnegative(total)||
    total<input+output)return null;
 return {input,output,total};
}

/**
 * A non-cooperative SDK transport may ignore AbortSignal while awaiting its
 * next streaming chunk. Race each iterator read with the trusted timeout/
 * cancellation signal so NO late response reaches ADK, even if the provider
 * never settles. The underlying request may still incur provider charges.
 * Best-effort iterator return must never delay the fail-closed decision.
 */
function nextBeforeAbort(iterator,signal){
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error("Disposable private Gemini request budget NO-GO"));return;}
  let settled=false;
  const finish=(fn,value)=>{
   if(settled)return;
   settled=true;
   signal.removeEventListener("abort",onAbort);
   fn(value);
  };
  const onAbort=()=>finish(reject,
   Error("Disposable private Gemini request budget NO-GO"));
  signal.addEventListener("abort",onAbort,{once:true});
  Promise.resolve().then(()=>{
   if(signal.aborted)deny();
   return iterator.next();
  }).then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}
/**
 * Owner-memory fingerprint of a model-proposed file write, NOT an executed
 * Gateway mutation or evidence of which service generated the model output.
 *
 * Only read after a WHOLE metered provider response completes. Never store
 * full source, API keys, prompts, function-call IDs or Gateway credentials.
 * The existing authenticated Gateway mutation receipt carries the same
 * SHA-256 of the successfully committed UTF-8 content. A future original
 * owner may reconcile the two only AFTER independent receipt verification.
 */
function fingerprintModelWrites(buffered,phase,callIndex){
 const observed=[];
 for(const response of buffered){
  const parts=response?.content?.parts;
  if(!Array.isArray(parts))continue; // usage-only responses are allowed
  for(const part of parts){
   const call=part?.functionCall;
   if(!call||!["update_file","create_file"].includes(call.name))continue;
   const args=call.args;
   if(!["backend","frontend","test"].includes(phase)||
      !args||typeof args!=="object"||Array.isArray(args)||
      Object.keys(args).sort().join(",")!=="branch,content,path"||
      args.branch!=="feature/account-suspension"||
      typeof args.path!=="string"||
      args.path.length<1||args.path.length>512||
      args.path.startsWith("/")||
      args.path.split("/").some(segment=>
       !segment||segment==="."||segment===".."||
       segment.includes("%")||segment.includes(String.fromCharCode(92))|| [...segment].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127))||
      typeof args.content!=="string")deny();
   const size=Buffer.byteLength(args.content,"utf8");
   if(size<1||size>2_000_000)deny();
   observed.push(Object.freeze({
    role:phase,call_index:callIndex,operation:call.name,
    branch:args.branch,path:args.path,
    source_sha256:createHash("sha256").update(args.content,"utf8")
     .digest("hex"),
    source_bytes:size
   }));
  }
 }
 return observed;
}
async function* boundedResponses(source,signal){
 const iterator=source?.[Symbol.asyncIterator]?.();
 if(!iterator||typeof iterator.next!=="function")deny();
 let complete=false;
 try{
  while(true){
   const response=await nextBeforeAbort(iterator,signal);
   if(response.done){complete=true;return;}
   yield response.value;
  }
 }finally{
  // Aborting a non-cooperative upstream can leave return() unresolved.
  // The trusted session has already been fenced; never wait on that cleanup.
  if(!complete&&typeof iterator.return==="function")
   void Promise.resolve().then(()=>iterator.return()).catch(()=>{});
 }
}

/**
 * One global counter shared by all FIVE models of the SAME owner session.
 * Rejects concurrent paid requests across roles (fail-closed, not a queue),
 * cap overruns, reuse and retries after ambiguous failures.
 *
 * Limits are fixed in audited source, never selected by a model, prompt,
 * worker Task or GitHub workflow input. No monetary ceiling is guaranteed.
 */
// Candidate disposable session ceiling. The original A2A BoundedModel
// enforces separate turns PER TASK; the shared 160-call / 1M-token gate
// prevents an unbounded sequence of delegated Tasks. This is post-response
// reported usage, NEVER a guaranteed monetary spending limit.
const SESSION_MAX_CALLS=160;
const SESSION_MAX_REPORTED_TOKENS=1_000_000;
export class DisposablePrivateSessionUsageBudget{
 #calls=0;#tokens=0;#active;#blocked=false;
 begin(){
  if(this.#blocked||this.#active||
     this.#calls>=SESSION_MAX_CALLS||
     this.#tokens>=SESSION_MAX_REPORTED_TOKENS){
   // A competing role trying to use the same provider session poisons
   // the already active request too: its inspect/commit must now reject.
   if(this.#active)this.#blocked=true;
   deny();
  }
  const claim=Object.freeze(Object.create(null));
  this.#active=claim;
  this.#calls++;
  return claim;
 }
 inspect(claim,reportedTokens){
  if(this.#blocked||this.#active!==claim||
     !nonnegative(reportedTokens)||
     this.#tokens+reportedTokens>
       SESSION_MAX_REPORTED_TOKENS)deny();
 }
 commit(claim,reportedTokens){
  this.inspect(claim,reportedTokens);
  this.#tokens+=reportedTokens;
  this.#active=undefined;
 }
 fence(){
  // Used when the same ADK model is re-entered before its prior request
  // finishes. A local denial must also invalidate every other role.
  this.#blocked=true;
 }
 abandon(claim){
  this.#blocked=true;
  if(this.#active===claim)this.#active=undefined;
 }
 publicSummary(){
  return Object.freeze({
   calls_started:this.#calls,
   max_calls:SESSION_MAX_CALLS,
   reported_total_tokens:this.#tokens,
   max_reported_tokens:
     SESSION_MAX_REPORTED_TOKENS,
   blocked:this.#blocked,
   monetary_cap_enforced:false
  });
 }
}

/** Strict call gate; no SDK output reaches the trusted Planner/Task consumer
 * until the complete response (including last cumulative usage) is checked.
 */
export class DisposablePrivateBudgetedAdkModel extends BaseLlm{
 #delegate;#phase;#maxCalls;#maxTokens;#maxPerCall;
 #calls=0;#reportedTotal=0;#input=0;#output=0;
 #busy=false;#blocked=false;#sessionBudget;#proposedWrites=[];
 constructor({
  delegate,phase,maxCalls,maxReportedTokens,maxPerCallTokens,sessionBudget
 }={}){
  if(!(delegate instanceof BaseLlm)||typeof delegate.model!=="string"||
     !delegate.model||!PHASES.has(phase)||
     !positive(maxCalls,512)||!positive(maxReportedTokens,1_000_000)||
     !positive(maxPerCallTokens,65536)||
     maxPerCallTokens>maxReportedTokens||
     (sessionBudget!==undefined&&
      !(sessionBudget instanceof DisposablePrivateSessionUsageBudget)))
   deny();
  super({model:delegate.model});
  this.#delegate=delegate;
  this.#phase=phase;this.#maxCalls=maxCalls;
  this.#maxTokens=maxReportedTokens;
  this.#maxPerCall=maxPerCallTokens;
  this.#sessionBudget=sessionBudget;
 }
 get phase(){return this.#phase;}
 /** Public counters NEVER include API key, prompts, source or tool calls. */
 publicSummary(){
  return Object.freeze({
   profile:"private-gemini-model-budget-not-proof-of-billing",
   phase:this.#phase,model_name:this.model,
   calls_started:this.#calls,
   max_calls:this.#maxCalls,
   reported_input_tokens:this.#input,
   reported_output_tokens:this.#output,
   reported_total_tokens:this.#reportedTotal,
   max_reported_tokens:this.#maxTokens,
   blocked:this.#blocked,
   real_generated_source_proven:false,
   billed_amount_measured:false,
   monetary_cap_enforced:false,
   model_proposed_write_fingerprints:this.#proposedWrites.length,
   independently_attested_gitea_mutations:0
  });
 }
 /**
  * Original trusted owner may compare these hashes against an independently
  * authenticated Gateway/Gitea mutation receipt. Hash coincidence alone is
  * NOT proof of live Gemini provenance, successful tool execution or billing.
  * No raw code or model reasoning is returned.
  */
 proposedSourceWriteFingerprints(){
  return Object.freeze([...this.#proposedWrites]);
 }
 async *generateContentAsync(request,stream,signal){
  if(this.#busy){
   // Reject BOTH overlapping consumers, not just the second one. The
   // first may still be waiting for provider bytes when this happens.
   this.#blocked=true;
   this.#sessionBudget?.fence();
   deny();
  }
  if(this.#blocked||this.#calls>=this.#maxCalls||
     this.#reportedTotal>=this.#maxTokens)deny();
  // One model instance accepts at most one in-flight request. Claim its
  // per-session call slot synchronously before any provider interaction.
  this.#busy=true;
  let sessionClaim;
  try{
   sessionClaim=this.#sessionBudget?.begin();
  }catch{
   this.#busy=false;
   this.#blocked=true;
   throw Error("Disposable private Gemini request budget NO-GO");
  }
  this.#calls++;
  const combined=AbortSignal.any([
   // Original paid A2A/Planning budget: up to three minutes per call.
   // All partial responses remain buffered and fenced on abort.
   AbortSignal.timeout(180000),
   ...(signal?[signal]:[])
  ]);
  let last=null,chunks=0,bytes=0,finished=false;
  const buffered=[];
  try{
   for await(const response of boundedResponses(
    this.#delegate.generateContentAsync(request,stream,combined),combined
   )){
    if(this.#blocked||combined.aborted||
       response?.errorCode||response?.errorMessage||
       ++chunks>128)deny();
    const data=JSON.stringify(response);
    if(typeof data!=="string"||(bytes+=Buffer.byteLength(data))>1_000_000)
     deny();
    if(response?.usageMetadata!==undefined){
     const next=usage(response.usageMetadata);
     if(!next||last&&(next.input<last.input||
        next.output<last.output||next.total<last.total))deny();
     if(next.total>this.#maxPerCall||
        this.#reportedTotal+next.total>this.#maxTokens)deny();
     if(sessionClaim)this.#sessionBudget.inspect(sessionClaim,next.total);
     last=next;
    }
    buffered.push(response);
   }
   // No partial response (especially FunctionTool calls) may be executed
   // without a final, valid provider-reported usage entry.
   if(this.#blocked||combined.aborted||!last)deny();
   const proposedWrites=fingerprintModelWrites(buffered,this.#phase,this.#calls);
   if(this.#proposedWrites.length+proposedWrites.length>256)deny();
   if(sessionClaim)this.#sessionBudget.commit(sessionClaim,last.total);
   this.#proposedWrites.push(...proposedWrites);
   this.#reportedTotal+=last.total;
   this.#input+=last.input;
   this.#output+=last.output;
   for(const response of buffered){
    if(this.#blocked||combined.aborted)deny();
    yield response;
   }
   finished=true;
  }finally{
   this.#busy=false;
   if(!finished){
    this.#blocked=true;
    if(sessionClaim)this.#sessionBudget.abandon(sessionClaim);
   }
  }
 }
 connect(){deny();}
}

/** Limits per model INSTANCE and entire SESSION, not per Task.
 * The original A2A BoundedModel has separate 20/14/10 turns PER Task.
 * Worst-case worker slot count is 24 signed Child-consuming Tasks.
 * Adaptive model is shared by 25 decisions plus Branch and PR proposals.
 * The independent global call/token gate ALWAYS remains authoritative.
 */
export const PRIVATE_GEMINI_SESSION_LIMITS=Object.freeze({
 planning:Object.freeze({
  maxCalls:24,maxReportedTokens:450000,maxPerCallTokens:48000
 }),
 "adaptive-execution":Object.freeze({
  maxCalls:27,maxReportedTokens:500000,maxPerCallTokens:48000
 }),
 backend:Object.freeze({
  maxCalls:480,maxReportedTokens:1_000_000,maxPerCallTokens:65536
 }),
 frontend:Object.freeze({
  maxCalls:336,maxReportedTokens:1_000_000,maxPerCallTokens:65536
 }),
 test:Object.freeze({
  maxCalls:240,maxReportedTokens:1_000_000,maxPerCallTokens:65536
 })
});
