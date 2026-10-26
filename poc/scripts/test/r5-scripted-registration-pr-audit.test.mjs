import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {verifyR5OneFileRegistrationPrSnapshot as check,
  verifyR5OneFileRegistrationPr as audit}
  from "../r5-scripted-registration-pr-audit.mjs";

const REPO="DarkGh0st03/delegation";
const DEV="refactor/post-prof-plan-contracts-20261021";
const REG="r5/scripted-workflow-registration-review-20261026";
const FILE=".github/workflows/trusted-scripted-offline-session-hold.yml";
const HEAD="6ea1e36b1ed502336f7dce57aa63d8bb28bf0869";
const BLOB="ff11137db63ade2806387537f5fd87c37e1a2285";
const SRC="a".repeat(40),MAIN="b".repeat(40);
function fixture(){
  return {
    expectedDevSha:SRC,expectedMainSha:MAIN,
    repo:{full_name:REPO,default_branch:"main"},
    main:{name:"main",commit:{sha:MAIN}},
    dev:{name:DEV,commit:{sha:SRC}},
    pr:{number:37,state:"open",draft:true,merged:false,
      changed_files:1,additions:50,deletions:0,
      base:{ref:"main",sha:MAIN,repo:{full_name:REPO}},
      head:{ref:REG,sha:HEAD,repo:{full_name:REPO}}
    },
    files:[{filename:FILE,status:"added",additions:50,
      deletions:0,sha:BLOB}],
    devWorkflow:{type:"file",path:FILE,sha:BLOB},
    mainWorkflowAbsent:true
  };
}
function publicApi(options={}){
  const data=fixture(),calls=[];
  if(options.movedHead)data.pr.head.sha="c".repeat(40);
  if(options.extraFile){
    data.files.push({filename:"poc/src/unsafe.ts",status:"added",
      additions:1,deletions:0,sha:"d".repeat(40)});
    data.pr.changed_files=2;data.pr.additions=51;
  }
  if(options.registered)data.mainWorkflowAbsent=false;
  if(options.staleDev)data.dev.commit.sha="e".repeat(40);
  const fetchFn=async(url,init)=>{
    calls.push({url,init});
    assert.equal(init.method,"GET");
    assert.equal(init.redirect,"error");
    assert.equal(init.headers.authorization,undefined);
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/DarkGh0st03\/delegation/);
    let result;
    const u=new URL(url);
    if(u.pathname.endsWith("/delegation"))result=data.repo;
    else if(u.pathname.endsWith("/branches/main"))result=data.main;
    else if(u.pathname.includes("/branches/"))result=data.dev;
    else if(u.pathname.endsWith("/pulls/37"))result=data.pr;
    else if(u.pathname.endsWith("/pulls/37/files"))result=data.files;
    else if(u.pathname.endsWith("/contents/"+FILE)){
      if(u.searchParams.get("ref")==="main"){
        if(data.mainWorkflowAbsent)return {ok:false,status:404};
        result=data.devWorkflow;
      }else result=data.devWorkflow;
    }else throw Error("unexpected public read "+url);
    return {ok:true,status:200,async json(){return result;}};
  };
  return {fetchFn,calls};
}
test("R5 one-file draft registration PR audit verifies exact blob/base/source without merge, token or dispatch",async()=>{
  const f=publicApi();
  const result=await audit({
    expectedDevSha:SRC,expectedMainSha:MAIN,fetchFn:f.fetchFn
  });
  assert.deepEqual(result,{
    status:"draft_registration_pr_exact_review_only_not_merged",
    pull_request:37,reviewed_registration_head:HEAD,
    reviewed_workflow_blob:BLOB,main_sha:MAIN,development_sha:SRC,
    workflow_registration_complete:false,
    private_runner_deployed:false,
    engineer_signature_verified:false,model_api_calls:0,r5_go:false
  });
  assert.equal(f.calls.length,7);
  assert.equal(f.calls.some(c=>/merge|dispatches|actions\/runs/.test(c.url)),false);
  assert.equal(f.calls.every(c=>c.init.method==="GET"),true);
});
test("R5 registration review denies any unexpected diff, base/head change, merge, or default-branch file",()=>{
  const mutations=[
    x=>x.pr.draft=false,x=>x.pr.state="closed",
    x=>x.pr.merged=true,x=>x.pr.base.sha="c".repeat(40),
    x=>x.pr.head.sha="c".repeat(40),
    x=>x.pr.head.repo.full_name="attacker/repo",
    x=>x.dev.commit.sha="c".repeat(40),
    x=>x.main.commit.sha="c".repeat(40),
    x=>x.pr.changed_files=2,
    x=>x.pr.additions=51,
    x=>x.files[0].filename="poc/src/unsafe.ts",
    x=>x.files[0].status="modified",
    x=>x.files[0].sha="a".repeat(40),
    x=>x.devWorkflow.sha="c".repeat(40),
    x=>x.mainWorkflowAbsent=false
  ];
  for(const fn of mutations){
    const value=fixture();fn(value);
    assert.throws(()=>check(value),/R5 registration PR audit NO-GO/);
  }
});
test("R5 public PR audit rejects modified PR, missing original registration or stale SHA",async()=>{
  for(const opts of [{movedHead:true},{extraFile:true},
    {registered:true},{staleDev:true}]){
    const f=publicApi(opts);
    await assert.rejects(audit({expectedDevSha:SRC,
      expectedMainSha:MAIN,fetchFn:f.fetchFn}),
      /R5 registration PR audit NO-GO/);
    assert.equal(f.calls.some(c=>/dispatches/.test(c.url)),false);
  }
});
test("R5 missing operator SHA pins and unavailable GitHub fail closed without leaking details",async()=>{
  const noCall=publicApi();
  await assert.rejects(audit({expectedDevSha:"bad",expectedMainSha:MAIN,
    fetchFn:noCall.fetchFn}),/SHA pins missing/);
  assert.equal(noCall.calls.length,0);
  await assert.rejects(audit({expectedDevSha:SRC,expectedMainSha:MAIN,
    fetchFn:async()=>{throw Error("protected-secret-example");}}),
  error=>{
    assert.match(error.message,/public PR information unavailable/);
    assert.doesNotMatch(error.message,/protected-secret-example/);
    return true;
  });
});
test("R5 owner-only PR CLI fails closed without GitHub token, merge or dispatch",()=>{
  const script=new URL("../r5-scripted-registration-pr-audit.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[script.pathname],{
    env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.match(result.stderr,/registration PR review NO-GO/);
  assert.doesNotMatch(result.stderr,/Authorization|Bearer|token/);
});
