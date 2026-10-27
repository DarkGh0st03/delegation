/**
 * Nonbillable, standalone FUNCTIONAL checkpoint for the REAL signed-plan
 * Gitea/Docker E2E. Parse ONLY fixed, internally generated summary events.
 * This is NOT raw trace publication, independent runtime attestation,
 * authentic human consent, Gemini inference or distributed R5 GO.
 *
 * No untrusted stdout/stderr text is retained in the artifact.
 */
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const SHA=/^[0-9a-f]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const EVENT="trusted_security_ci_real_docker_positive_acceptance";
const NATIVE_PREFIX="[trusted-positive-ci] native_disposable_planning ";
function deny(message){
  throw Error("Functional signed-DAG E2E NO-GO: "+message);
}
function record(value){
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
function exactlyOne(array,label){
  if(array.length!==1)deny("expected exactly one "+label+" from real process");
  return array[0];
}
function requireTrue(data,fields,label){
  for(const field of fields)
    if(data[field]!==true)deny(label+" missing: "+field);
}
export function extractSignedFunctionalE2EEvidence(text,{
  scenarioId="department-directory",sourceSha,runId
}={}){
  if(typeof text!=="string"||text.length===0||
     text.length>10*1024*1024||
     !SHA.test(sourceSha??"")||!RUN.test(String(runId??""))||
     scenarioId!=="department-directory")
    deny("one fixed scenario, exact checked-out SHA and GitHub run required");
  const positives=[],natives=[];
  for(const line of text.split(/\r?\n/u)){
    let data;
    if(line.startsWith(NATIVE_PREFIX)){
      try{data=JSON.parse(line.slice(NATIVE_PREFIX.length));}
      catch{deny("malformed original signed-DAG summary");}
      natives.push(data);
    }else if(line.startsWith('{"event":"'+EVENT+'"')){
      try{data=JSON.parse(line);}
      catch{deny("malformed real Docker acceptance summary");}
      positives.push(data);
    }
  }
  const native=exactlyOne(natives,"original signed-DAG observation");
  const acceptance=exactlyOne(positives,"real Docker/Gitea acceptance");
  if(!record(native)||native.status!=="PASS"||
     !SHA.test(native.real_gitea_sha??"")||
     native.real_gitea_sha===acceptance.tested_commit_sha)
    deny("original signed plan baseline SHA unavailable");
  requireTrue(native,[
    "native_rust","live_opa","signed_handoff","operational_root",
    "dispatcher_fail_closed","signed_dag_positive",
    "same_signed_dag_docker_acceptance"
  ],"original signed-DAG process");
  if(native.backend_frontend_a2a_updates!==10||
     native.test_agent_created_e2e!==1||
     native.signed_generic_adk_agents!==3||
     native.a2a_before_branch!==0||native.main_mutations!==0)
    deny("native signed DAG provider effects or branch isolation absent");
  if(!record(acceptance)||acceptance.event!==EVENT||
     acceptance.status!=="PASS"||acceptance.scenario_id!==scenarioId||
     acceptance.pr_source!=="native_signed_dag"||
     !SHA.test(acceptance.tested_commit_sha??"")||
     !SHA.test(acceptance.baseline_sha??"")||
     acceptance.project_tests!=="pass"||
     acceptance.researcher_acceptance!=="pass"||
     acceptance.merge_calls!==0||
     acceptance.pr_created!==true||
     acceptance.real_backend_frontend_gitea_edits!==2||
     acceptance.native_approved_source_reads!==4||
     acceptance.persistent_gitea_modified!==false||
     JSON.stringify(acceptance.gitea_statuses)!==
       JSON.stringify(["pending","success"]))
    deny("real signed-DAG Gitea/Docker acceptance incomplete");
  requireTrue(acceptance,[
    "real_docker_runner","engineer_approval_ed25519",
    "gateway_signed_test_task_completed","real_a2a_sdk_task_completed",
    "real_opa_signed_plan_policy","native_rust_signed_child_and_vp",
    "runner_via_gateway_http","exact_provider_sha_correlated",
    "approval_created"
  ],"real positive runner");
  return Object.freeze({
    schema:"functional-signed-dag-e2e-checkpoint-v1",
    status:"functional_scripted_real_gitea_docker_pass",
    scenario_id:scenarioId,
    framework_source_sha:sourceSha,github_run_id:String(runId),
    isolated_main_sha:native.real_gitea_sha,
    tested_feature_commit_sha:acceptance.tested_commit_sha,
    approved_dag_implemented_in_disposable_gitea:true,
    signed_test_fixture_ed25519:true,
    native_rust_vp_and_opa:true,
    three_scripted_adk_a2a_agents:true,
    created_pull_request_unmerged:true,
    isolated_docker_project_tests:"pass",
    isolated_researcher_acceptance:"pass",
    operational_root_revocation_reported_by_positive_dag:true,
    live_gemini_tested:false,
    genuine_human_engineer_approval_tested:false,
    private_distributed_r5_tested:false,
    external_r5_go:false
  });
}
if(process.argv[1]&&import.meta.url===
   pathToFileURL(resolve(process.argv[1])).href){
  try{
    const file=process.argv[2],out=process.argv[3];
    if(!file||!out||process.argv.length!==4)deny("exact log and output paths required");
    const raw=await readFile(file,"utf8");
    const evidence=extractSignedFunctionalE2EEvidence(raw,{
      scenarioId:"department-directory",
      sourceSha:process.env.GITHUB_SHA,
      runId:process.env.GITHUB_RUN_ID
    });
    await writeFile(out,JSON.stringify(evidence,null,2)+"\n",
      {flag:"wx",mode:0o600});
    process.stdout.write("Functional signed DAG E2E checkpoint PASS "+
      "("+evidence.scenario_id+"); no Gemini, no R5 GO\n");
  }catch{
    process.stderr.write("Functional signed-DAG E2E NO-GO\n");
    process.exitCode=1;
  }
}
