import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,rm,chmod,readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {verifyGithubOidcJobAssertion}
  from "../src/trusted-github-oidc.ts";
import {GithubOidcReplayFileStore}
  from "../src/trusted-github-oidc-replay-store.ts";
import {startGithubReviewedGeminiHandoff}
  from "../src/trusted-manual-github-dispatch.ts";
import {verifyGithubManualGeminiDispatch}
  from "../src/trusted-manual-github-dispatch.ts";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/trusted-gemini-dispatch-preflight.yml";
const SHA="a".repeat(40),RUN="39800000001";
const AUDIENCE="https://trusted-engineer.example/github-oidc";
const SUBJECT="repo:"+REPO+":ref:"+REF;
const pinned={repository:REPO,ref:REF,workflowPath:WORKFLOW,sourceSha:SHA};
const trust={
  expectedAudience:AUDIENCE,expectedSubject:SUBJECT,
  expectedRepositoryId:"12345",expectedOwnerId:"67890"
};
const env={
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:REPO,
  GITHUB_REF:REF,GITHUB_WORKFLOW_REF:REPO+"/"+WORKFLOW+"@"+REF,
  GITHUB_SHA:SHA,GITHUB_RUN_ID:RUN
};
const event={
  repository:{full_name:REPO},ref:REF,
  inputs:{authorization:"I AUTHORIZE GEMINI API CHARGES",
    model:"gemini-3.8-flash",max_model_turns:"12",
    max_output_tokens:"16000",max_model_call_ms:"120000"}
};
const dispatch=verifyGithubManualGeminiDispatch({env,event,pinned});
const keys=generateKeyPairSync("rsa",{modulusLength:2048,
  publicExponent:0x10001});
const pub=keys.publicKey.export({format:"jwk"}) as any;
const jwks={keys:[{...pub,kid:"pinned-oidc-key-1",
  kty:"RSA",alg:"RS256",use:"sig"}]};
const jwksFetch=(async(url:any,options:any)=>{
  assert.equal(url,
    "https://token.actions.githubusercontent.com/.well-known/jwks");
  assert.equal(options.redirect,"error");
  return new Response(JSON.stringify(jwks),{status:200});
}) as typeof fetch;
const claims=()=>{
  const now=Math.floor(Date.now()/1000);
  return {
    iss:"https://token.actions.githubusercontent.com",
    aud:AUDIENCE,sub:SUBJECT,
    exp:now+180,nbf:now-10,iat:now-20,
    jti:"job-token-replay-"+
      String(Date.now())+"-"+String(Math.random()),
    repository:REPO,repository_id:"12345",repository_owner_id:"67890",
    ref:REF,ref_type:"branch",sha:SHA,workflow_sha:SHA,
    workflow_ref:REPO+"/"+WORKFLOW+"@"+REF,
    event_name:"workflow_dispatch",run_id:RUN,run_attempt:"1"
  };
};
function jwt(
  payload:Record<string,unknown>,
  header:Record<string,unknown>={alg:"RS256",typ:"JWT",kid:"pinned-oidc-key-1"},
  signedWith=keys.privateKey
){
  const raw=JSON.stringify(header);
  const prefix=Buffer.from(raw).toString("base64url")+"."+
    Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature=sign("RSA-SHA256",Buffer.from(prefix),
    signedWith).toString("base64url");
  return prefix+"."+signature;
}
function verify(token:string,overrides:any={}){
  return verifyGithubOidcJobAssertion({
    jwt:token,dispatch,pinned,trust,fetchFn:jwksFetch,...overrides
  });
}
test("OIDC host verifies RS256 GitHub job signature and exact external identity pins",async()=>{
  const payload=claims();
  const result=await verify(jwt(payload));
  assert.equal(result.kind,"github_actions_oidc_verified");
  assert.equal(result.jti,payload.jti);
  assert.equal(result.run_id,RUN);
  assert.equal(result.workflow_sha,SHA);
  assert.equal(result.repository_id,trust.expectedRepositoryId);
  assert.ok(Object.isFrozen(result));
  assert.equal("oidcJwt" in result,false);
});
test("OIDC rejects attacker key, claims substitution, unsupported algorithms and JWKS redirects",async()=>{
  const payload=claims();
  const attacker=generateKeyPairSync("rsa",{modulusLength:2048});
  for(const candidate of [
    jwt(payload,undefined,attacker.privateKey),
    jwt(payload,{alg:"none",kid:"pinned-oidc-key-1"}),
    jwt(payload,{alg:"HS256",kid:"pinned-oidc-key-1"}),
    jwt(payload,{alg:"RS256",kid:"attacker"}),
    jwt(payload,{alg:"RS256",kid:"pinned-oidc-key-1",
      jku:"https://attacker.invalid/key"}),
    jwt(payload).replace(/\.[A-Za-z0-9_-]+$/u,".AAAAAAAA")
  ])await assert.rejects(verify(candidate),
    /Trusted GitHub OIDC assertion:/);
  await assert.rejects(verify(jwt(payload),{
    fetchFn:(async()=>new Response("{}",{status:200})) as typeof fetch
  }),/invalid GitHub JWKS collection/);
  await assert.rejects(verify(jwt(payload),{
    fetchFn:(async()=>new Response("{}",{status:401})) as typeof fetch
  }),/JWKS returned invalid status/);
});
test("OIDC rejects mismatched issuer, audience, sub, repo IDs, workflow ref and source SHA",async()=>{
  const basis=claims();
  const bad=[
    {iss:"https://attacker.example"},
    {aud:"https://attacker.example"},
    {aud:[AUDIENCE,"https://attacker.example"]},
    {sub:"repo:"+REPO+":pull_request"},
    {repository:"attacker/delegation"},
    {repository_id:"12346"},{repository_owner_id:"67891"},
    {ref:"refs/heads/main"},{ref_type:"tag"},
    {sha:"0".repeat(40)},{workflow_sha:"0".repeat(40)},
    {workflow_ref:REPO+"/.github/workflows/legacy.yml@"+REF},
    {event_name:"push"},{run_id:"000"},{"run_attempt":"2"},
    {jti:"too-short"}
  ];
  for(const change of bad){
    await assert.rejects(verify(jwt({...basis,...change})),
      /OIDC identity does not match/);
  }
  await assert.rejects(verify(jwt(basis),{
    trust:{...trust,expectedSubject:""}
  }),/missing independently pinned OIDC trust policy/);
  await assert.rejects(verify(jwt(basis),{
    pinned:{...pinned,sourceSha:undefined}
  }),/source SHA must be pinned/);
});
test("OIDC rejects expired, future, too-long and invalid-numeric validity",async()=>{
  const basis=claims();
  for(const change of [
    {exp:basis.iat-1},{exp:basis.iat+901},
    {exp:basis.iat},{nbf:basis.exp+1},
    {iat:basis.iat+3600},{iat:basis.iat-5000},
    {exp:"not-a-date"}
  ])await assert.rejects(verify(jwt({...basis,...change})),
    /expired, future-dated or unbounded/);
});
test("OIDC replay is atomic and durable across store instances; insecure store denied",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"trusted-oidc-replay-"));
  try{
    const token=await verify(jwt(claims()));
    const one=new GithubOidcReplayFileStore(dir);
    await one.claim(token);
    await assert.rejects(one.claim(token),/repeated job OIDC assertion/);
    await assert.rejects(new GithubOidcReplayFileStore(dir).claim(token),
      /repeated job OIDC assertion/);
    const names=await readdir(dir);
    assert.equal(names.length,1);
    assert.match(names[0],/^[0-9a-f]{64}\.claimed$/u);
    assert.ok(!names[0].includes(token.jti));
    await chmod(dir,0o755);
    await assert.rejects(one.claim(await verify(jwt(claims()))),
      /replay directory must be owned/);
  }finally{
    await chmod(dir,0o700);
    await rm(dir,{recursive:true,force:true});
  }
});
test("paid bridge rejects missing OIDC/replay identity before any trusted root",async()=>{
  await assert.rejects(startGithubReviewedGeminiHandoff({
    env,event,pinned,githubApiToken:"test-read-token",
    geminiApiKey:"dummy-nonbillable",oidcJwt:"",
    oidcTrust:trust,
    oidcReplayStore:null as any
  } as any),/persistent authenticated OIDC replay store required/);
});


test("host requires signed OIDC, corroborated run and consumes one-use token before checking real Planning",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"oidc-trusted-host-"));
  try{
    const j=jwt(claims());
    const store=new GithubOidcReplayFileStore(dir);
    let runs=0;
    const ghRun=(async()=>{
      runs++;
      return new Response(JSON.stringify({
        id:Number(RUN),event:"workflow_dispatch",run_attempt:1,
        status:"in_progress",head_sha:SHA,
        head_branch:REF.slice("refs/heads/".length),path:WORKFLOW,
        head_repository:{full_name:REPO},
        created_at:new Date().toISOString()
      }),{status:200});
    }) as typeof fetch;
    const req={
      env,event,pinned,geminiApiKey:"offline-not-a-real-key",
      githubApiToken:"test-host-API-token",
      githubApiFetchFn:ghRun,
      oidcJwt:j,oidcTrust:trust,
      oidcReplayStore:store,oidcJwksFetchFn:jwksFetch
    } as any;
    // Signed runner identity alone MUST NOT create a Planning session.
    await assert.rejects(startGithubReviewedGeminiHandoff(req),
      /real trusted Coordinator, checkpoint store and Engineer review/);
    assert.equal(runs,1);
    // Store is durable: the same signed job identity cannot retry approval,
    // even if the trusted process was restarted.
    await assert.rejects(startGithubReviewedGeminiHandoff({
      ...req,oidcReplayStore:new GithubOidcReplayFileStore(dir)
    }),/repeated job OIDC assertion rejected/);
    const already=await readdir(dir);
    assert.equal(already.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("rejected GitHub run metadata never consumes an otherwise valid OIDC token",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"oidc-invalid-run-"));
  try{
    const assertion=jwt(claims());
    await assert.rejects(startGithubReviewedGeminiHandoff({
      env,event,pinned,githubApiToken:"mock-github-read",
      githubApiFetchFn:(async()=>new Response(JSON.stringify({
        id:Number(RUN),event:"workflow_dispatch",run_attempt:2,
        status:"in_progress",head_sha:SHA,
        head_branch:REF.slice("refs/heads/".length),path:WORKFLOW,
        head_repository:{full_name:REPO},
        created_at:new Date().toISOString()
      }),{status:200})) as typeof fetch,
      oidcJwt:assertion,oidcTrust:trust,
      oidcReplayStore:new GithubOidcReplayFileStore(dir),
      oidcJwksFetchFn:jwksFetch,
      geminiApiKey:"test-unused"
    } as any),/GitHub API does not corroborate/);
    assert.deepEqual(await readdir(dir),[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
