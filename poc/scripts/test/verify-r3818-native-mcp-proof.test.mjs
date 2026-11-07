import test from "node:test";
import assert from "node:assert/strict";
import {verifyR3818NativeMcpProof}
 from "../verify-r3818-native-mcp-proof.mjs";

function valid(){
 return {
  event:"r375_original_protected_main_functional_native_docker_pass_draft_pr",
  status:"pass",
  r3818_canonical_private_mcp_native_signing:true,
  native_rust_evm:true,real_opa:true,
  original_main_immutable:true,feature_branch_created_from_original_root:true,
  independent_branch_get:true,original_root_pr_created:true,
  independent_pr_get:true,pr_draft:true,pr_open:true,pr_merged:false,
  researcher_acceptance_pass:true,first_failure_independent:true,
  first_docker_status:"fail",second_docker_status:"pass",
  paid_model_calls:0,
  source_code_generated_autonomously_by_model:false,
  recovery_source_code_authored_by_scripted_fixture:true,
  original_engineer_approval_count:1,pr_post_attempts:1,
  native_mcp_child_issuances:16,distinct_child_credentials:16,
  registered_tasks:18,completed_gateway_tasks:17,
  native_mcp_presentations_by_role:{backend:9,frontend:6,test:2},
  functional_source_files_updated:7,updated_project_test_files:3,
  cas_writes:13,tested_head:"a".repeat(40)
 };
}
const gate=text=>verifyR3818NativeMcpProof(text);
const proof=x=>JSON.stringify(x)+"\n";
const deny=x=>assert.throws(()=>gate(proof(x)),
 /R381.9 native MCP evidence missing or inconsistent/u);

test("R381.9 accepts exactly one complete original Review Host native MCP proof",()=>{
 const evidence=gate("Legacy fixture diagnostic line\n"+proof(valid()));
 assert.equal(evidence.status,"pass");
 assert.equal(evidence.engineer_root_direct_rust,true);
 assert.equal(evidence.native_mcp_child_issuances,16);
 assert.equal(evidence.native_mcp_presentation_roles,3);
 assert.equal(evidence.paid_model_calls,0);
 assert.deepEqual(Object.keys(evidence).sort(),[
  "draft_pr_unmerged","engineer_root_direct_rust","event",
  "independent_docker_fail_then_pass","native_mcp_child_issuances",
  "native_mcp_presentation_roles","native_rust_evm_opa",
  "original_main_immutable","paid_model_calls",
  "real_gitea_and_docker_observed","status"
 ].sort());
});

test("R381.9 rejects zero, duplicate, replaced, or malformed canonical proofs",()=>{
 assert.throws(()=>gate(""),/missing or inconsistent/u);
 assert.throws(()=>gate("No JSONL certificate\n"),/missing or inconsistent/u);
 assert.throws(()=>gate(proof(valid())+proof(valid())),/missing or inconsistent/u);
 deny({...valid(),event:"different_event"});
 deny({...valid(),status:"pending"});
 deny({...valid(),r3818_canonical_private_mcp_native_signing:false});
 deny({...valid(),native_rust_evm:false});
 deny({...valid(),real_opa:false});
});

test("R381.9 rejects any direct/bypassed Child or missing private A2A presentation",()=>{
 deny({...valid(),native_mcp_child_issuances:15});
 deny({...valid(),native_mcp_child_issuances:0});
 deny({...valid(),native_mcp_child_issuances:"16"});
 deny({...valid(),native_mcp_presentations_by_role:{
  backend:9,frontend:6,test:0
 }});
 deny({...valid(),native_mcp_presentations_by_role:{
  backend:9,frontend:6,test:2,orchestrator:1
 }});
 deny({...valid(),native_mcp_presentations_by_role:{
  backend:9,frontend:"6",test:2
 }});
 deny({...valid(),registered_tasks:14});
 deny({...valid(),completed_gateway_tasks:19});
});

test("R381.9 rejects paid calls, fake recovery, mutated main and merged PR",()=>{
 for(const [key,value] of [
  ["paid_model_calls",1],["first_docker_status","pass"],
  ["second_docker_status","skipped"],["pr_merged",true],
  ["original_main_immutable",false],["pr_post_attempts",2],
  ["original_engineer_approval_count",2],
  ["source_code_generated_autonomously_by_model",true],
  ["recovery_source_code_authored_by_scripted_fixture",false],
  ["functional_source_files_updated",0],
  ["updated_project_test_files",0],["cas_writes",1],
  ["tested_head","bad SHA"]
 ]){
  deny({...valid(),[key]:value});
 }
});

test("R381.9 never leaks user/model/credential payload from invalid proof",()=>{
 const text=proof({...valid(),paid_model_calls:1,
  token:"PRIVATE_MCP_SIGNING_SECRET_DO_NOT_PRINT"});
 assert.throws(()=>gate(text),error=>{
  assert.doesNotMatch(String(error),/PRIVATE_MCP_SIGNING_SECRET/u);
  assert.equal(String(error),
   "Error: R381.9 native MCP evidence missing or inconsistent");
  return true;
 });
 assert.throws(()=>gate("x".repeat(2_000_001)),/missing or inconsistent/u);
});
