import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readdir,rm,readFile,writeFile,chmod} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedGithubAdmissionReceiptStore}
  from "../src/trusted-github-admission-store.ts";
import {verifyGithubManualGeminiDispatch}
  from "../src/trusted-manual-github-dispatch.ts";
import type {VerifiedGithubOidcJob}
  from "../src/trusted-github-oidc.ts";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const PATH=".github/workflows/trusted-gemini-dispatch-preflight.yml";
const SHA="f".repeat(40),RUN="39829991999",SESSION="session-rust-oidc-10";
const envelope={
  env:{
    GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
    GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:REPO,
    GITHUB_REF:REF,GITHUB_WORKFLOW_REF:REPO+"/"+PATH+"@"+REF,
    GITHUB_SHA:SHA,GITHUB_RUN_ID:RUN
  },
  event:{repository:{full_name:REPO},ref:REF,
    inputs:{authorization:"I AUTHORIZE GEMINI API CHARGES",
      model:"gemini-3.8-flash",max_model_turns:"12",
      max_output_tokens:"16000",max_model_call_ms:"120000"}},
  pinned:{repository:REPO,ref:REF,workflowPath:PATH,sourceSha:SHA}
};
const dispatch=verifyGithubManualGeminiDispatch(envelope);
const job={
  kind:"github_actions_oidc_verified" as const,
  jti:"test-only-verified-cryptographic-job-id",
  run_id:RUN,workflow_sha:SHA,repository_id:"1374168963",
  repository_owner_id:"150908952",
  audience:"urn:delegation:trusted-oidc"
} satisfies VerifiedGithubOidcJob;
const secret=Buffer.alloc(32,42);
const config=(dir:string)=>({
  directory:dir,hmacSecret:secret,
  expectedSessionId:SESSION
});
const expected={
  expectedRunId:RUN,expectedSourceSha:SHA,
  expectedSessionId:SESSION
};

test("authenticated Github admission is bounded, session-scoped and one-use across host restarts",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"trusted-admission-ok-"));
  try{
    const store=new TrustedGithubAdmissionReceiptStore(config(dir));
    const when=Date.now();
    await store.record({dispatch,job,nowMs:when});
    await assert.rejects(store.record({dispatch,job,nowMs:when}),
      /workflow run already admitted/);
    const files=await readdir(dir);
    assert.equal(files.length,1);
    assert.match(files[0],/^[0-9a-f]{64}\.json$/u);
    assert.ok(!files[0].includes(RUN));
    const contents=await readFile(join(dir,files[0]),"utf8");
    for(const prohibited of [
      job.jti,secret.toString("hex"),"engineer_private_key","signed_vp"
    ])assert.ok(!contents.includes(prohibited));
    await assert.rejects(store.consume({
      ...expected,expectedSourceSha:"a".repeat(40),nowMs:when
    }),/session\/run\/source/);
    await assert.rejects(store.consume({
      ...expected,expectedSessionId:"another-session",nowMs:when
    }),/session\/run\/source/);
    const reviewed=await new TrustedGithubAdmissionReceiptStore(config(dir))
      .consume({...expected,nowMs:when+1000});
    assert.equal(reviewed.kind,
      "oidc_authenticated_only_not_engineer_approved");
    assert.equal(reviewed.authorization_input,
      "I AUTHORIZE GEMINI API CHARGES");
    assert.equal(reviewed.session_id,SESSION);
    assert.equal(reviewed.source_sha,SHA);
    assert.equal(reviewed.max_model_turns,12);
    assert.equal(reviewed.max_output_tokens,16000);
    assert.equal(reviewed.max_model_call_ms,120000);
    assert.ok(Object.isFrozen(reviewed));
    await assert.rejects(store.consume({...expected,nowMs:when+2000}),
      /already consumed/);
    assert.equal((await readdir(dir)).length,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("authenticated admission HMAC rejects unauthorized changes before consumption",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"trusted-admission-mac-"));
  try{
    const store=new TrustedGithubAdmissionReceiptStore(config(dir));
    const when=Date.now();
    await store.record({dispatch,job,nowMs:when});
    const [name]=await readdir(dir);
    const file=join(dir,name);
    const original=await readFile(file,"utf8");
    const tampered=JSON.parse(original);
    tampered.payload.max_model_turns=32;
    await writeFile(file,JSON.stringify(tampered));
    await assert.rejects(store.consume({...expected,nowMs:when+1000}),
      /HMAC verification failed/);
    assert.equal((await readdir(dir)).length,1);
    await writeFile(file,original);
    await assert.rejects(
      new TrustedGithubAdmissionReceiptStore({
        ...config(dir),hmacSecret:Buffer.alloc(32,43)
      }).consume({...expected,nowMs:when+1000}),
      /HMAC verification failed/);
    await assert.rejects(store.consume({
      ...expected,nowMs:when+300001
    }),/expired or outside/);
    assert.equal((await readdir(dir)).length,1);
    const valid=await store.consume({...expected,nowMs:when+2000});
    assert.equal(valid.run_id,RUN);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("receipt store denies weak shared secrets, insecure directory or file permissions",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"trusted-admission-modes-"));
  try{
    assert.throws(()=>new TrustedGithubAdmissionReceiptStore({
      ...config(dir),hmacSecret:Buffer.from("insecure")
    }),/256-bit/);
    const store=new TrustedGithubAdmissionReceiptStore(config(dir));
    await chmod(dir,0o755);
    await assert.rejects(store.record({dispatch,job}),/owner-owned and 0700/);
    await chmod(dir,0o700);
    await store.record({dispatch,job});
    const [name]=await readdir(dir);
    await chmod(join(dir,name),0o644);
    await assert.rejects(store.consume(expected),
      /insecure receipt file/);
  }finally{
    await chmod(dir,0o700);
    await rm(dir,{recursive:true,force:true});
  }
});
