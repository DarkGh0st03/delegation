/** F1 source-free fingerprint for equivalent Account Suspension planner inputs.
 * The pinned Git commit identifies file contents, but this manifest does NOT
 * prove the model later chose identical read tools/response envelopes. */
import {createHash} from "node:crypto";
import {accountSuspensionPlanningConfig}
  from "./account-suspension-planning-config.mjs";
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonicalInventory(items,{allowRoot=false}={}){
  if(!Array.isArray(items)||items.some(v=>typeof v!=="string"||
     (v===""&&!allowRoot)||v.length>240)||new Set(items).size!==items.length)
    throw Error("Invalid trusted F1 input inventory");
  return [...items].sort();
}
export function realPlanningParityManifest({snapshot,requirement,workBranch,
  planId}){
  if(!snapshot||!/^[a-f0-9]{40}$/u.test(snapshot.base_revision)||
     !snapshot.repository||typeof requirement!=="string"||
     !requirement.trim()||typeof workBranch!=="string"||
     !workBranch.startsWith("feature/")||
     typeof planId!=="string"||!planId)
    throw Error("Invalid trusted F1 planning input pins");
  const body={
    schema:"f1-parity-v1",
    source_revision:snapshot.base_revision,
    requirement_digest:hash(requirement),
    repository_digest:hash(snapshot.repository),
    inventory_digest:hash({
      files:canonicalInventory(snapshot.files),
      directories:canonicalInventory(snapshot.directories,{allowRoot:true})
    }),
    work_branch_digest:hash(workBranch),
    plan_id_digest:hash(planId),
    profile_digest:hash(accountSuspensionPlanningConfig("pilot")),
    compiler:"compilePlanningProposal",
    validator:"preflightApprovedPilotDag",
    gateway_read_path:"TrustedPlanningGatewayReadPort/CoreRust/OPA/Gitea",
    source_binding:"git_commit_pins_content"
  };
  return Object.freeze({...body,manifest_digest:hash(body)});
}
