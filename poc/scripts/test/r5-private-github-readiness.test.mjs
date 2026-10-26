import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {verifyR5PrivateGithubControlsSnapshot as check,
  verifyR5PrivateGithubDeploymentReadiness as verify}
  from "../r5-private-github-readiness.mjs";
const REPO="DarkGh0st03/delegation";
const SOURCE="a".repeat(40),BLOB="b".repeat(40);
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const WF=".github/workflows/trusted-scripted-offline-session-hold.yml";
const ENV="r5-private-scripted-admission";
const TOKEN="read-only-operator-fixture-token";
function fixture(){
  return {sourceSha:SOURCE,
    branch:{name:BRANCH,commit:{sha:SOURCE}},
    environment:{name:ENV,can_admins_bypass:false,
      prevent_self_review:true,deployment_branch_policy:null,
      protection_rules:[{type:"required_reviewers",reviewers:[{
        type:"User",reviewer:{login:"independent-operator"}}]}]},
    runners:{total_count:1,runners:[{id:11,name:"private-r5",
      status:"online",busy:false,labels:["self-hosted","Linux","X64",
        "delegation-private"].map(name=>({name}))}]}
  };
}
function api({missingWorkflow=false,environmentDisabled=false}={}){
  const calls=[];
  const fetchFn=async(url,opts)=>{
    calls.push({url,opts});
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/DarkGh0st03\/delegation/);
    assert.equal(opts.method,"GET");
    assert.equal(opts.headers.authorization,"Bearer "+TOKEN);
    const path=new URL(url);
    let value;
    if(path.pathname.endsWith("/environments/"+ENV)){
      value=fixture().environment;
      if(environmentDisabled)value.can_admins_bypass=true;
    }else if(path.pathname.endsWith("/actions/runners"))value=fixture().runners;
    else if(path.pathname.endsWith("/branches/"+encodeURIComponent(BRANCH)))
      value=fixture().branch;
    else if(path.pathname.endsWith("/delegation"))
      value={full_name:REPO,default_branch:"main"};
    else if(path.pathname.includes("/contents/")){
      if(missingWorkflow&&path.searchParams.get("ref")==="main")
        return {status:404,ok:false};
      value={type:"file",path:WF,sha:BLOB};
    }else if(path.pathname.includes("/actions/workflows/"))
      value={path:WF,state:"active"};
    else throw Error("UNEXPECTED HTTP endpoint "+url);
    return {ok:true,status:200,async json(){return value;}};
  };
  return {fetchFn,calls};
}
test("R5 confirms exactly one idle private runner, independent Engineer reviewer and same-SHA registered workflow without dispatch",async()=>{
  const f=api();
  const result=await verify({expectedSourceSha:SOURCE,githubToken:TOKEN,
    fetchFn:f.fetchFn});
  assert.equal(result.status,
    "private_admin_and_registration_preflight_only_not_r5_go");
  assert.equal(result.eligible_private_runners,1);
  assert.equal(result.git_registration_verified,true);
  assert.equal(result.model_api_calls,0);
  assert.equal(result.engineer_approval_observed,false);
  assert.equal(f.calls.length,8);
  assert.equal(f.calls.some(c=>/dispatches|jobs\/\d+/.test(c.url)),false);
  assert.equal(f.calls.some(c=>c.opts.method!=="GET"),false);
});
test("R5 refuses absent reviewer protection, bypassable owner or unsafe deployment branch restrictions",()=>{
  for(const modify of [
    f=>f.environment.protection_rules=[],
    f=>f.environment.prevent_self_review=false,
    f=>f.environment.can_admins_bypass=true,
    f=>f.environment.deployment_branch_policy={protected_branches:true},
    f=>f.environment.name="production"
  ]){
    const f=fixture();modify(f);
    assert.throws(()=>check(f),/R5 private GitHub deployment NO-GO/);
  }
});
test("R5 refuses offline, busy, unlabeled, ambiguous or paged self-hosted runners",()=>{
  for(const modify of [
    f=>f.runners.runners[0].status="offline",
    f=>f.runners.runners[0].busy=true,
    f=>f.runners.runners[0].labels.pop(),
    f=>{f.runners.total_count=2;f.runners.runners.push({
      ...f.runners.runners[0],id:12});},
    f=>f.runners.total_count=101,
    f=>f.runners.total_count=2
  ]){
    const f=fixture();modify(f);
    assert.throws(()=>check(f),/R5 private GitHub deployment NO-GO/);
  }
});
test("R5 admin operator fails closed on absent default registration without dispatch",async()=>{
  const f=api({missingWorkflow:true});
  await assert.rejects(verify({expectedSourceSha:SOURCE,
    githubToken:TOKEN,fetchFn:f.fetchFn}),/NO-GO/);
  assert.equal(f.calls.some(c=>c.url.includes("dispatches")),false);
});
test("R5 admin controls reject unknown token, stale source and malformed environment before any registration",async()=>{
  const f=api();
  await assert.rejects(verify({expectedSourceSha:"not-sha",
    githubToken:TOKEN,fetchFn:f.fetchFn}),/NO-GO/);
  assert.equal(f.calls.length,0);
  await assert.rejects(verify({expectedSourceSha:SOURCE,
    githubToken:"",fetchFn:f.fetchFn}),/NO-GO/);
  assert.equal(f.calls.length,0);
  const x=api({environmentDisabled:true});
  await assert.rejects(verify({expectedSourceSha:SOURCE,
    githubToken:TOKEN,fetchFn:x.fetchFn}),/NO-GO/);
  assert.equal(x.calls.some(c=>c.url.includes("/contents/")),false);
});
test("R5 operator CLI denies absent protected token without printing credentials",()=>{
  const p=spawnSync(process.execPath,[
    new URL("../r5-private-github-readiness.mjs",import.meta.url).pathname
  ],{env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000});
  assert.equal(p.status,1);
  assert.equal(p.stdout,"");
  assert.match(p.stderr,/administration NO-GO/);
  assert.doesNotMatch(p.stderr,/Bearer|fixture-token|api\.github\.com/);
});
