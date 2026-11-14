/**
 * R385.6 — deterministic owner-side gate for model-selected UPDATE after an
 * independently attested Runner FAIL. A read Task is not proof just because
 * a model reports one: only the original owner supplies signed Task rows,
 * Gateway completion and an independently corroborated source digest.
 * No I/O, new grants, model inference or credential issuance here.
 */
import {SPECIALIST_ROLES} from "../../plan-contracts/src/agent-roles.mjs";
const SHA=/^[a-f0-9]{40}$/u, HASH=/^[a-f0-9]{64}$/u;
const TASK=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const deny=()=>{throw Error("R385.6 signed diagnostic repair NO-GO");};
export function selectTrustedRepairDiagnosticRead({
 repairTask,failedEpoch,currentHead,readRecords
}={}){
 if(!repairTask||!TASK.test(repairTask.task_id??"")||
    !SPECIALIST_ROLES.includes(repairTask.agent_id)||
    !Array.isArray(repairTask.permissions)||
    !SHA.test(currentHead??"")||
    !Number.isSafeInteger(failedEpoch)||failedEpoch<1||
    !Array.isArray(readRecords)||readRecords.length>4)deny();
 const updates=repairTask.permissions.filter(x=>x?.operation==="update_file");
 if(updates.length!==1||typeof updates[0].resource!=="string"||
    !updates[0].resource.startsWith("gitea://")||
    repairTask.permissions.some(x=>!["read_file","update_file"].includes(x?.operation)||
     x.resource!==updates[0].resource))deny();
 const target=updates[0].resource;
 const eligible=readRecords.filter(row=>{
  if(!row||!TASK.test(row.task_id??"")||
     !SPECIALIST_ROLES.includes(row.agent_id)||
     !Number.isSafeInteger(row.epoch)||row.epoch<=failedEpoch||
     row.epoch>=256||!SHA.test(row.revision??"")||
     !HASH.test(row.evidence_sha256??"")||
     !HASH.test(row.gateway_evidence_sha256??"")||
     typeof row.resource!=="string"||
     typeof row.gateway_task_completed!=="boolean"||
     !Array.isArray(row.signed_permissions))deny();
  if(row.task_id===repairTask.task_id)deny();
  return row.agent_id===repairTask.agent_id&&
   row.revision===currentHead&&row.resource===target&&
   row.gateway_task_completed===true&&
   row.evidence_sha256===row.gateway_evidence_sha256&&
   row.signed_permissions.length===1&&
   row.signed_permissions[0]?.operation==="read_file"&&
   row.signed_permissions[0]?.resource===target;
 });
 // No ambiguous provenance. A new, independently read Task is required
 // after the latest failed Runner Task and at the exact target HEAD.
 if(eligible.length!==1)deny();
 const row=eligible[0];
 return Object.freeze({status:"owner_verified_signed_diagnostic_read_for_repair",
  repair_task_id:repairTask.task_id,read_task_id:row.task_id,
  agent_id:repairTask.agent_id,resource:target,revision:currentHead,
  evidence_sha256:row.evidence_sha256});
}
