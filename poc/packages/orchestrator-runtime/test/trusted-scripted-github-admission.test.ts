import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,rm,readdir,readFile,writeFile,chmod} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {verifyScriptedGithubManualDispatch,
  TrustedScriptedGithubAdmissionStore,authenticateScriptedGithubRun}
  from "../src/trusted-scripted-github-admission.ts";
import {GithubOidcReplayFileStore}
  from "../src/trusted-github-oidc-replay-store.ts";
import {verifyGithubManualGeminiDispatch}
  from "../src/trusted-manual-github-dispatch.ts";
import {TrustedGithubAdmissionReceiptStore}
  from "../src/trusted-github-admission-store.ts";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const SHA="b".repeat(40),RUN="40190000222",SESSION="scripted-r5-session";
const AUD="urn:thesis:r5:offline:private-only";
const SUBJECT="repo:"+REPO+":environment:r5-private-scripted";
const pin={repository:REPO,ref:REF,workflowPath:WORKFLOW,sourceSha:SHA};
const trust={expectedAudience:AUD,expectedSubject:SUBJECT,
  expectedRepositoryId:"111",expectedOwnerId:"222"};
const env={
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:REPO,GITHUB_REF:REF,
  GITHUB_WORKFLOW_REF:REPO+"/"+WORKFLOW+"@"+REF,
  GITHUB_SHA:SHA,GITHUB_RUN_ID:RUN
};
const event={
  action:"workflow_dispatch",sender:{login:"offline-owner"},
  repository:{full_name:REPO,id:111,private:true},
  ref:REF,inputs:{
    execution_profile:"scripted_offline",
    authorization:"I AUTHORIZE A SCRIPTED OFFLINE TEST ONLY"
  }
};
const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const pub=keys.publicKey.export({format:"jwk"}) as any;
const jwksFetch=(async()=>new Response(JSON.stringify({
  keys:[{...pub,kid:"r5-offline-kid",use:"sig",alg:"RS256"}]
}),{status:200})) as typeof fetch;
const claims=()=>{
  const now=Math.floor(Date.now()/1000);
  return {
    iss:"https://token.actions.githubusercontent.com",
    aud:AUD,sub:SUBJECT,exp:now+180,nbf:now-10,iat:now-20,
    jti:"scripted-job-claim-"+String(Date.now()),
    repository:REPO,repository_id:"111",repository_owner_id:"222",
    ref:REF,ref_type:"branch",sha:SHA,workflow_sha:SHA,
    workflow_ref:REPO+"/"+WORKFLOW+"@"+REF,
    event_name:"workflow_dispatch",run_id:RUN,run_attempt:"1"
  };
};
function token(payload:Record<string,unknown>){
  const head=Buffer.from(JSON.stringify({
    alg:"RS256",typ:"JWT",kid:"r5-offline-kid"
  })).toString("base64url");
  const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signing=head+"."+body;
  return signing+"."+sign("RSA-SHA256",Buffer.from(signing),
    keys.privateKey).toString("base64url");
}
const restFetch=(async()=>new Response(JSON.stringify({
  id:Number(RUN),event:"workflow_dispatch",run_attempt:1,
  status:"in_progress",head_sha:SHA,head_branch:REF.slice(11),
  path:WORKFLOW,head_repository:{full_name:REPO},
  created_at:new Date().toISOString()
}),{status:200})) as typeof fetch;
const credential=Buffer.alloc(32,87);
const owner=(dir:string)=>new TrustedScriptedGithubAdmissionStore({
  directory:dir,hmacSecret:credential,expectedSessionId:SESSION
});
function admission(overrides:Record<string,unknown>={}){
  return {env,event,pinned:pin,oidcJwt:token(claims()),
    trust,githubApiToken:"offline-gh-rest-reader",
    oidcJwksFetchFn:jwksFetch,githubApiFetchFn:restFetch,
    ...overrides} as any;
}

test("R5 offline dispatch has no model fields and cannot pass paid dispatch",()=>{
  const parsed=verifyScriptedGithubManualDispatch({
    env,event,pinned:pin
  });
  assert.equal(parsed.execution_profile,"scripted_offline");
  assert.equal(parsed.kind,"scripted_offline_manual_job_identity_only");
  for(const field of ["model_name","authorization_input","geminiApiKey",
    "max_model_turns","max_output_tokens"])
    assert.equal(field in parsed,false);
  assert.throws(()=>verifyGithubManualGeminiDispatch({
    env,event,pinned:pin
  }),/Trusted Github manual dispatch:/);
});

test("R5 offline identity denies cross-profile consent, paid workflow, ref or extra inputs",()=>{
  for(const bad of [
    {event:{...event,inputs:{...event.inputs,model:"gemini-3.8-flash"}}},
    {event:{...event,inputs:{...event.inputs,
      authorization:"I AUTHORIZE GEMINI API CHARGES"}}},
    {event:{...event,inputs:{...event.inputs,execution_profile:"paid_gemini"}}},
    {pinned:{...pin,workflowPath:
      ".github/workflows/trusted-private-github-session-hold.yml"}},
    {env:{...env,GITHUB_RUN_ATTEMPT:"2"}},
    {env:{...env,GITHUB_REF:"refs/heads/main"}},
    {env:{...env,GITHUB_SHA:"e".repeat(40)}},
    {event:{...event,repository:{full_name:"attacker/repo"}}}
  ]){
    assert.throws(()=>verifyScriptedGithubManualDispatch({
      env:bad.env??env,event:bad.event??event,pinned:bad.pinned??pin
    }),/Trusted scripted GitHub admission:/);
  }
});

test("R5 signed offline GitHub OIDC and REST corroboration produce one-use HMAC receipt only",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"scripted-r5-"));
  const replay=await mkdtemp(join(tmpdir(),"scripted-r5-replay-"));
  try{
    const store=owner(directory);
    const input=admission({
      replayStore:new GithubOidcReplayFileStore(replay),
      receiptStore:store
    });
    const dispatch=await authenticateScriptedGithubRun(input);
    assert.equal(dispatch.run_id,RUN);
    const [file]=await readdir(directory);
    const raw=await readFile(join(directory,file),"utf8");
    for(const secret of [
      "I AUTHORIZE GEMINI API CHARGES","geminiApiKey",
      "model_name","max_model_turns","max_model_call_ms",
      input.oidcJwt,credential.toString("hex")
    ])assert.equal(raw.includes(secret),false);
    assert.equal(raw.includes("model_inference_allowed"),true);
    const signed=await new TrustedScriptedGithubAdmissionStore({
      directory,hmacSecret:credential,expectedSessionId:SESSION
    }).consume({
      expectedRunId:RUN,expectedSourceSha:SHA,expectedSessionId:SESSION
    });
    assert.equal(signed.engineer_approved,false);
    assert.equal(signed.model_inference_allowed,false);
    assert.equal(signed.execution_profile,"scripted_offline");
    assert.ok(Object.isFrozen(signed));
    await assert.rejects(store.consume({
      expectedRunId:RUN,expectedSourceSha:SHA,expectedSessionId:SESSION
    }),/already consumed/);
    await assert.rejects(new TrustedGithubAdmissionReceiptStore({
      directory,hmacSecret:credential,expectedSessionId:SESSION
    }).consume({
      expectedRunId:RUN,expectedSourceSha:SHA,expectedSessionId:SESSION
    }),/ENOENT|admission/);
    assert.equal((await readdir(replay)).length,1);
  }finally{
    await rm(directory,{recursive:true,force:true});
    await rm(replay,{recursive:true,force:true});
  }
});

test("R5 offline admission rejects forged GitHub signature or REST run before persistent claim",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"scripted-bad-"));
  const replay=await mkdtemp(join(tmpdir(),"scripted-bad-replay-"));
  try{
    const store=owner(directory);
    const base={
      replayStore:new GithubOidcReplayFileStore(replay),
      receiptStore:store
    };
    const original=token(claims());
    const altered=original.slice(0,-8)+"AAAAAAAA";
    await assert.rejects(authenticateScriptedGithubRun(admission({
      ...base,oidcJwt:altered
    })),/invalid OIDC signature/);
    await assert.rejects(authenticateScriptedGithubRun(admission({
      ...base,
      oidcJwt:token({...claims(),workflow_ref:
        REPO+"/.github/workflows/trusted-private-github-session-hold.yml@"+REF})
    })),/OIDC identity does not match/);
    await assert.rejects(authenticateScriptedGithubRun(admission({
      ...base,githubApiFetchFn:(async()=>new Response(JSON.stringify({
        id:Number(RUN),event:"workflow_dispatch",run_attempt:1,
        status:"completed",head_sha:SHA,
        head_branch:REF.slice(11),path:WORKFLOW,
        head_repository:{full_name:REPO},
        created_at:new Date().toISOString()
      }),{status:200})) as typeof fetch
    })),/GitHub API does not corroborate/);
    assert.deepEqual(await readdir(directory),[]);
    assert.deepEqual(await readdir(replay),[]);
  }finally{
    await rm(directory,{recursive:true,force:true});
    await rm(replay,{recursive:true,force:true});
  }
});

test("R5 offline receipt denies tampering, wrong owner secret, stale record and insecure dir",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"scripted-mac-"));
  try{
    const store=owner(directory);
    const dispatch=verifyScriptedGithubManualDispatch({
      env,event,pinned:pin
    });
    const now=Date.now();
    const job={kind:"github_actions_oidc_verified" as const,
      run_id:RUN,workflow_sha:SHA,jti:"proof",
      repository_id:"111",repository_owner_id:"222",audience:AUD};
    await store.record({dispatch,job,nowMs:now});
    const [name]=await readdir(directory),file=join(directory,name);
    const content=await readFile(file,"utf8");
    const modified=JSON.parse(content);
    modified.record.engineer_approved=true;
    await writeFile(file,JSON.stringify(modified));
    await assert.rejects(store.consume({
      expectedRunId:RUN,expectedSourceSha:SHA,expectedSessionId:SESSION,
      nowMs:now+1000
    }),/wrong profile/);
    await writeFile(file,content);
    await assert.rejects(new TrustedScriptedGithubAdmissionStore({
      directory,hmacSecret:Buffer.alloc(32,99),expectedSessionId:SESSION
    }).consume({expectedRunId:RUN,expectedSourceSha:SHA,
      expectedSessionId:SESSION,nowMs:now+1000}),/HMAC does not match/);
    await assert.rejects(store.consume({
      expectedRunId:RUN,expectedSourceSha:SHA,expectedSessionId:SESSION,
      nowMs:now+LIFETIME_TEST
    }),/receipt expired/);
    await chmod(directory,0o755);
    await assert.rejects(store.consume({
      expectedRunId:RUN,expectedSourceSha:SHA,expectedSessionId:SESSION
    }),/owner-only 0700/);
  }finally{
    await chmod(directory,0o700);
    await rm(directory,{recursive:true,force:true});
  }
});
const LIFETIME_TEST=301000;
