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
 * A "gemini-live" candidate REQUIRES an actual ADK Gemini instance and a
 * trusted owner-supplied synchronous permit function before EACH call.
 * The current scripted-only GitHub workflow supplies neither. An invocation
 * permit is not a billing cap or substitute for separate user consent.
 */
import {BaseLlm,Gemini} from "@google/adk";

const ROLES=Object.freeze(["backend","frontend","test"]);
const PHASES=new Set(["planning","adaptive-execution","backend","frontend","test"]);
const SOURCES=new Set(["scripted-offline","gemini-live"]);
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
 #delegate;#source;#phase;#permit;#limit;#tokenLimit;#calls=0;
 #input=0;#output=0;#total=0;#withUsage=0;#broken=false;
 constructor({
  delegate,source="scripted-offline",phase,
  maxCalls=2,maxReportedTokens=16000,permitLiveCall
 }={}){
  if(!(delegate instanceof BaseLlm)||
     typeof delegate.model!=="string"||!delegate.model||
     !SOURCES.has(source)||!PHASES.has(phase)||
     !positive(maxCalls,64)||!positive(maxReportedTokens,250000)||
     (source==="gemini-live"&&(
      !(delegate instanceof Gemini)||
      delegate.model!=="gemini-3.8-flash"||
      typeof permitLiveCall!=="function"))||
     (source==="scripted-offline"&&permitLiveCall!==undefined))
   deny();
  super({model:delegate.model});
  this.#delegate=delegate;this.#source=source;this.#phase=phase;
  this.#permit=permitLiveCall;this.#limit=maxCalls;
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
  if(this.#broken||this.#calls>=this.#limit||
     this.#total>=this.#tokenLimit)deny();
  // The permit is Owner-side only, never a model FunctionTool or A2A callback.
  // It must synchronously reject unless independent per-run billing consent,
  // GitHub dispatch provenance and secret isolation have been verified.
  if(this.#source==="gemini-live"&&this.#permit?.()!==true)deny();
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
    if(combined.aborted||response?.errorCode||response?.errorMessage||
       ++responseCount>128)deny();
    const bytes=Buffer.byteLength(JSON.stringify(response),"utf8");
    if((responseBytes+=bytes)>1_000_000)deny();
    const metadata=response?.usageMetadata;
    if(metadata!==undefined){
     const observed=validUsage(metadata);
     if(!observed)deny();
     if(this.#input+observed.input>this.#tokenLimit||
        this.#output+observed.output>this.#tokenLimit||
        this.#total+observed.total>this.#tokenLimit)deny();
     lastUsage=observed;
    }
    buffered.push(response);
   }
   if(combined.aborted)deny();
   // A missing usage record cannot be interpreted as a zero-token Gemini
   // request. No subsequent provider call is permitted after this ambiguity.
   if(this.#source==="gemini-live"&&!lastUsage)deny();
   if(lastUsage){
    this.#input+=lastUsage.input;this.#output+=lastUsage.output;
    this.#total+=lastUsage.total;this.#withUsage++;
   }
   for(const response of buffered){
    if(combined.aborted)deny();
    yield response;
   }
   done=true;
  }finally{
   if(!done)this.#broken=true;
  }
 }
 connect(){deny();}
}
