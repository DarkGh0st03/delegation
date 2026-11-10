/**
 * Disposable CI research model boundary, separate from the original R5
 * protected human Owner. This adapter does not load an API key, instantiate
 * Gemini, sign, issue credentials, or launch any agent.
 *
 * The original ADK Planner and adaptive Loop consume BaseLlm; this adapter
 * keeps exactly that contract while making invocation and provider-reported
 * usage observable without recording prompts, source, keys, tool contents,
 * raw responses, receipts or private A2A/task identifiers.
 *
 * This research-only CI adapter is explicitly OFFLINE. No API key, billing
 * permit, Gemini model, or alternate live mode is admitted. A future paid
 * Gemini experiment requires a separate owner-side authorization path,
 * genuinely isolated credentials and explicit user billing consent.
 */
import {BaseLlm,Gemini} from "@google/adk";

const ROLES=Object.freeze(["backend","frontend","test"]);
const PHASES=new Set(["planning","adaptive-execution","backend","frontend","test"]);
const SOURCES=new Set(["scripted-offline"]);
const deny=()=>{throw Error("Disposable ADK research model boundary NO-GO");};
const positive=(x,max)=>Number.isSafeInteger(x)&&x>=1&&x<=max;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
function validUsage(metadata){
 if(!metadata||typeof metadata!=="object")return null;
 const input=metadata.promptTokenCount,output=metadata.candidatesTokenCount;
 const total=metadata.totalTokenCount;
 if(!nonnegative(input)||!nonnegative(output)||!nonnegative(total)||
    total<input+output)return null;
 return {input,output,total};
}
/**
 * Call/result counts are observations, not proof of genuine generative
 * decisions. Correlation with independently verified Task/Child/Git commits
 * belongs to the original Owner's execution evidence ledger.
 */
export class DisposableCIMeteredAdkModel extends BaseLlm{
 #delegate;#source;#phase;#limit;#tokenLimit;#calls=0;
 #input=0;#output=0;#total=0;#withUsage=0;#broken=false;#inFlight=false;
 constructor({
  delegate,source="scripted-offline",phase,
  maxCalls=2,maxReportedTokens=16000,permitLiveCall
 }={}){
  if(!(delegate instanceof BaseLlm)||
     typeof delegate.model!=="string"||!delegate.model||
     !SOURCES.has(source)||!PHASES.has(phase)||
     !positive(maxCalls,64)||!positive(maxReportedTokens,250000)||
     // An actual Gemini instance must never be smuggled into an offline
     // profile. A model name alone is NOT a security proof; this is a
     // defense-in-depth check beside the audited fixed CI call sites.
     delegate instanceof Gemini||
     /^gemini(?:-|$)/iu.test(delegate.model)||
     permitLiveCall!==undefined)
   deny();
  super({model:delegate.model});
  this.#delegate=delegate;this.#source=source;this.#phase=phase;
  this.#limit=maxCalls;
  this.#tokenLimit=maxReportedTokens;
 }
 get observedCalls(){return this.#calls;}
 get source(){return this.#source;}
 get phase(){return this.#phase;}
 get allowedRoles(){return [...ROLES];}
 /** No raw model output, key, code or permission appears in the snapshot. */
 publicSummary(){
  return Object.freeze({
   phase:this.#phase,
   source_claim:this.#source,
   model_name:this.model,
   calls_started:this.#calls,
   calls_with_provider_usage:this.#withUsage,
   reported_input_tokens:this.#input,
   reported_output_tokens:this.#output,
   reported_total_tokens:this.#total,
   usage_complete:this.#withUsage===this.#calls&&!this.#broken,
   real_model_decisions_verified:false,
   authorized_native_tasks_verified:false,
   billed_amount_measured:false,
   approval_by_human:false
  });
 }
 async *generateContentAsync(request,stream,signal){
  // Concurrent streams could each pass the same remaining token budget
  // before either commits its usage. Fence both instead of releasing Tasks.
  if(this.#inFlight){this.#broken=true;deny();}
  if(this.#broken||this.#calls>=this.#limit||
     this.#total>=this.#tokenLimit)deny();
  this.#inFlight=true;
  // Only trusted, code-pinned local BaseLlm fixtures are constructed by
  // the disposable workflow. No live provider or billing permit is valid.
  ++this.#calls;
  const combined=AbortSignal.any([
   AbortSignal.timeout(60000),...(signal?[signal]:[])
  ]);
  // Buffer bounded *in memory* until the complete provider call, its
  // last cumulative usage and its error state have been verified. Yielding
  // partial ADK tool calls before this gate could execute an over-budget
  // proposal or an incomplete response downstream.
  let lastUsage=null,responseCount=0,responseBytes=0,done=false;
  const buffered=[];
  try{
   for await(const response of this.#delegate.generateContentAsync(
    request,stream,combined
   )){
    if(this.#broken||combined.aborted||response?.errorCode||response?.errorMessage||
       ++responseCount>128)deny();
    const bytes=Buffer.byteLength(JSON.stringify(response),"utf8");
    if((responseBytes+=bytes)>1_000_000)deny();
    const metadata=response?.usageMetadata;
    if(metadata!==undefined){
     const observed=validUsage(metadata);
     if(!observed)deny();
     // Streaming usage is cumulative. Reject a decreasing report instead of
     // treating the final (smaller) value as the entire provider charge.
     // No response reaches the trusted Planner/Execution Loop until verified.
     if(lastUsage&&(observed.input<lastUsage.input||
        observed.output<lastUsage.output||
        observed.total<lastUsage.total))deny();
     if(this.#input+observed.input>this.#tokenLimit||
        this.#output+observed.output>this.#tokenLimit||
        this.#total+observed.total>this.#tokenLimit)deny();
     lastUsage=observed;
    }
    buffered.push(response);
   }
   if(combined.aborted)deny();
   // Missing metadata is explicitly incomplete evidence, NEVER zero-cost
   // Gemini proof. The signed CI experiment itself is offline-only.
   if(lastUsage){
    this.#input+=lastUsage.input;this.#output+=lastUsage.output;
    this.#total+=lastUsage.total;this.#withUsage++;
   }
   for(const response of buffered){
    if(this.#broken||combined.aborted)deny();
    yield response;
   }
   done=true;
  }finally{
   this.#inFlight=false;
   if(!done)this.#broken=true;
  }
 }
 connect(){deny();}
}
