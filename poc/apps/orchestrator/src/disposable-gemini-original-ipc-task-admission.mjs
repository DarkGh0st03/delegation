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
import {startDisposableOwnerModelIpcServer}
 from "./disposable-gemini-owner-worker-ipc.mjs";
import {startDisposableOriginalNativeRustPresentationRelays}
 from "./disposable-gemini-original-native-rust-presentation-relays.mjs";

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
 // Native role signer access is SEPARATE from a model-call slot. The
 // owner-side Rust relay may create a Gateway-challenged presentation only
 // while the same real R323 Coordinator/Child/Gateway Task is active.
 // This is not a substitute for Rust verifying the issued credential.
 const authorizeNativePresentation=({credentialId}={})=>{
  if(retired||!ID.test(credentialId??""))deny();
  const found=[...admitted.values()].find(item=>
   !item.closed&&item.binding.credential_id===credentialId
  );
  if(!found)deny();
  rootCheck(found.pin);
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
  role,bindOriginalReceipt,authorizeSignedTask,
  authorizeNativePresentation,retireTask,retireAll,
  get retired(){return retired;},
  get boundTaskCount(){return admitted.size;}
 });
}


/**
 * Bind all THREE existing specialist model channels to one ORIGINAL
 * Review Host Root. This is the owner-only composition of the per-Task
 * R323 ledger above, NOT an alternative signer, Owner, planner or worker.
 *
 * roleAuthorizers can be passed directly to the existing owner-side
 * startDisposableOwnerModelIpcServer for each role. They reject all calls
 * until the SAME Review Host supplies its one-use native prebind receipt
 * through onNativeOriginalTaskPrebound. No model delegate, API key, Root
 * bearer or worker endpoint is held here.
 *
 * The receipt is never copied, saved or accepted from an IPC body. This
 * factory alone DOES NOT provide Linux isolation or enable paid Gemini.
 */
export function createDisposableOriginalThreeRoleModelTaskAdmission(){
 const roles=Object.keys(LIMIT);
 const ledgers=new Map();
 const active=new Map(roles.map(role=>[role,new Set()]));
 const admitted=new Map(roles.map(role=>[role,0]));
 const fenced=new Map(roles.map(role=>[role,0]));
 let rootPin=null,rootAsserter=null,closed=false;
 const revokeAll=()=>{
  if(closed)return;
  closed=true;
  for(const ledger of ledgers.values())ledger.retireAll();
  for(const entries of active.values())entries.clear();
 };
 const originalRoot=assertOriginalRootActive=>{
  if(closed||typeof assertOriginalRootActive!=="function"){
   revokeAll();deny();
  }
  let root;
  try{root=assertOriginalRootActive();}
  catch{revokeAll();deny();}
  if(!root||!ID.test(root.session_id??"")||
     !ID.test(root.root_credential_id??"")||
     !DIGEST.test(root.authority_digest??"")){
   revokeAll();deny();
  }
  const pin=[root.session_id,root.root_credential_id,root.authority_digest];
  if(rootPin&&pin.some((v,i)=>v!==rootPin[i])){
   revokeAll();deny();
  }
  return pin;
 };
 const onNativeOriginalTaskPrebound=({
  role,receipt,assertOriginalRootActive
 }={})=>{
  if(closed||!Object.hasOwn(LIMIT,role??"")||
     !receipt||typeof receipt!=="object")deny();
  // The Root callback must be the one the original Review Host created
  // at R323, never derived from a worker claim or a JSON receipt.
  const pin=originalRoot(assertOriginalRootActive);
  let ledger=ledgers.get(role);
  if(!ledger){
   ledger=createDisposableOriginalNativeIpcTaskAdmission({
    role,assertOriginalRootActive
   });
   ledgers.set(role,ledger);
  }
  const result=ledger.bindOriginalReceipt(receipt);
  if(result.status!==
     "original_native_child_gateway_model_task_prebound_not_executed")deny();
  if(!rootPin){
   rootPin=pin;
   // Re-check the SAME original Coordinator Root on every role's model
   // turn, including an unrelated specialist's already-bound Task.
   rootAsserter=assertOriginalRootActive;
  }
  const taskId=receipt.runtime_task_id;
  active.get(role).add(taskId);
  admitted.set(role,admitted.get(role)+1);
  let finished=false;
  return ()=>{
   if(finished)return;
   finished=true;
   // Closing the owner cancels all model authority before any asynchronous
   // socket/worker shutdown; a late retirement cannot revive a Task.
   if(!closed)ledger.retireTask(taskId);
   active.get(role).delete(taskId);
   fenced.set(role,fenced.get(role)+1);
  };
 };
 const roleAuthorizers=Object.freeze(Object.fromEntries(roles.map(role=>
  [role,async input=>{
   if(closed||!input||input.role!==role)deny();
   if(!rootAsserter)deny();
   // Root revocation / replacement must fence ALL three roles at once,
   // not just the specific role whose old Task is being replayed.
   originalRoot(rootAsserter);
   const ledger=ledgers.get(role);
   if(!ledger)deny();
   return ledger.authorizeSignedTask(input);
  }]
 )));
 // The original Rust presentation transport cannot be invoked from a
 // worker-borne Task alone. Owner-side receipt provenance and the live
 // SAME Root must independently match the exact signed Child ID.
 const authorizeNativePresentation=({role,credentialId}={})=>{
  if(closed||!Object.hasOwn(LIMIT,role??"")||
     !ID.test(credentialId??"")||!rootAsserter)deny();
  originalRoot(rootAsserter);
  const ledger=ledgers.get(role);
  if(!ledger)deny();
  return ledger.authorizeNativePresentation({credentialId});
 };
 const retireAll=()=>revokeAll();
 // Aggregate only non-secret counts. An owner cannot use these numbers as
 // Gateway evidence, a Rust signature, or a paid launch authorization.
 const snapshot=()=>Object.freeze({
  closed,original_native_root_bound:rootPin!==null,
  admitted:Object.freeze(Object.fromEntries(
   roles.map(role=>[role,admitted.get(role)]))),
  fenced:Object.freeze(Object.fromEntries(
   roles.map(role=>[role,fenced.get(role)]))),
  active:Object.freeze(Object.fromEntries(
   roles.map(role=>[role,active.get(role).size])))
 });
 return Object.freeze({
  onNativeOriginalTaskPrebound,roleAuthorizers,
  authorizeNativePresentation,retireAll,snapshot
 });
}


/**
 * Start the EXISTING one-per-role owner Unix HMAC model servers with one
 * shared native Root gate. This is not an alternative agent runtime or
 * launch workflow: a signed Review Host still mints every R323 receipt,
 * and the existing trusted A2A worker must present its exact Task/Child.
 *
 * OFFLINE ONLY: caller-supplied callbacks produce scripted responses.
 * Cross-UID file/peer isolation and native DID signer identity must be
 * independently verified before use in an operational paid deployment.
 * Never accept worker/IPC data as an owner admission function.
 */
export async function startDisposableOriginalThreeRoleModelIpcOwner({
 channels,invokeModelByRole,originalScopedRoles,nativeRust,
 offlineSyntheticOnly
}={}){
 const roles=Object.keys(LIMIT);
 const triple=value=>value&&typeof value==="object"&&
  !Array.isArray(value)&&
  Object.keys(value).sort().join(",")===roles.slice().sort().join(",");
 if(offlineSyntheticOnly!==true||
    process.env.DELEGATION_DISPOSABLE_LIVE_MODE==="gemini-real"||
    ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY",
     "GOOGLE_APPLICATION_CREDENTIALS"].some(key=>
       Object.hasOwn(process.env,key))||
    !triple(channels)||!triple(invokeModelByRole)||
    (originalScopedRoles!==undefined&&!triple(originalScopedRoles)))
  deny();
 // The three ORIGINAL specialists must be separate Linux principals.
 // Per-role HMAC file checks alone would miss reuse of a worker UID/GID
 // across two agents; never call that a three-role isolated topology.
 if(originalScopedRoles!==undefined){
  const owners=new Set(),workers=new Set(),groups=new Set();
  for(const role of roles){
   const scope=originalScopedRoles[role];
   if(!exact(scope,["ownerUid","role","roleGid","workerUid"])||
      scope.role!==role||
      ![scope.ownerUid,scope.workerUid,scope.roleGid].every(
       v=>Number.isSafeInteger(v)&&v>0
      )||
      scope.ownerUid===scope.workerUid)deny();
   owners.add(scope.ownerUid);
   workers.add(scope.workerUid);
   groups.add(scope.roleGid);
  }
  if(owners.size!==1||workers.size!==3||groups.size!==3)deny();
 }
 const paths=new Set();
 for(const role of roles){
  const channel=channels[role];
  if(!exact(channel,["secretFile","socketPath"])||
     typeof channel.socketPath!=="string"||
     typeof channel.secretFile!=="string"||
     channel.socketPath===channel.secretFile||
     paths.has(channel.socketPath)||paths.has(channel.secretFile)||
     typeof invokeModelByRole[role]!=="function"||
     (originalScopedRoles!==undefined&&
      originalScopedRoles[role]?.role!==role))
   deny();
  paths.add(channel.socketPath);paths.add(channel.secretFile);
 }
 // Optional one-Rust signer composition. This is the ONLY supported way
 // for the model Owner and the Rust VP relays to share the authentic R323
 // Child/Root admission ledger. No direct worker signer token can mint it.
 if(nativeRust!==undefined&&(
    !originalScopedRoles||
    !exact(nativeRust,["originalNativeSocketPath","roleSockets","roleTokens"])||
    !triple(nativeRust.roleSockets)||!triple(nativeRust.roleTokens)||
    paths.has(nativeRust.originalNativeSocketPath)||
    Object.values(nativeRust.roleSockets).some(p=>paths.has(p))))
  deny();
 const gate=createDisposableOriginalThreeRoleModelTaskAdmission();
 const servers=[];
 let presenter;
 try{
  for(const role of roles){
   servers.push(await startDisposableOwnerModelIpcServer({
    role,...channels[role],
    authorizeSignedTask:gate.roleAuthorizers[role],
    invokeModel:invokeModelByRole[role],
    ...(originalScopedRoles?{
     originalScopedModelRole:originalScopedRoles[role]
    }:{})
   }));
  }
  if(nativeRust){
   presenter=await startDisposableOriginalNativeRustPresentationRelays({
    ...nativeRust,scopes:originalScopedRoles,
    authorizeNativePresentation:gate.authorizeNativePresentation,
    offlineSyntheticOnly:true
   });
  }
 }catch{
  gate.retireAll();
  await Promise.allSettled([
   presenter?.close(),
   ...servers.reverse().map(server=>server.close())
  ]);
  deny();
 }
 let closing;
 // Local retirement is SYNCHRONOUS. A future worker callback never
 // gains time to start another model call during asynchronous shutdown.
 const close=()=>{
  gate.retireAll();
  return closing??=(async()=>{
   const outcomes=await Promise.allSettled([
    ...(presenter?[presenter.close()]:[]),
    ...servers.reverse().map(server=>server.close())
   ]);
   if(outcomes.some(outcome=>outcome.status==="rejected"))deny();
  })();
 };
 return Object.freeze({
  onNativeOriginalTaskPrebound:gate.onNativeOriginalTaskPrebound,
  roleAuthorizers:gate.roleAuthorizers,
  authorizeNativePresentation:gate.authorizeNativePresentation,
  snapshot:gate.snapshot,
  nativeRustPresenterSnapshot:()=>presenter?.snapshot()??null,
  close
 });
}
