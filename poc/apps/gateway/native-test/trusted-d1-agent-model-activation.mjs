/**
 * R151.11: private owner-only model selection for freshly signed D1 Tasks.
 *
 * This is NOT an authorization source or a way to create a Task/Child DC.
 * Call only AFTER current-root, independently admitted epoch, exact
 * role/grant, failed SHA, live A2A Child DC and predecessor checks.
 *
 * In zero-billing tests the exhausted scripted model gets one owner-arm.
 * In an explicitly enabled generative pilot the already-pinned BaseLlm
 * receives an ordinary NEW signed A2A Task with its own Gateway registry
 * and scoped VP. There is no scripted repair payload, source mutation,
 * permission expansion, fallback or model call at binding time.
 */
import {BaseLlm} from "@google/adk";
const TASK=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const deny=()=>{throw Error("R151.11 signed D1 model activation NO-GO");};
export function selectTrustedD1AgentModelActivation({
 role,taskId,model,scriptedModelClass,allowGenerative=false
}={}){
 if(!["backend","frontend","test"].includes(role)||!TASK.test(taskId??"")||
    typeof scriptedModelClass!=="function"||
    typeof allowGenerative!=="boolean"||
    !(model instanceof BaseLlm))
   deny();
 if(allowGenerative){
  if(model instanceof scriptedModelClass||
     typeof model.generateContentAsync!=="function"||
     typeof model.model!=="string"||!model.model.trim())
   deny();
  // Model has no grant, child DC or execution access from this result.
  return Object.freeze({mode:"generative",role,task_id:taskId,
   needs_scripted_arming:false});
 }
 if(!(model instanceof scriptedModelClass)||
    typeof model.generateContentAsync!=="function")
   deny();
 return Object.freeze({mode:"offline_scripted",role,task_id:taskId,
  needs_scripted_arming:true});
}
