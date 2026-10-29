import test from "node:test";
import assert from "node:assert/strict";
import {classifySafeGeminiPilotFailure} from
  "../signed-gemini-pilot-failure-observation.mjs";
const PHASES=[
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"
];
const docker=(failed)=>({
  status:"fail",first_failed_phase:failed,
  phases:PHASES.map(p=>({phase:p,status:p===failed?"fail":
    PHASES.indexOf(p)<PHASES.indexOf(failed)?"pass":"skipped"})),
  typecheck_error_codes:["TS2304","TS2688"],
  raw_output:"PRIVATE_TS_SOURCE_DO_NOT_LEAK"
});

test("Compiler failure is observed but never attributed to Gemini reasoning",()=>{
  const result=classifySafeGeminiPilotFailure({
    docker_phase_evidence:docker("typecheck"),
    gemini_pilot_diagnostic:{
      stage:"delegated_agents_gitea_docker",category:"unclassified_failure",
      planning_rejection:{reason:"execution_dag_incompatible"},
      private_source:"PRIVATE_SOURCE"
    }
  });
  assert.deepEqual(result,{
    observed_failure:"docker_typecheck_failure",
    first_failed_phase:"typecheck",
    causal_attribution:"not_established"
  });
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.ok(!JSON.stringify(result).includes("execution_dag_incompatible"));
});
test("A later failure phase remains separate from compiler and model attribution",()=>{
  assert.deepEqual(classifySafeGeminiPilotFailure({
    docker_phase_evidence:docker("playwright_e2e")
  }),{
    observed_failure:"docker_other_phase_failure",
    first_failed_phase:"playwright_e2e",
    causal_attribution:"not_established"
  });
});
test("Provider failure and actual Planning rejection use separate observations",()=>{
  assert.deepEqual(classifySafeGeminiPilotFailure({
    gemini_pilot_diagnostic:{stage:"gemini_planning",
      category:"model_provider_failure",model_failure:"quota_or_rate_limit"}
  }),{
    observed_failure:"model_provider_failure_reported",
    model_failure_category:"quota_or_rate_limit",
    causal_attribution:"not_established"
  });
  assert.deepEqual(classifySafeGeminiPilotFailure({
    gemini_pilot_diagnostic:{stage:"gemini_planning",
      category:"planner_contract_rejected",
      planning_rejection:{stage:"contract",reason:"invalid_permissions"}}
  }),{
    observed_failure:"planner_contract_rejection_reported",
    causal_attribution:"not_established"
  });
});
test("A recovered earlier draft rejection is not a new Planning failure",()=>{
  assert.deepEqual(classifySafeGeminiPilotFailure({
    gemini_pilot_diagnostic:{stage:"delegated_agents_gitea_docker",
      category:"unclassified_failure",
      planning_rejection:{stage:"contract",reason:"execution_dag_incompatible"}}
  }),{
    observed_failure:"delegated_execution_failure_unclassified",
    causal_attribution:"not_established"
  });
});
test("Untrusted and inconsistent phase markers fail closed",()=>{
  const secret="SENSITIVE_STACK_OR_COMPILER_OUTPUT";
  const malformed=[
    {...docker("typecheck"),first_failed_phase:"build"},
    {...docker("typecheck"),phases:[{phase:secret,status:"fail"}]},
    {...docker("typecheck"),phases:PHASES.map(p=>({
      phase:p,status:"skipped"}))},
    {...docker("typecheck"),status:"success"}
  ];
  for(const d of malformed){
    const result=classifySafeGeminiPilotFailure({
      docker_phase_evidence:d,
      gemini_pilot_diagnostic:{stage:"gemini_plan_proposed",
        category:"unclassified_failure",model_failure:secret}
    });
    assert.deepEqual(result,{
      observed_failure:"failure_without_verified_phase",
      causal_attribution:"not_established"
    });
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});
test("Unknown provider error strings never leave failure observation",()=>{
  const result=classifySafeGeminiPilotFailure({
    gemini_pilot_diagnostic:{stage:"gemini_planning",
      category:"model_provider_failure",model_failure:"PRIVATE_EXCEPTION"}
  });
  assert.deepEqual(result,{
    observed_failure:"failure_without_verified_phase",
    causal_attribution:"not_established"
  });
});
