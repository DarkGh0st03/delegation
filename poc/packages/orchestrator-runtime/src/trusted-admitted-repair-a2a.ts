/**
 * R135: owner-only, one-shot A2A dispatch for a fresh R133-admitted repair
 * Task. Reuses R134's actual Rust child issuance and the ordinary protected
 * A2A runner. A2A "completed" is NOT Gateway completion / Docker PASS.
 * No model tool, MCP operation or remote command exposes this entry point.
 */
import {randomBytes} from "node:crypto";
import {approvedWorkBranch} from
 "../../plan-contracts/src/approved-work-branch.mjs";
import type {DeterministicSubtask} from "@thesis/agent-runtime";
import {DelegatedA2ARoleRunner,type ChildAuthorityIssuerPort,
 type ProtectedA2AClientPort} from "./a2a-workflow.ts";
import {issueAdmittedRepairTaskChild} from "./trusted-admitted-repair-child.ts";

type RepairInput=Parameters<typeof issueAdmittedRepairTaskChild>[0];
type Role=RepairInput["role"];
const fail=(s:string):never=>{throw Error("R135 repair A2A NO-GO: "+s);};
const pair=(x:{operation:string;resource:string})=>
 JSON.stringify([x.operation,x.resource]);
const SHA=/^[a-f0-9]{64}$/u;
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}

export async function dispatchTrustedAdmittedRepairA2A(config:
 Omit<RepairInput,"runtimeTaskId">&{
  agentBaseUrls:Readonly<Record<Role,string>>;
  a2a:ProtectedA2AClientPort;
 }):Promise<Readonly<{
 status:"a2a_artifact_unconfirmed";
 task_id:string;runtime_task_id:string;epoch:number;
 credential_id:string;artificial_provider_success:false;
 gateway_task_completed:false;docker_pass_verified:false;
 a2a_result:Awaited<ReturnType<DelegatedA2ARoleRunner["issueAndRun"]>>;
 }>>{
 if(!config||!config.a2a||
    typeof config.a2a.sendProtectedTask!=="function"||
    !config.agentBaseUrls)
  fail("owner-private A2A port and pinned Agent Cards required");
 const url=config.agentBaseUrls[config.role];
 if(typeof url!=="string"||!/^https?:\/\/[^/\s]+/u.test(url)||
    url.includes("@")||url.includes("#"))
  fail("trusted Agent Card endpoint unavailable");
 // The original signed Engineer approval, NOT the model, pins agent IDs,
 // DIDs and card references across all subsequent operational epochs.
 const history=await config.intake.verifiedEpochHistory();
 const current=history.at(-1);
 const original=history[0]?.plan;
 if(!current||current.epoch!==config.epoch||
    current.plan_digest!==config.planDigest||
    !SHA.test(current.plan_digest)||!original)
  fail("no current independently verified repair DAG");
 const agent=original.candidate_agents.find(
  (x:{agent_id:string})=>x.agent_id===config.role);
 const currentAgent=current.plan.candidate_agents.find(
  (x:{agent_id:string})=>x.agent_id===config.role);
 if(!agent||!currentAgent||agent.did!==currentAgent.did||
    agent.card_ref!==currentAgent.card_ref||
    typeof agent.card_ref!=="string"||!agent.card_ref.trim())
  fail("repair Agent Card identity differs from original Engineer approval");
 const task=current.plan.tasks.find(
  (x:{id:string})=>x.id===config.taskId);
 if(!task||task.agent_id!==config.role||
    !Array.isArray(task.depends_on)||
    typeof task.description!=="string"||!task.description.trim())
  fail("repair Task must be a signed specialized plan node");
 const rows=current.plan.requested_permissions.filter(
  (x:{task_id:string;agent_id:string})=>
   x.task_id===config.taskId&&x.agent_id===config.role
 );
 if(!rows.length||rows.length>32)
  fail("repair Task permission set missing or unbounded");
 const branch=approvedWorkBranch(current.plan);
 const repo=current.plan.repository;
 const root="gitea://"+repo.authority+"/"+repo.owner+"/"+repo.repository;
 const branchUri=root+"/branches/"+encodeURIComponent(branch);
 const prefix=branchUri+"/files/";
 const relevant=new Set<string>();
 const filePermissions:Array<{
  operation:"read_file"|"update_file"|"create_file";path:string
 }>=[];
 let runTests=false;
 const seen=new Set<string>();
 for(const row of rows){
  if(seen.has(pair(row)))fail("duplicate repair permission");
  seen.add(pair(row));
  if(row.resource===branchUri&&row.operation==="run_tests"){
   runTests=true;continue;
  }
  if(!row.resource.startsWith(prefix)||!(
   ["read_file","update_file","create_file"].includes(row.operation)))
   fail("model cannot turn root-level or foreign grant into specialized A2A");
  const enc=row.resource.slice(prefix.length);
  let path:string;
  try{path=enc.split("/").map(decodeURIComponent).join("/");}
  catch{fail("malformed signed repair file URI");}
  if(!path||path.startsWith("/")||path.split("/").some(
   x=>!x||x==="."||x===".."||x.includes("\\")))
   fail("unsafe path in signed repair permission");
  relevant.add(path);
  filePermissions.push({path,operation:row.operation});
 }
 if(relevant.size>32||filePermissions.length>32||
    (config.role==="test"&&!runTests&&!filePermissions.length)||
    (config.role!=="test"&&runTests))
  fail("incompatible repair Agent role or oversized file scope");
 const subtask:DeterministicSubtask={
  subtask_id:config.taskId,instruction:task.description,
  branch,relevant_paths:[...relevant],
  approved_file_permissions:filePermissions,
  ...(config.role==="test"?{approved_run_tests:runTests}:{})
 };
 // The true Gateway registry independently attests predecessor Tasks.
 // An LLM-proposed or merely journalled DAG cannot make a Test ready.
 await config.gateway.assertRepairTaskReady({
  session_id:config.sessionId,plan_digest:config.planDigest,
  epoch:config.epoch,plan_task_id:config.taskId,role:config.role
 });
 // Pre-dispatch Gateway ID is generated only by the trusted owner.
 const runtimeTaskId="dispatch_"+randomBytes(16).toString("base64url");
 const issued=await issueAdmittedRepairTaskChild({
  ...config,runtimeTaskId
 });
 const issuedRoot=config.coordinator.trustedOperationalAuthority();
 const assertActive=()=>{
  if(config.coordinator.phase!=="execution")
   fail("operational root revoked before protected A2A");
  const actual=config.coordinator.trustedOperationalAuthority();
  if(issuedRoot.credential_id!==actual.credential_id||
     issuedRoot.plan_digest!==actual.plan_digest)
   fail("operational root changed before protected A2A");
 };
 // An adapter into the ORIGINAL role runner, not an issuer: Rust already
 // minted and durably acknowledged the child in R134 exactly once.
 let delivered=false;
 const preissued:ChildAuthorityIssuerPort={
  assertActiveBeforeA2ASend:assertActive,
  async issueSpecializedChild(input){
   if(delivered)fail("preissued child cannot be replayed");
   delivered=true;
   if(input.parent_credential_id!==issuedRoot.credential_id||
      input.credential_id!==issued.credential_id||
      input.approved_task_id!==config.taskId||
      !same(input.selection,{role:config.role})||
      input.valid_from!==config.credential.valid_from||
      input.validity_seconds!==config.credential.validity_seconds||
      !same(input.credential_status,config.credential.credential_status))
    fail("preissued Rust child cannot be rebound to another A2A Task");
   return {role:config.role,credential:issued.credential};
  }
 };
 const runner=new DelegatedA2ARoleRunner({
  authorityIssuer:preissued,a2a:config.a2a
 });
 const result=await runner.issueAndRun({
  role:config.role,approved_task_id:config.taskId,
  parent_credential_id:issuedRoot.credential_id,
  credential_id:issued.credential_id,
  valid_from:config.credential.valid_from,
  validity_seconds:config.credential.validity_seconds,
  credential_status:config.credential.credential_status,
  agent_base_url:url,trusted_gateway_task_id:runtimeTaskId,
  subtask
 });
 assertActive();
 const after=await config.intake.verifiedEpochHistory();
 if(after.length!==history.length||
    after.at(-1)?.plan_digest!==current.plan_digest)
  fail("epoch changed while A2A was in flight; no completion proof");
 // Gateway and Runner attestation must happen INDEPENDENTLY after A2A.
 return Object.freeze({
  status:"a2a_artifact_unconfirmed" as const,
  task_id:config.taskId,runtime_task_id:runtimeTaskId,
  credential_id:issued.credential_id,epoch:config.epoch,
  artificial_provider_success:false as const,
  gateway_task_completed:false as const,
  docker_pass_verified:false as const,
  a2a_result:result
 });
}
