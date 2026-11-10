/**
 * Original native/Gateway-bound Task admission for the disposable owner ADK
 * Unix model transport. This is an OWNER-memory one-use admission ledger,
 * never an Agent Card, provider, A2A request, signer, or Rust permission.
 *
 * ONLY a receipt minted inside the genuine R323 original prebind (AFTER
 * Coordinator+native Child+Gateway agreement and authenticated agent bind)
 * can create an entry. Its provenance is an in-process WeakMap brand, NOT
 * the signed credentials themselves. Revalidate the original Root on every
 * subsequent model turn. Gateway Prepare/VP/OPA remain mandatory for effects.
 *
 * A worker's own task/credential identifiers are NOT trusted. They only
 * match an already consumed original owner-issued prebind.
 */
import {claimTrustedOriginalNativeTaskPrebindForModelIpc}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-remote-effect-owner.ts";

const LIMIT=Object.freeze({backend:20,frontend:14,test:10});
const DISPATCH=/^dispatch_[A-Za-z0-9_-]{22}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const deny=()=>{throw Error("Disposable original signed IPC Task admission NO-GO");};
function exact(value,keys){
 return value&&typeof value==="object"&&!Array.isArray(value)&&
 Object.keys(value).sort().join(",")===keys.slice().sort().join(",");
}
const taskKeys=["credential_id","runtime_task_id","session_id","task_id"];
const sameTask=(a,b)=>taskKeys.every(k=>a[k]===b[k]);

/** This callback must close over the ORIGINAL owner-only
 * TrustedAuthorityOnlyExecutionCoordinator.assertTrustedGatewayAuthorityBinding.
 * Do not expose it through IPC or create it from a worker-supplied object.
 *
 * This ledger gives NO independent signing/approval authority.
 */
export function createDisposableOriginalNativeIpcTaskAdmission({
 role,assertOriginalRootActive
}={}){
 if(!Object.hasOwn(LIMIT,role??"")||
    typeof assertOriginalRootActive!=="function")deny();
 const admitted=new Map(),identities=new Set(),calls=new Set();
 let retired=false;
 const rootCheck=pin=>{
  let root;
  try{root=assertOriginalRootActive();}
  catch{retired=true;deny();}
  if(!root||typeof root!=="object"||
     root.session_id!==pin.session_id||
     root.authority_digest!==pin.authority_digest||
     root.root_credential_id!==pin.root_credential_id||
     !DIGEST.test(root.authority_digest??"")){
   retired=true;deny();
  }
 };
 const bindOriginalReceipt=(receipt,{maxCalls=LIMIT[role]}={})=>{
  if(retired||!Number.isSafeInteger(maxCalls)||
     maxCalls<1||maxCalls>LIMIT[role]||admitted.size>=64)deny();
  // A JSON clone, mocked receipt or foreign role cannot mint authority.
  // Proof is permanently consumed even when validation later fails.
  const pin=claimTrustedOriginalNativeTaskPrebindForModelIpc(receipt);
  if(pin.role!==role||
     !ID.test(pin.task_id??"")||
     !DISPATCH.test(pin.runtime_task_id??"")||
     !ID.test(pin.session_id??"")||
     !ID.test(pin.credential_id??"")||
     !ID.test(pin.root_credential_id??"")||
     !DIGEST.test(pin.authority_digest??"")||
     admitted.has(pin.runtime_task_id)||
     identities.has(pin.task_id)||identities.has(pin.credential_id))deny();
  rootCheck(pin);
  const binding=Object.freeze({
   role,task_id:pin.task_id,runtime_task_id:pin.runtime_task_id,
   credential_id:pin.credential_id,session_id:pin.session_id
  });
  identities.add(pin.task_id);identities.add(pin.credential_id);
  admitted.set(pin.runtime_task_id,{
   pin,binding,maxCalls,usedCalls:0,closed:false
  });
  return Object.freeze({
   status:"original_native_child_gateway_model_task_prebound_not_executed",
   task_id:pin.task_id,runtime_task_id:pin.runtime_task_id,
   model_calls_started_here:0,
   gateway_execution_authorized:false
  });
 };
 const authorizeSignedTask=async(input={})=>{
  if(retired||input.role!==role||
     !exact(input.task,taskKeys)||
     !ID.test(input.callId??"")||
     !DISPATCH.test(input.task.runtime_task_id))deny();
  const item=admitted.get(input.task.runtime_task_id);
  if(!item||item.closed)deny();
  if(!sameTask(input.task,item.binding)){
   item.closed=true;deny();
  }
  // Burn request slot BEFORE root revalidation to prohibit retries if
  // revocation is concurrent or a native verification becomes unavailable.
  const callKey=item.pin.runtime_task_id+"|"+input.callId;
  if(calls.has(callKey)||item.usedCalls>=item.maxCalls){
   item.closed=true;deny();
  }
  calls.add(callKey);item.usedCalls++;
  rootCheck(item.pin);
  return true;
 };
 const retireTask=runtimeTaskId=>{
  if(retired||!admitted.has(runtimeTaskId))deny();
  admitted.get(runtimeTaskId).closed=true;
 };
 const retireAll=()=>{
  retired=true;
  for(const entry of admitted.values())entry.closed=true;
 };
 return Object.freeze({
  role,bindOriginalReceipt,authorizeSignedTask,retireTask,retireAll,
  get retired(){return retired;},
  get boundTaskCount(){return admitted.size;}
 });
}
