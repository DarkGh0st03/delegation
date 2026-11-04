/**
 * Strict release-gate observations for the direct Engineer-owned Rust D1.
 * The child stdout/stderr may contain source, credentials, provider content
 * and compiler output. Never forward arbitrary keys or text to CI logs.
 */
const D1_EVENT="signed_owner_d1_real_backend_test_repair_review";
const FAILURE_PREFIX="[trusted-positive-ci] native_dag_failure ";
const SHA=/^[a-f0-9]{40}$/u;
const PHASES=new Set([
 "dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"
]);
const CATEGORIES=new Set([
 "a2a_task_not_completed","a2a_artifact_invalid",
 "controlled_tool_failure","no_confirmed_revision",
 "a2a_dispatch_failed","orchestrator_task_failed",
 "root_revocation_unconfirmed","dependency_denied","adk_model_failure",
 "a2a_result_mismatch","attestation_effect_race","approved_plan_denied",
 "test_assertion","unclassified"
]);
const MODULES=new Set([
 "native-planning-read-core-evm-e2e",
 "native-approved-planner-dag-positive"
]);
const lines=raw=>typeof raw==="string"
 ?raw.slice(-262144).split(/\r?\n/u):[];

export function safeEmbeddedEngineerD1Success(raw){
 const records=lines(raw);
 for(let i=records.length-1;i>=0;i--){
  const line=records[i];
  if(line.length>4096||!line.startsWith("{"))continue;
  let v;
  try{v=JSON.parse(line);}catch{continue;}
  if(!v||Array.isArray(v)||v.event!==D1_EVENT)continue;
  if(v.status!=="PASS"||
     v.original_rust_root_verified!==true||
     v.independently_admitted_repair_epoch!==true||
     v.original_root_retired!==true||
     v.repaired_docker_pass_verified!==true||
     v.draft_pr_review_only!==true||
     v.merged!==false||
     v.automated_merge_calls!==0||
     v.gemini_calls!==0||
     typeof v.corrected_exact_sha!=="string"||
     !SHA.test(v.corrected_exact_sha))return null;
  return Object.freeze({
   event:"r237_embedded_engineer_signed_d1",status:"PASS",
   repaired_exact_sha:v.corrected_exact_sha,
   native_rust_owner:"single_in_process_engineer",
   original_root_revoked:true,
   signed_d1_epoch_admitted:true,
   same_epoch_repair_docker_pass:true,
   unmerged_draft_review_only:true,
   no_adapter_http:true,
   paid_model_calls:0
  });
 }
 return null;
}

export function safeEmbeddedEngineerD1Failure(raw){
 const records=lines(raw);
 const base={event:"r237_embedded_engineer_signed_d1",status:"FAIL"};
 for(let i=records.length-1;i>=0;i--){
  const line=records[i];
  if(line.length>4096||!line.startsWith(FAILURE_PREFIX))continue;
  let v;
  try{v=JSON.parse(line.slice(FAILURE_PREFIX.length));}
  catch{continue;}
  if(!v||Array.isArray(v)||
     v.stage!=="signed_dag_disposable_docker_acceptance")continue;
  const original=v.assertion_location;
  const location=original&&typeof original==="object"&&
    MODULES.has(original.module)&&
    Number.isSafeInteger(original.line)&&
    original.line>0&&original.line<=2500
    ?{module:original.module,line:original.line}:null;
  const candidate=v.multi_test_diagnostic;
  const cause=candidate&&typeof candidate==="object"&&
    CATEGORIES.has(candidate.cause_category)
    ?candidate.cause_category:"unknown";
  const phase=PHASES.has(v.first_failed_phase)
    ?v.first_failed_phase
    :PHASES.has(candidate?.first_failed_phase)
      ?candidate.first_failed_phase:"unknown";
  return Object.freeze({...base,
   category:"signed_dag_disposable_docker_acceptance",
   first_failed_phase:phase,
   cause_category:cause,
   ...(location?{assertion_location:location}:{})
  });
 }
 return Object.freeze({...base,category:"no_structured_failure_evidence",
  first_failed_phase:"unknown",cause_category:"unknown"});
}
