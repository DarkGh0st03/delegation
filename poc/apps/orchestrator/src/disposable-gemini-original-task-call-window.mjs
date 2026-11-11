/**
 * Private owner-memory, one-shot Task call-window collector.
 *
 * The ORIGINAL A2A handler selects its prebound signed Task/Child before
 * invoking the model; ONLY its trustedOriginalModelCallWindow callback
 * should record here, AFTER authenticated Gateway completion. Owner wiring
 * holds this callback inside the trusted runtime: NEVER A2A/ADK/prompts.
 *
 * Memory-only fingerprints are not durable provenance, cryptographic Task
 * signatures, proof of Gemini origin or billable API expense.
 */
import {DisposablePrivateBudgetedAdkModel}
 from "./disposable-gemini-live-budgeted-model.mjs";

const ROLES=Object.freeze({backend:20,frontend:14,test:10});
const ISSUED=new WeakMap();
const deny=()=>{throw Error("Disposable original A2A model call window NO-GO");};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const safe=x=>typeof x==="string"&&x.length>0&&x.length<=240&&
 ![...x].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127);
const fields="call_index_after,call_index_before,credential_id,role,runtime_task_id,task_id";
function key(row){return row.task_id+"|"+row.credential_id+"|"+row.runtime_task_id;}
export class DisposableOriginalA2AModelCallWindowStore{
 #role;#model;#records=new Map();#seen=new Set();#latestEnd=0;
 #callbackIssued=false;
 constructor({role,model}={}){
  if(!Object.hasOwn(ROLES,role??"")||
     !(model instanceof DisposablePrivateBudgetedAdkModel)||
     model.phase!==role)deny();
  this.#role=role;this.#model=model;
 }
 /** Call exactly once during trusted worker assembly. */
 callbackForOriginalA2A(){
  if(this.#callbackIssued)deny();
  this.#callbackIssued=true;
  return Object.freeze((row)=>this.#record(row));
 }
 #record(row){
  if(!row||typeof row!=="object"||Array.isArray(row)||
     Object.keys(row).sort().join(",")!==fields||
     row.role!==this.#role||
     !ID.test(row.task_id??"")||
     !ID.test(row.runtime_task_id??"")||
     !safe(row.credential_id)||
     !Number.isSafeInteger(row.call_index_before)||
     !Number.isSafeInteger(row.call_index_after)||
     row.call_index_before<this.#latestEnd||
     row.call_index_after<=row.call_index_before||
     row.call_index_after-row.call_index_before>ROLES[this.#role])
   deny();
  const sum=this.#model.publicSummary();
  if(sum.blocked||sum.calls_started!==row.call_index_after||
     this.#seen.has(key(row)))deny();
  const witnessed=Object.freeze({...row});
  this.#seen.add(key(witnessed));
  this.#records.set(key(witnessed),witnessed);
  this.#latestEnd=witnessed.call_index_after;
 }
 /**
  * Only the original trusted owner may retrieve it. The full Task/Child/
  * runtime identity must match the independently authenticated receipt.
  */
 takeOriginalWindow({task_id,credential_id,runtime_task_id}={}){
  if(!ID.test(task_id??"")||!safe(credential_id)||
     !ID.test(runtime_task_id??""))deny();
  const entry=this.#records.get(key({task_id,credential_id,runtime_task_id}));
  if(!entry)deny();
  this.#records.delete(key(entry));
  ISSUED.set(entry,this.#model);
  return entry;
 }
}
/** Verify unforgeable in-process origin before comparing a Gitea receipt.
 * Consume only after independent Gateway verification and digest match. */
export function isIssuedOriginalA2ACallWindow(model,window){
 return !!window&&typeof window==="object"&&ISSUED.get(window)===model;
}
export function claimIssuedOriginalA2ACallWindow(model,window){
 if(!isIssuedOriginalA2ACallWindow(model,window))deny();
 ISSUED.delete(window);
 return window;
}
