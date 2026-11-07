/**
 * R381.9 — strict, free, offline proof gate for R381.8 native full-stack.
 *
 * Input is the original Review Host's JSONL summary, NOT a user/model claim.
 * Independently attested Gateway/Gitea/Docker receipts remain required in
 * the upstream E2E; this checker cannot replace their validation.
 * Never print source lines, secrets, signed Child DC/VP or raw tool results.
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const EVENT="r375_original_protected_main_functional_native_docker_pass_draft_pr";
const ROLES=["backend","frontend","test"];
const BOOLS=[
 "r3818_canonical_private_mcp_native_signing",
 "native_rust_evm","real_opa","original_main_immutable",
 "feature_branch_created_from_original_root","independent_branch_get",
 "original_root_pr_created","independent_pr_get",
 "pr_draft","pr_open","researcher_acceptance_pass",
 "first_failure_independent"
];
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
function deny(){
 throw Error("R381.9 native MCP evidence missing or inconsistent");
}

export function verifyR3818NativeMcpProof(text){
 if(typeof text!=="string"||Buffer.byteLength(text,"utf8")>2_000_000)
  deny();
 const rows=[];
 for(const line of text.split(/\r?\n/u)){
  if(!line.trim())continue;
  // Only parse full JSONL lines. Errors from model or provider must not
  // make it into this gate's diagnostic output.
  let candidate;
  try{candidate=JSON.parse(line);}catch{continue;}
  if(isObject(candidate)&&candidate.event===EVENT)rows.push(candidate);
 }
 if(rows.length!==1)deny();
 const p=rows[0];
 if(p.status!=="pass"||BOOLS.some(k=>p[k]!==true)||
    p.first_docker_status!=="fail"||
    p.second_docker_status!=="pass"||
    p.pr_merged!==false||
    p.paid_model_calls!==0||
    p.source_code_generated_autonomously_by_model!==false||
    p.recovery_source_code_authored_by_scripted_fixture!==true||
    p.original_engineer_approval_count!==1||
    p.pr_post_attempts!==1)
  deny();
 if(!natural(p.native_mcp_child_issuances)||
    p.native_mcp_child_issuances<3||
    !natural(p.distinct_child_credentials)||
    p.native_mcp_child_issuances!==p.distinct_child_credentials||
    !natural(p.registered_tasks)||
    !natural(p.completed_gateway_tasks)||
    p.registered_tasks<p.native_mcp_child_issuances||
    p.completed_gateway_tasks>p.registered_tasks)
  deny();
 const counters=p.native_mcp_presentations_by_role;
 if(!isObject(counters)||
    Object.keys(counters).sort().join(",")!=="backend,frontend,test"||
    ROLES.some(role=>!natural(counters[role])||counters[role]<1))
  deny();
 if(!natural(p.functional_source_files_updated)||
    p.functional_source_files_updated<1||
    !natural(p.updated_project_test_files)||
    p.updated_project_test_files<1||
    !natural(p.cas_writes)||
    p.cas_writes<p.functional_source_files_updated)
  deny();
 if(typeof p.tested_head!=="string"||
    !/^[0-9a-f]{40}$/u.test(p.tested_head))
  deny();
 // Sanitized, immutable, content-free certificate.
 return Object.freeze({
  event:"r3819_original_review_host_native_mcp_proof_checked",
  status:"pass",
  native_rust_evm_opa:true,
  engineer_root_direct_rust:true,
  original_main_immutable:true,
  real_gitea_and_docker_observed:true,
  native_mcp_child_issuances:p.native_mcp_child_issuances,
  native_mcp_presentation_roles:ROLES.length,
  independent_docker_fail_then_pass:true,
  draft_pr_unmerged:true,
  paid_model_calls:0
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==3)deny();
  const summary=verifyR3818NativeMcpProof(
   readFileSync(process.argv[2],"utf8"));
  process.stdout.write(JSON.stringify(summary)+"\n");
 }catch{
  process.stderr.write(
   "R381.9 native MCP evidence missing or inconsistent\n");
  process.exitCode=1;
 }
}
