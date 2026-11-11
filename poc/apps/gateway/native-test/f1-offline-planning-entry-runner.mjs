/**
 * R277 — capture failures before the native planning module enters its own
 * try/catch, including ESM imports, config validation and Gitea bootstrap.
 *
 * The parent receives only a source-free, finite native phase receipt.
 * Never forward error.message, raw stack, repository text or credentials.
 */
import {PREFIX,safeNativePhaseFailure}
 from "./native-signed-dag-phase-diagnostic.mjs";

export async function runF1OfflinePlanningEntry({
 load,env=process.env,state=globalThis,
 write=line=>process.stderr.write(line)
}={}){
 try{
   if(typeof load!=="function")throw Error("Trusted F1 load function required");
   if(env.PLANNING_REAL_GITEA_ONLY!=="1"||
      env.ENGINEER_CORE_NATIVE_MODE!=="1"||
      env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
      env.DELEGATION_SIGNED_GEMINI_PILOT!=="0"||
      Boolean(env.GEMINI_API_KEY))
     throw Error("Offline F1 must use direct Rust and no paid inference");
   await load();
   return true;
 }catch(error){
   // The child has already emitted its own more specific bounded receipt
   // when it catches the exception inside the signed DAG try block.
   if(state.__nativeDagPhaseReported!==true){
     const stage=state.__nativeDagBootstrapStage;
     write(PREFIX+JSON.stringify(safeNativePhaseFailure(error,stage))+"\n");
   }
   return false;
 }
}
