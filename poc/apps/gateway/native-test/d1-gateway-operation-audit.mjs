/** Owner-private, per-signed-D1-task operation telemetry.
 * Only the trusted Gateway host calls these methods; a model's text grants nothing.
 * Request IDs remain private and are never included in snapshots. */
const TOOLS=new Set(["read_file","update_file"]);
const SHA=/^[a-f0-9]{40}$/u;
const deny=()=>{throw Error("D1 Gateway audit invariant violated");};
const counters=()=>({read_attempts:0,read_confirmed:0,read_denied:0,
 update_attempts:0,update_denied:0,update_provider_confirmed:0});
export class D1GatewayOperationAudit{
 #active=new Map();#pending=new Map();
 begin({role,taskId,runtimeTaskId}){
  if(!["backend","frontend","test"].includes(role)||
     typeof taskId!=="string"||!taskId||
     !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(runtimeTaskId??"")||
     this.#active.has(runtimeTaskId))deny();
  this.#active.set(runtimeTaskId,{role,taskId,counts:counters()});
 }
 attempt({role,runtimeTaskId,tool}){
  const entry=this.#active.get(runtimeTaskId);
  if(!entry||entry.role!==role||!TOOLS.has(tool))return false;
  entry.counts[tool==="read_file"?"read_attempts":"update_attempts"]++;
  return true;
 }
 prepared({runtimeTaskId,tool,requestId}){
  if(!this.#active.has(runtimeTaskId)||!TOOLS.has(tool)||
     typeof requestId!=="string"||!requestId||this.#pending.has(requestId))deny();
  this.#pending.set(requestId,{runtimeTaskId,tool});
 }
 rejectedPrepare({runtimeTaskId,tool}){
  const entry=this.#active.get(runtimeTaskId);
  if(!entry||!TOOLS.has(tool))deny();
  entry.counts[tool==="read_file"?"read_denied":"update_denied"]++;
 }
 confirmed({requestId,effect}){
  const pending=this.#pending.get(requestId);
  if(!pending)return false;
  this.#pending.delete(requestId);
  if(effect?.provider!=="gitea"||effect.tool!==pending.tool||
     effect?.status==="fail")deny();
  const entry=this.#active.get(pending.runtimeTaskId);
  if(!entry)deny();
  entry.counts[pending.tool==="read_file"?"read_confirmed":"update_provider_confirmed"]++;
  return true;
 }
 rejectedExecute(requestId){
  const pending=this.#pending.get(requestId);
  if(!pending)return false;
  this.#pending.delete(requestId);
  const entry=this.#active.get(pending.runtimeTaskId);
  if(!entry)deny();
  entry.counts[pending.tool==="read_file"?"read_denied":"update_denied"]++;
  return true;
 }
 snapshot({role,taskId,runtimeTaskId,taskWriteCount,headChanged}){
  const entry=this.#active.get(runtimeTaskId);
  if(!entry||entry.role!==role||entry.taskId!==taskId||
     !Number.isSafeInteger(taskWriteCount)||taskWriteCount<0||
     typeof headChanged!=="boolean")deny();
  const c=entry.counts;
  const status=taskWriteCount>0?"confirmed":
   c.update_provider_confirmed>0?"effect_correlation_failure":
   c.update_denied>0?"update_denied":
   c.update_attempts>0?"update_not_confirmed":"no_update_attempted";
  return Object.freeze({...c,d1_operation_status:status});
 }
}
