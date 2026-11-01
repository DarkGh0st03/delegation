/**
 * Validate the next task against the *admitted* signed D1 schedule.
 *
 * Both a generated-Test EDITOR and the final run-only VALIDATOR legitimately
 * have agent_id="test". Role alone cannot distinguish these two tasks: only
 * the exact signed Task ID, ordinal and editor provenance can do so.
 * This helper allocates no Child DC and grants no authority.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROLES=new Set(["backend","frontend","test"]);
const deny=()=>{throw Error("Signed D1 Task not in admitted topological schedule");};

export function assertSignedD1ScheduledTask({
 id,role,ordinal,orderedTaskIds,validatorTaskId,editors
}={}){
 if(!ID.test(id??"")||!ROLES.has(role)||
    !Number.isSafeInteger(ordinal)||ordinal<0||
    !Array.isArray(orderedTaskIds)||orderedTaskIds.length<2||
    orderedTaskIds.length>9||
    orderedTaskIds.some(x=>!ID.test(x))||
    new Set(orderedTaskIds).size!==orderedTaskIds.length||
    !ID.test(validatorTaskId??"")||
    orderedTaskIds.at(-1)!==validatorTaskId||
    !(editors instanceof Map)||
    editors.size!==orderedTaskIds.length-1||
    id!==orderedTaskIds[ordinal])deny();
 const isValidator=id===validatorTaskId;
 // Exact editor IDs are pinned by the approved D1 plan, not model or A2A.
 if(isValidator){
  if(role!=="test"||editors.has(id))deny();
 }else{
  const editor=editors.get(id);
  if(!editor||editor.role!==role||!ROLES.has(editor.role))deny();
 }
}
