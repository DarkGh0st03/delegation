/**
 * FREE-only original authority-only R385.13 E2E proof gate.
 *
 * The original R385.13 test already executes actual Engineer-signed
 * Root/Child Rust, three native A2A roles, Gitea CAS, real Docker FAIL,
 * repaired Docker PASS, security CI and native Draft PR with SCRIPTED
 * model output. This verifier checks its same-process JSONL disclosures,
 * but DOES NOT attest external identities or independently execute any
 * effects. It must only be used immediately after that E2E process exits 0.
 *
 * IMPORTANT: This is an anti-overclaim gate. Scripted source written through
 * a true native chain is NOT evidence of Gemini-authored source code.
 * No signer, key, provider token, paid inference, Root or PR is constructed.
 */
import {readFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const PROOF_EVENTS=Object.freeze([
 "canonical_deployment_native_preflight",
 "r38513_final_test_decision_preflight",
 "canonical_signed_handoff_native",
 "r399_native_draft_pr_exact_head_security_ci",
 "r38513_native_ten_signed_reads_ten_cas_docker_pass_draft_pr"
]);
const SHA=/^[0-9a-f]{40}$/u;
const deny=()=>{throw Error("Disposable original native SCRIPTED E2E proof NO-GO");};
const object=value=>value!==null&&typeof value==="object"&&
 !Array.isArray(value);
const exact=(value,expected)=>Object.is(value,expected);
function expects(record,expected){
 if(!object(record))deny();
 for(const [key,value] of Object.entries(expected))
  if(!Object.hasOwn(record,key)||!exact(record[key],value))deny();
}
function parseJSONL(contents){
 if(typeof contents!=="string"||contents.length<100||
    contents.length>2_000_000)deny();
 const selected=new Map();
 for(const line of contents.split(/\r?\n/u)){
  if(!line.trim())continue;
  if(line.length>65536)deny();
  let record;
  try{record=JSON.parse(line);}catch{deny();}
  if(!object(record)||typeof record.event!=="string"||
     record.event.length>160)deny();
  if(!PROOF_EVENTS.includes(record.event))continue;
  if(selected.has(record.event))deny();
  selected.set(record.event,record);
 }
 if(PROOF_EVENTS.some(event=>!selected.has(event)))deny();
 return selected;
}

/** Pure verification of existing original test's structured assertions.
 * The field checks cannot establish trust without the independent original
 * E2E, same-run stdout and success exit code enforced by GitHub Actions.
 */
export function verifyDisposableNativeScriptedE2EProof(contents,{
 requirePostPlanningCiReview=false
}={}){
 if(typeof requirePostPlanningCiReview!=="boolean")deny();
 const records=parseJSONL(contents);
 const deployment=records.get("canonical_deployment_native_preflight");
 const review=records.get("canonical_signed_handoff_native");
 const beforeRetest=records.get("r38513_final_test_decision_preflight");
 const security=records.get("r399_native_draft_pr_exact_head_security_ci");
 const result=records.get(
  "r38513_native_ten_signed_reads_ten_cas_docker_pass_draft_pr");
 expects(deployment,{status:"pass"});
 expects(review,{status:"pass"});
 expects(beforeRetest,{
  last_cas_completed:true,
  failed_test_misreported_completed:false,
  retest_already_completed:false,
  initial_test_failure_attested:true,
  proposed_depends_on_last_cas:true,
  proposed_retest_id_new:true
 });
 if(!Number.isSafeInteger(beforeRetest.completed_count)||
    beforeRetest.completed_count<1)deny();
 expects(security,{
  actual_native_draft_pr:true,
  original_root_pr_unchanged:true,
  real_disposable_gitea:true,
  exact_sha:true,
  independent_ci_actor:true,
  real_ci_docker_tests_and_researcher_acceptance:"pass",
  exact_context_pending_then_success:true,
  read_only_human_gate_denied_draft:true,
  real_protected_main:true,
  branch_unchanged:true,main_unchanged:true,no_merge:true,
  paid_model_calls:0
 });
 expects(result,{
  status:"pass",
  strict_postfail_diagnostic_read_count:10,
  individually_signed_repair_tasks:10,
  original_owner_adaptive_decisions:25,
  native_child_count:24,
  latest_test_pass_same_head:true,
  no_extra_child_for_terminal_decision:true,
  scripted_adk_planning_calls_in_native_host:2,
  scripted_adk_adaptive_calls_in_native_host:25,
  observed_model_source:"scripted-offline",
  model_generated_source_proven:false,
  recovery_source_code_authored_by_scripted_fixture:true,
  source_code_generated_autonomously_by_model:false,
  feature_branch_created_from_original_root:true,
  independent_branch_get:true,
  original_main_immutable:true,
  native_rust_evm:true,real_opa:true,
  r3818_canonical_private_mcp_native_signing:true,
  first_docker_status:"fail",
  first_failure_independent:true,
  second_docker_status:"pass",
  researcher_acceptance_pass:true,
  functional_source_files_updated:7,
  updated_project_test_files:3,
  cas_writes:12,
  authenticated_runner_fail_receipts:1,
  authenticated_runner_pass_receipts:1,
  distinct_child_credentials:24,
  original_engineer_approval_count:1,
  original_root_pr_created:true,
  independent_pr_get:true,
  pr_draft:true,pr_open:true,pr_merged:false,
  paid_model_calls:0
 });
 // When the manual disposable route requests its ORIGINAL after-Planning
 // CI signature, refuse a legacy/prewritten approval that still produces a
 // valid native Rust/Gitea/Docker run. Both routes remain SCRIPTED, not AI.
 if(typeof result.original_engineer_ci_approval_from_actual_planning_checkpoint!==
     "boolean"||
    (requirePostPlanningCiReview&&
     result.original_engineer_ci_approval_from_actual_planning_checkpoint!==true))
  deny();
 if(!SHA.test(result.tested_head??"")||
    !Number.isSafeInteger(result.registered_tasks)||
    result.registered_tasks<24||
    !Number.isSafeInteger(result.completed_gateway_tasks)||
    result.completed_gateway_tasks<24||
    result.native_mcp_child_issuances!==result.native_child_count||
    !object(result.native_mcp_presentations_by_role)||
    Object.keys(result.native_mcp_presentations_by_role).sort().join(",")!==
     "backend,frontend,test"||
    Object.values(result.native_mcp_presentations_by_role).some(n=>
     !Number.isSafeInteger(n)||n<1))deny();
 // A green scripted/fixture run can never self-promote to a paid Gemini
 // provenance attestation. The negative claims are mandatory in both
 // the result and the independent native security-CI output.
 return Object.freeze({
  event:"disposable_original_native_scripted_proof_validated",
  status:"pass",
  evidence_class:"real_native_e2e_with_scripted_agent_outputs",
  original_signed_engineer_approvals:1,
  original_ci_review_after_planning_attested:
   result.original_engineer_ci_approval_from_actual_planning_checkpoint,
  exact_three_specialist_roles:true,
  native_mcp_child_issuances:24,
  original_gitea_branch_and_draft_pr_attested:true,
  first_real_docker:"fail",
  second_real_docker:"pass",
  independent_pr_security_ci:"pass",
  tested_gitea_commit_sha:result.tested_head,
  original_main_immutable:true,
  model_source:"scripted-offline",
  source_autonomously_generated_by_gemini_proven:false,
  actual_gemini_provider_calls:0,
  permission_to_start_paid_gemini:false
 });
}

/** CLI is deliberately read-only; printing the short boolean verdict never
 * includes source, prompts, signed credentials, secrets or tool responses.
 */
if(process.argv[1]&&
   resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=process.argv[2];
 if(process.argv.length!==3||typeof file!=="string"||
    !file.startsWith("/")||!file.endsWith(".jsonl"))deny();
 const meta=await stat(file);
 if(!meta.isFile()||meta.size>2_000_000)deny();
 // This env flag is pinned by the original native CI workflow, not by an
 // agent, ADK tool, uploaded evidence file or model output.
 const flag=process.env.R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING;
 if(flag!==undefined&&flag!=="0"&&flag!=="1")deny();
 const verdict=verifyDisposableNativeScriptedE2EProof(
  await readFile(file,"utf8"),{
   requirePostPlanningCiReview:flag==="1"
  });
 process.stdout.write(JSON.stringify(verdict)+"\n");
}
