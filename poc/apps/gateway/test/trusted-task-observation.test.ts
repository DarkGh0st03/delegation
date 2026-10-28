import test from "node:test";
import assert from "node:assert/strict";
import {GatewayCorroboratedTaskAttestor} from "../src/trusted-task-observation.ts";
import type {TrustedCompletionEvidence,TrustedProviderEffect} from
  "../src/approved-execution-plans.ts";

const URI="gitea://gitea.local/thesis/iam-console-poc";
const BRANCH="feature/approved",SHA="a".repeat(40);
const FILE="apps/backend/user.ts";
const resource=URI+"/branches/feature%2Fapproved/files/"+FILE;
function effect(tool:"create_branch"|"update_file"|"run_tests",id:string):TrustedProviderEffect{
  const execution=tool==="create_branch"?{
    provider:"gitea" as const,performed:true as const,tool,
    branch:BRANCH,base_branch:"main",revision:SHA,commit_sha:SHA
  }:tool==="update_file"?{
    provider:"gitea" as const,performed:true as const,tool,
    branch:BRANCH,path:FILE,revision:SHA,commit_sha:SHA,
    blob_sha:"b",precondition_blob_sha:"a"
  }:{
    provider:"runner" as const,performed:true as const,tool,
    branch:BRANCH,revision:SHA,tested_commit_sha:SHA,
    runner_profile:"poc-default" as const,status:"pass" as const,
    phases:[],project_tests:{status:"pass" as const,phases:[]},
    researcher_acceptance:{phase:"researcher_acceptance" as const,status:"pass" as const}
  };
  return {request_id:id,tool,resource:tool==="update_file"?resource:URI,execution};
}
function observation(role:"orchestrator"|"backend"|"test",taskId="a2a-backend"):any{
  if(role==="orchestrator")return {
    source:"trusted_orchestrator",runtime_task_id:taskId,
    role,state:"completed"
  };
  return {
    source:"trusted_a2a_poll",runtime_task_id:taskId,role,state:"completed",
    artifact:{
      branch:BRANCH,revision:SHA,commit_sha:SHA,
      files_modified:role==="backend"?[FILE]:[],files_created:[],
      test_outcome:role==="test"?"pass":"not_run",
      ...(role==="test"?{
        tested_commit_sha:SHA,runner_profile:"poc-default",
        project_tests:"pass",researcher_acceptance:"pass"
      }:{})
    }
  };
}
function evidence(role:"orchestrator"|"backend"|"test",effects:TrustedProviderEffect[],
  obs?:any):TrustedCompletionEvidence{
  return {
    session_id:"session-signed",plan_digest:"b".repeat(64),
    plan_task_id:"backend-task",runtime_task_id:"a2a-backend",role,
    successful_gateway_request_ids:effects.map(x=>x.request_id),
    provider_effects:effects,...(obs?{observation:obs}:{})
  };
}
const attestor=new GatewayCorroboratedTaskAttestor();
test("authenticated Orchestrator observations require independently recorded provider I/O",async()=>{
  const good=effect("create_branch","req-1");
  assert.equal(await attestor.confirmCompleted(evidence("orchestrator",[good],
    observation("orchestrator"))),true);
  assert.equal(await attestor.confirmCompleted(evidence("orchestrator",[good])),false);
  const fake=structuredClone(good);
  (fake.execution as any).performed=false;
  assert.equal(await attestor.confirmCompleted(evidence("orchestrator",[fake],
    observation("orchestrator"))),false);
  assert.equal(await attestor.confirmCompleted(evidence("orchestrator",[],
    observation("orchestrator"))),false);
});

test("A2A completion is corroborated against real Gateway commit and precise path",async()=>{
  const good=effect("update_file","req-2");
  const obs=observation("backend");
  assert.equal(await attestor.confirmCompleted(evidence("backend",[good],obs)),true);
  for(const mutate of [
    (x:any)=>{x.state="running";},
    (x:any)=>{x.role="frontend";},
    (x:any)=>{x.runtime_task_id="other";},
    (x:any)=>{x.artifact.commit_sha="c".repeat(40);x.artifact.revision="c".repeat(40);},
    (x:any)=>{x.artifact.files_modified=["apps/backend/unmodified.ts"];},
    (x:any)=>{x.artifact.branch="main";},
    (x:any)=>{x.source="agent_claim";}
  ]){
    const changed=structuredClone(obs);mutate(changed);
    assert.equal(await attestor.confirmCompleted(evidence("backend",[good],changed)),false);
  }
  const unrelated=structuredClone(good);
  (unrelated.execution as any).path="apps/backend/unrelated.ts";
  assert.equal(await attestor.confirmCompleted(evidence("backend",[unrelated],obs)),false);
  const noEffect=structuredClone(good);
  (noEffect.execution as any).provider="mock";
  assert.equal(await attestor.confirmCompleted(evidence("backend",[noEffect],obs)),false);
  assert.equal(await attestor.confirmCompleted({
    ...evidence("backend",[good],obs),
    successful_gateway_request_ids:["forged-id"]
  }),false);
});

test("Signed Test preparation is a corroborated file edit, not a fabricated passing Runner",async()=>{
  const written=effect("update_file","req-test-prep");
  const obs=observation("test");
  obs.artifact.test_outcome="not_run";
  obs.artifact.files_modified=[FILE];
  delete obs.artifact.tested_commit_sha;
  delete obs.artifact.runner_profile;
  delete obs.artifact.project_tests;
  delete obs.artifact.researcher_acceptance;
  assert.equal(await attestor.confirmCompleted(evidence("test",[written],obs)),true);
  const lies=structuredClone(obs);
  lies.artifact.test_outcome="pass";
  assert.equal(await attestor.confirmCompleted(evidence("test",[written],lies)),false);
  const noWritten=structuredClone(obs);
  noWritten.artifact.files_modified=[];
  assert.equal(await attestor.confirmCompleted(evidence("test",[written],noWritten)),false);
  const wrongRevision=structuredClone(obs);
  wrongRevision.artifact.commit_sha="b".repeat(40);
  wrongRevision.artifact.revision=wrongRevision.artifact.commit_sha;
  assert.equal(await attestor.confirmCompleted(evidence("test",[written],wrongRevision)),false);
  const claimedTests=structuredClone(obs);
  claimedTests.artifact.tested_commit_sha=SHA;
  assert.equal(await attestor.confirmCompleted(evidence("test",[written],claimedTests)),false);
});

test("Test Agent must have Runner pass for exact reported commit and acceptance",async()=>{
  const effectRunner=effect("run_tests","req-3");
  const valid=observation("test");
  assert.equal(await attestor.confirmCompleted(evidence("test",[effectRunner],valid)),true);
  for(const change of [
    (x:any)=>{x.artifact.tested_commit_sha="c".repeat(40);},
    (x:any)=>{x.artifact.project_tests="fail";},
    (x:any)=>{x.artifact.researcher_acceptance="fail";},
    (x:any)=>{x.artifact.test_outcome="not_run";}
  ]){
    const obs=structuredClone(valid);change(obs);
    assert.equal(await attestor.confirmCompleted(evidence("test",[effectRunner],obs)),false);
  }
  const wrongRunner=structuredClone(effectRunner);
  (wrongRunner.execution as any).status="fail";
  assert.equal(await attestor.confirmCompleted(evidence("test",[wrongRunner],valid)),false);
  const oldCommit=structuredClone(effectRunner);
  (oldCommit.execution as any).tested_commit_sha="f".repeat(40);
  assert.equal(await attestor.confirmCompleted(evidence("test",[oldCommit],valid)),false);
});
