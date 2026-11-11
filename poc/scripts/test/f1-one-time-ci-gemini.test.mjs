import test from "node:test";
import assert from "node:assert/strict";
import {CONSENT} from "../run-gemini-planner-fixture.mjs";
import {F1_ONE_TIME_CI_WORKFLOW,isApprovedF1OneTimeCI}
  from "../f1-real-gitea-gemini-probe.mjs";
import {runF1OneTimePaidCI}
  from "../f1-one-time-ci-gemini.mjs";

const workflowEnv={
  GITHUB_ACTIONS:"true",
  GITHUB_WORKFLOW:F1_ONE_TIME_CI_WORKFLOW,
  GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_REF:"refs/heads/refactor/post-prof-plan-contracts-20261021",
  GITHUB_EVENT_NAME:"push",
  GITHUB_RUN_ATTEMPT:"1",
  GITHUB_RUN_ID:"40499987654",
  GEMINI_API_KEY:"unit-test-key-never-actually-used",
  DELEGATION_F1_BILLING_CONSENT:CONSENT,
  DELEGATION_F1_GEMINI_MODEL:"gemini-3.8-flash",
  F1_SESSION:"/tmp/delegation-f1-paid-40499987654",
  DELEGATION_F1_OUTPUT_DIR:
    "/tmp/delegation-f1-paid-40499987654-report"
};
test("F1 actual paid CI exception needs every pinned GitHub origin field",()=>{
  assert.equal(isApprovedF1OneTimeCI({
    githubActions:"true",ciPermit:true,runnerEnv:workflowEnv
  }),true);
  for(const [key,value] of Object.entries({
    GITHUB_ACTIONS:"false",GITHUB_WORKFLOW:"Other workflow",
    GITHUB_REPOSITORY:"other/repo",GITHUB_REF:"refs/heads/main",
    GITHUB_EVENT_NAME:"workflow_dispatch",
    GITHUB_RUN_ATTEMPT:"2",GITHUB_RUN_ID:"0"
  })){
    assert.equal(isApprovedF1OneTimeCI({
      githubActions:"true",ciPermit:true,
      runnerEnv:{...workflowEnv,[key]:value}
    }),false,key);
  }
  assert.equal(isApprovedF1OneTimeCI({
    githubActions:"true",ciPermit:false,runnerEnv:workflowEnv
  }),false);
});
test("F1 one-shot runner passes owner-only key without printing it",async()=>{
  let count=0;
  const result=await runF1OneTimePaidCI({
    env:workflowEnv,executeOwner:async args=>{
      count++;
      assert.equal(args.ciPermit,true);
      assert.equal(args.mode,"--execute");
      assert.equal(args.sessionDirectory,workflowEnv.F1_SESSION);
      assert.equal(args.apiKey,workflowEnv.GEMINI_API_KEY);
      return {status:"unapproved_proposal_observed",
        technical_preflight_pass:true,functional_design_plausible:false,
        functional_review_failed_checks:["explicit_test_implementation"],
        source_revision:"a".repeat(40)};
    }
  });
  assert.equal(count,1);
  assert.equal(result.approved_or_executed,false);
  assert.equal(result.provider_cost,"not_measured");
  assert.doesNotMatch(JSON.stringify(result),/unit-test-key/);
});
test("F1 any missing real key, consent, model or output pin fails before owner session",async()=>{
  for(const update of [
    {GEMINI_API_KEY:""},
    {DELEGATION_F1_BILLING_CONSENT:""},
    {DELEGATION_F1_GEMINI_MODEL:"gemini-fake"},
    {DELEGATION_F1_OUTPUT_DIR:"/tmp/incorrect"},
    {F1_SESSION:"/tmp/not-pinned"},
    {GITHUB_RUN_ATTEMPT:"2"}
  ]){
    let count=0;
    await assert.rejects(runF1OneTimePaidCI({
      env:{...workflowEnv,...update},
      executeOwner:async()=>{count++;throw Error("NEVER EXECUTE");}
    }),/NO-GO/);
    assert.equal(count,0);
  }
});
