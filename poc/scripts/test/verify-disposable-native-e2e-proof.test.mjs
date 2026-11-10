import test from "node:test";
import assert from "node:assert/strict";
import {verifyDisposableNativeScriptedE2EProof as verify}
 from "../verify-disposable-native-e2e-proof.mjs";

const DENIED=/Disposable original native SCRIPTED E2E proof NO-GO/u;
const SHA="a".repeat(40);
function validRecords(){
 return [
  {event:"canonical_deployment_native_preflight",status:"pass"},
  {
   event:"r38513_final_test_decision_preflight",
   completed_count:22,last_cas_completed:true,
   failed_test_misreported_completed:false,
   retest_already_completed:false,
   initial_test_failure_attested:true,
   proposed_depends_on_last_cas:true,proposed_retest_id_new:true
  },
  {event:"canonical_signed_handoff_native",status:"pass"},
  {
   event:"r399_native_draft_pr_exact_head_security_ci",
   actual_native_draft_pr:true,original_root_pr_unchanged:true,
   real_disposable_gitea:true,exact_sha:true,
   independent_ci_actor:true,
   real_ci_docker_tests_and_researcher_acceptance:"pass",
   exact_context_pending_then_success:true,
   read_only_human_gate_denied_draft:true,
   real_protected_main:true,branch_unchanged:true,main_unchanged:true,
   no_merge:true,paid_model_calls:0
  },
  {
   event:"r38513_native_ten_signed_reads_ten_cas_docker_pass_draft_pr",
   status:"pass",strict_postfail_diagnostic_read_count:10,
   individually_signed_repair_tasks:10,
   original_owner_adaptive_decisions:25,native_child_count:24,
   latest_test_pass_same_head:true,no_extra_child_for_terminal_decision:true,
   scripted_adk_planning_calls_in_native_host:2,
   scripted_adk_adaptive_calls_in_native_host:25,
   observed_model_source:"scripted-offline",
   model_generated_source_proven:false,
   recovery_source_code_authored_by_scripted_fixture:true,
   source_code_generated_autonomously_by_model:false,
   feature_branch_created_from_original_root:true,
   independent_branch_get:true,original_main_immutable:true,
   native_rust_evm:true,real_opa:true,
   r3818_canonical_private_mcp_native_signing:true,
   first_docker_status:"fail",first_failure_independent:true,
   second_docker_status:"pass",researcher_acceptance_pass:true,
   functional_source_files_updated:7,updated_project_test_files:3,
   cas_writes:12,authenticated_runner_fail_receipts:1,
   authenticated_runner_pass_receipts:1,
   distinct_child_credentials:24,original_engineer_approval_count:1,
   original_engineer_ci_approval_from_actual_planning_checkpoint:false,
   original_root_pr_created:true,independent_pr_get:true,
   pr_draft:true,pr_open:true,pr_merged:false,paid_model_calls:0,
   registered_tasks:26,completed_gateway_tasks:25,
   native_mcp_child_issuances:24,
   native_mcp_presentations_by_role:{backend:12,frontend:8,test:4},
   tested_head:SHA
  }
 ];
}
const toJSONL=records=>records.map(x=>JSON.stringify(x)).join("\n")+"\n";
const expectRejection=(records)=>{
 assert.throws(()=>verify(toJSONL(records)),DENIED);
};

test("same-run original Rust/Gitea/Docker/Draft PR proof remains explicitly SCRIPTED",()=>{
 const output=verify(toJSONL(validRecords()));
 assert.equal(output.status,"pass");
 assert.equal(output.evidence_class,
  "real_native_e2e_with_scripted_agent_outputs");
 assert.equal(output.exact_three_specialist_roles,true);
 assert.equal(output.original_signed_engineer_approvals,1);
 assert.equal(output.original_ci_review_after_planning_attested,false);
 assert.equal(output.native_mcp_child_issuances,24);
 assert.equal(output.first_real_docker,"fail");
 assert.equal(output.second_real_docker,"pass");
 assert.equal(output.independent_pr_security_ci,"pass");
 assert.equal(output.tested_gitea_commit_sha,SHA);
 assert.equal(output.model_source,"scripted-offline");
 assert.equal(output.source_autonomously_generated_by_gemini_proven,false);
 assert.equal(output.actual_gemini_provider_calls,0);
 assert.equal(output.permission_to_start_paid_gemini,false);
 assert.equal(Object.isFrozen(output),true);
});

test("missing/duplicate or malformed original events cannot produce positive proof",()=>{
 const valid=validRecords();
 for(let i=0;i<valid.length;i++)
  expectRejection(valid.filter((_,j)=>j!==i));
 expectRejection([...valid,valid[3]]);
 assert.throws(()=>verify("not JSON\n"+toJSONL(valid)),DENIED);
 assert.throws(()=>verify(JSON.stringify([])+"\n"+toJSONL(valid)),DENIED);
 assert.throws(()=>verify(""),DENIED);
 assert.throws(()=>verify(" ".repeat(2_000_001)),DENIED);
});

test("scripted output cannot be promoted into authentic Gemini source provenance",()=>{
 const mutations=[
  ["observed_model_source","gemini-3.8-flash"],
  ["model_generated_source_proven",true],
  ["source_code_generated_autonomously_by_model",true],
  ["recovery_source_code_authored_by_scripted_fixture",false],
  ["paid_model_calls",1],
  ["original_engineer_approval_count",0]
 ];
 for(const [name,value] of mutations){
  const rows=validRecords();rows[4][name]=value;
  expectRejection(rows);
 }
});

test("signed Root/Child/Gateway evidence cannot be substituted by mere CI success",()=>{
 const mutations=[
  ["native_rust_evm",false],
  ["native_child_count",23],
  ["r3818_canonical_private_mcp_native_signing",false],
  ["native_mcp_child_issuances",23],
  ["native_mcp_presentations_by_role",{backend:12,frontend:8}],
  ["native_mcp_presentations_by_role",{backend:12,frontend:8,test:0}],
  ["distinct_child_credentials",23],
  ["first_failure_independent",false],
  ["original_owner_adaptive_decisions",24],
  ["registered_tasks",0],
  ["completed_gateway_tasks",0]
 ];
 for(const [name,value] of mutations){
  const rows=validRecords();rows[4][name]=value;
  expectRejection(rows);
 }
});

test("human Engineer gate, same-head Docker PASS and Draft PR are mandatory",()=>{
 const primary=[
  ["pr_draft",false],["pr_merged",true],
  ["original_main_immutable",false],
  ["latest_test_pass_same_head",false],
  ["first_docker_status","pass"],
  ["second_docker_status","fail"],
  ["authenticated_runner_pass_receipts",0],
  ["independent_pr_get",false],
  ["tested_head","invalid"],
  ["cas_writes",11]
 ];
 for(const [name,value] of primary){
  const rows=validRecords();rows[4][name]=value;
  expectRejection(rows);
 }
 const security=[
  ["actual_native_draft_pr",false],
  ["exact_sha",false],
  ["independent_ci_actor",false],
  ["read_only_human_gate_denied_draft",false],
  ["no_merge",false],["paid_model_calls",1]
 ];
 for(const [name,value] of security){
  const rows=validRecords();rows[3][name]=value;
  expectRejection(rows);
 }
 const retest=[
  ["last_cas_completed",false],
  ["failed_test_misreported_completed",true],
  ["initial_test_failure_attested",false],
  ["retest_already_completed",true],
  ["proposed_depends_on_last_cas",false]
 ];
 for(const [name,value] of retest){
  const rows=validRecords();rows[1][name]=value;
  expectRejection(rows);
 }
});

test("unrelated extra informational native events do not serve as missing native evidence",()=>{
 const rows=validRecords();
 const evidence=verify(toJSONL([{event:"r375_runner_sanitized_result",
  status:"pass"},...rows]));
 assert.equal(evidence.status,"pass");
 expectRejection([{event:"unverified_no_model_task_claim",status:"pass"},
  ...rows.filter(x=>x.event!=="canonical_signed_handoff_native")]);
});

// The live-workflow's FREE scripted-native mode must NOT accept the old
// prewritten Engineer fixture, even if Rust/Child/Gitea/Docker all pass.
test("explicit original after-Planning CI review is mandatory for scripted-native gate",()=>{
 const records=validRecords();
 assert.throws(()=>verify(toJSONL(records),{
  requirePostPlanningCiReview:true
 }),DENIED);
 const final=records[4];
 final.original_engineer_ci_approval_from_actual_planning_checkpoint=true;
 const accepted=verify(toJSONL(records),{
  requirePostPlanningCiReview:true
 });
 assert.equal(accepted.status,"pass");
 assert.equal(accepted.original_ci_review_after_planning_attested,true);
 assert.equal(accepted.model_source,"scripted-offline");
 assert.equal(accepted.actual_gemini_provider_calls,0);
 assert.equal(accepted.permission_to_start_paid_gemini,false);
 delete final.original_engineer_ci_approval_from_actual_planning_checkpoint;
 expectRejection(records);
 assert.throws(()=>verify(toJSONL(records),{
  requirePostPlanningCiReview:true
 }),DENIED);
 final.original_engineer_ci_approval_from_actual_planning_checkpoint="true";
 expectRejection(records);
 assert.throws(()=>verify(toJSONL(validRecords()),{
  requirePostPlanningCiReview:"true"
 }),DENIED);
});
