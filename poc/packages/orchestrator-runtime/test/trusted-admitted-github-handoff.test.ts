import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedGithubAdmissionReceiptStore}
  from "../src/trusted-github-admission-store.ts";
import {consumePinnedGithubAdmission,startAdmittedGithubReviewedGeminiHandoff}
  from "../src/trusted-admitted-github-handoff.ts";
import {verifyGithubManualGeminiDispatch}
  from "../src/trusted-manual-github-dispatch.ts";
import {TrustedExecutionCoordinator}
  from "../src/trusted-execution-coordinator.ts";

const repository="DarkGh0st03/delegation";
const ref="refs/heads/refactor/post-prof-plan-contracts-20261021";
const workflow=".github/workflows/trusted-gemini-dispatch-preflight.yml";
const sha="d".repeat(40),runId="39898765432",sessionId="signed-session-oidc";
const pins={repository,ref,sourceSha:sha,runId,sessionId};
const dispatch=verifyGithubManualGeminiDispatch({
  pinned:{repository,ref,workflowPath:workflow,sourceSha:sha},
  env:{
    GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
    GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:repository,
    GITHUB_REF:ref,GITHUB_WORKFLOW_REF:repository+"/"+workflow+"@"+ref,
    GITHUB_SHA:sha,GITHUB_RUN_ID:runId
  },
  event:{repository:{full_name:repository},ref,inputs:{
    authorization:"I AUTHORIZE GEMINI API CHARGES",
    model:"gemini-3.8-flash",max_model_turns:"12",
    max_output_tokens:"16000",max_model_call_ms:"120000"
  }}
});
const job={
  kind:"github_actions_oidc_verified" as const,
  jti:"test-verified-no-live-oidc",
  run_id:runId,workflow_sha:sha,repository_id:"1374168963",
  repository_owner_id:"150908952",audience:"test-trusted-private"
};

async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"admitted-handoff-"));
  const config={directory,hmacSecret:Buffer.alloc(32,9),
    expectedSessionId:sessionId};
  const intake=new TrustedGithubAdmissionReceiptStore(config);
  await intake.record({dispatch,job});
  return {directory,host:new TrustedGithubAdmissionReceiptStore(config)};
}

test("HMAC-bound OIDC admission supplies only capped inputs and is one-use across restarts",async()=>{
  const {directory,host}=await fixture();
  try{
    const result=await consumePinnedGithubAdmission({
      admissionStore:host,pins
    });
    assert.deepEqual(result,{
      status:"github_oidc_admitted_only_not_engineer_approved",
      session_id:sessionId,run_id:runId,source_sha:sha,
      model_name:"gemini-3.8-flash",max_model_turns:12,
      max_output_tokens:16000,max_model_call_ms:120000,
      authorization_input:"I AUTHORIZE GEMINI API CHARGES"
    });
    assert.ok(Object.isFrozen(result));
    for(const secret of ["oidcJwt","geminiApiKey","privateKeyPem",
                         "operational_root_id","approved_permission_ids"])
      assert.ok(!(secret in result));
    await assert.rejects(consumePinnedGithubAdmission({
      admissionStore:host,pins
    }),/already consumed/);
    assert.equal((await readdir(directory)).length,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("host-pinned repository/ref mismatch fails closed and consumes the admission",async()=>{
  const {directory,host}=await fixture();
  try{
    await assert.rejects(consumePinnedGithubAdmission({
      admissionStore:host,pins:{...pins,repository:"attacker/delegation"}
    }),/independently pinned repository\/ref/);
    await assert.rejects(consumePinnedGithubAdmission({
      admissionStore:host,pins
    }),/already consumed/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("missing trusted pins and no active Planning never grant handoff or spend API credits",async()=>{
  const {directory,host}=await fixture();
  try{
    await assert.rejects(consumePinnedGithubAdmission({
      admissionStore:host,pins:{...pins,sourceSha:"bad"}
    }),/independent session\/run\/source pins required/);
    // A real Coordinator in the idle phase cannot pass the Planning gate.
    const idle=new TrustedExecutionCoordinator({
      authority:{} as any,approvedGatewayPlans:{} as any,
      credentials:{} as any,sessionId,baseRevision:sha
    });
    await assert.rejects(startAdmittedGithubReviewedGeminiHandoff({
      coordinator:idle,reviewGate:null as any,
      checkpointStore:null as any,
      admissionStore:host,pins,geminiApiKey:"unused-offline-only",
      transports:null as any,ports:null as any,
      operationalRoot:null as any
    }),/active trusted Coordinator, backend checkpoint/);
    // No authentication token or operational authorization was consumed.
    assert.equal((await readdir(directory)).length,1);
    const result=await consumePinnedGithubAdmission({
      admissionStore:host,pins
    });
    assert.equal(result.session_id,sessionId);
  }finally{await rm(directory,{recursive:true,force:true});}
});
