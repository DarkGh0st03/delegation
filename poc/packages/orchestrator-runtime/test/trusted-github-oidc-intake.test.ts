import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GithubOidcReplayFileStore}
  from "../src/trusted-github-oidc-replay-store.ts";
import {TrustedGithubAdmissionReceiptStore}
  from "../src/trusted-github-admission-store.ts";
import {startTrustedGithubOidcIntakeServer}
  from "../src/trusted-github-oidc-intake.ts";

const repository="DarkGh0st03/delegation";
const ref="refs/heads/refactor/post-prof-plan-contracts-20261021";
const workflow=".github/workflows/trusted-gemini-dispatch-preflight.yml";
const sourceSha="c".repeat(40);
const audience="urn:delegation:private-engineer-admission";
const ownerId="150908952",repoId="1374168963";
const subject="repo:DarkGh0st03@"+ownerId+
  "/delegation@"+repoId+":ref:"+ref;
const pinned={
  repository,ref,workflowPath:workflow,sourceSha
};
const trust={
  expectedAudience:audience,expectedSubject:subject,
  expectedRepositoryId:repoId,expectedOwnerId:ownerId
};
const runId="39890000012";
const env={
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:repository,GITHUB_REF:ref,
  GITHUB_WORKFLOW_REF:repository+"/"+workflow+"@"+ref,
  GITHUB_SHA:sourceSha,GITHUB_RUN_ID:runId
};
const event={
  repository:{full_name:repository},ref,
  inputs:{
    authorization:"I AUTHORIZE GEMINI API CHARGES",
    model:"gemini-3.8-flash",max_model_turns:"12",
    max_output_tokens:"16000",max_model_call_ms:"120000"
  }
};
const keyPair=generateKeyPairSync("rsa",{modulusLength:2048});
const publicJwk=keyPair.publicKey.export({format:"jwk"});
const jwksFetch=(async()=>new Response(JSON.stringify({
  keys:[{...publicJwk,kid:"offline-issuer-1",use:"sig",alg:"RS256"}]
}),{status:200})) as typeof fetch;
function makeJwt(overrides:Record<string,unknown>={}){
  const now=Math.floor(Date.now()/1000);
  const claims={
    iss:"https://token.actions.githubusercontent.com",
    aud:audience,sub:subject,
    iat:now-10,nbf:now-5,exp:now+120,
    jti:"test-job-token-"+now+"-"+Math.random().toString(16).slice(2),
    repository,repository_id:repoId,
    repository_owner_id:ownerId,
    ref,ref_type:"branch",sha:sourceSha,
    workflow_sha:sourceSha,
    workflow_ref:repository+"/"+workflow+"@"+ref,
    event_name:"workflow_dispatch",run_id:runId,
    run_attempt:"1",...overrides
  };
  const h=Buffer.from(JSON.stringify({
    alg:"RS256",kid:"offline-issuer-1",typ:"JWT"
  })).toString("base64url");
  const p=Buffer.from(JSON.stringify(claims)).toString("base64url");
  const message=h+"."+p;
  return message+"."+sign("RSA-SHA256",
    Buffer.from(message),keyPair.privateKey).toString("base64url");
}
const githubRunFetch=(async()=>new Response(JSON.stringify({
  id:Number(runId),event:"workflow_dispatch",run_attempt:1,
  status:"in_progress",head_sha:sourceSha,
  head_branch:ref.slice("refs/heads/".length),
  path:workflow,head_repository:{full_name:repository},
  created_at:new Date().toISOString()
}),{status:200})) as typeof fetch;

test("loopback trusted admission independently validates OIDC and run, consumes replay, never authorizes Gemini",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"trusted-oidc-admission-"));
  const replayStore=new GithubOidcReplayFileStore(directory);
  const admissionStore=new TrustedGithubAdmissionReceiptStore({
    directory,hmacSecret:Buffer.alloc(32,37),
    expectedSessionId:"engineer-session-001"
  });
  const server=await startTrustedGithubOidcIntakeServer({
    pinned,trust,replayStore,admissionStore,
    githubApiToken:"local-read-only-github",
    oidcJwksFetchFn:jwksFetch,githubApiFetchFn:githubRunFetch,port:0
  });
  try{
    assert.match(server.baseUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
    const body={env,event,oidcJwt:makeJwt()};
    const send=async(payload:unknown,endpoint=server.endpoint)=>{
      const response=await fetch(endpoint,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify(payload)
      });
      return {status:response.status,body:await response.json()};
    };
    const granted=await send(body);
    assert.equal(granted.status,200);
    assert.deepEqual(granted.body,{
      status:"github_job_authenticated_only_not_engineer_approved",
      source_sha:sourceSha,run_id:runId,
      engineer_approval:"not_checked",
      operational_credential:"not_issued",
      gemini_calls:0
    });
    assert.equal((await send(body)).status,403);
    assert.equal((await readdir(directory)).length,2);
    const bad=await send({env,event,
      oidcJwt:makeJwt({sub:"repo:attacker/other:ref:"+ref})});
    assert.equal(bad.status,403);
    const wrongEvent=await send({
      env:{...env,GITHUB_EVENT_NAME:"push"},event,
      oidcJwt:makeJwt()
    });
    assert.equal(wrongEvent.status,403);
    assert.equal((await send({
      env,event,oidcJwt:makeJwt(),extra:"test"
    })).status,403);
    assert.equal((await send({
      env,event:{...event,inputs:{...event.inputs,
        authorization:"NO"}},oidcJwt:makeJwt()
    })).status,403);
    assert.equal((await readdir(directory)).length,2);
    const admitted=await admissionStore.consume({
      expectedRunId:runId,expectedSourceSha:sourceSha,
      expectedSessionId:"engineer-session-001"
    });
    assert.equal(admitted.run_id,runId);
    assert.equal(admitted.source_sha,sourceSha);
    assert.equal(admitted.session_id,"engineer-session-001");
    assert.equal(admitted.authorization_input,
      "I AUTHORIZE GEMINI API CHARGES");
    assert.equal(admitted.kind,
      "oidc_authenticated_only_not_engineer_approved");
    assert.equal(admitted.max_model_turns,12);
    assert.equal(admitted.max_output_tokens,16000);
    await assert.rejects(admissionStore.consume({
      expectedRunId:runId,expectedSourceSha:sourceSha,
      expectedSessionId:"engineer-session-001"
    }),/already consumed/);
    const missing=await fetch(server.baseUrl+"/invalid");
    assert.equal(missing.status,404);
    assert.equal(missing.headers.get("cache-control"),"no-store");
    assert.equal(missing.headers.get("x-content-type-options"),"nosniff");
  }finally{
    await server.close();
    await rm(directory,{recursive:true,force:true});
  }
});

test("trusted admission rejects unpinned host configuration before listening",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"trusted-oidc-reject-"));
  try{
    const admissionStore=new TrustedGithubAdmissionReceiptStore({
      directory,hmacSecret:Buffer.alloc(32,37),
      expectedSessionId:"engineer-session-001"
    });
    await assert.rejects(startTrustedGithubOidcIntakeServer({
      pinned:{...pinned,sourceSha:"invalid"},trust,
      githubApiToken:"local-test",admissionStore,
      replayStore:new GithubOidcReplayFileStore(directory)
    }),/host configuration missing/);
    await assert.rejects(startTrustedGithubOidcIntakeServer({
      pinned,trust,githubApiToken:"",admissionStore,
      replayStore:new GithubOidcReplayFileStore(directory)
    }),/host configuration missing/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
