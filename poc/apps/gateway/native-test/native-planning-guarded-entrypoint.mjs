import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {PREFIX,PHASES,safeNativePhaseFailure}
 from "./native-signed-dag-phase-diagnostic.mjs";

/**
 * Guard the zero-billing direct-Rust signed DAG before evaluating its module.
 * Emits only the validated phase metadata when the inner handler could not.
 */
export async function runGuardedNativePlanning({
 load=()=>import("./native-planning-read-core-evm-e2e.mjs"),
 emit=record=>process.stderr.write(record)
}={}){
 try{
  await load();
  return true;
 }catch(error){
  if(globalThis.__nativeDagPhaseReported!==true){
   const phase=PHASES.includes(globalThis.__nativeDagBootstrapStage)
    ?globalThis.__nativeDagBootstrapStage:"entrypoint_bootstrap";
   emit(PREFIX+JSON.stringify(safeNativePhaseFailure(error,phase))+"\n");
  }
  return false;
 }
}
const direct=process.argv[1]&&
 resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){
 const passed=await runGuardedNativePlanning();
 if(!passed)process.exitCode=1;
}
