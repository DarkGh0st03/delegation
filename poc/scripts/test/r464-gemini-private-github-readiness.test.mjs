import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {verifyR464PaidPrivateGithubControlsSnapshot as check,
 verifyR464PaidPrivateGithubReadiness as verify}
 from "../r464-gemini-private-github-readiness.mjs";

const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const WF=".github/workflows/trusted-gemini-private-session-hold.yml";
const ENV="r5-private-gemini-admission";
const SOURCE="a".repeat(40),MAIN="b".repeat(40),BLOB="c".repeat(40);
const TOKEN="local-read-only-admin-test-token";
const labels=["self-hosted","Linux","X64","delegation-private"];
function fixture(){
 return {
  expectedSourceSha:SOURCE,expectedMainSha:MAIN,
  development:{name:BRANCH,commit:{sha:SOURCE}},
  main:{name:"main",commit:{sha:MAIN}},
  environment:{name:ENV,can_admins_bypass:false,
   deployment_branch_policy:null,
   protection_rules:[{type:"required_reviewers",prevent_self_review:true,
    reviewers:[{type:"User",reviewer:{login:"other-operator"}}]}]},
  runners:{total_count:1,runners:[{
   id:314,name:"private-paid-runner",status:"online",busy:false,
   labels:labels.map(name=>({name}))
  }]}
 };
}
function mock({missingOnMain=false,disabled=false,drift=false,
 adminDenied=false,headMoved=false}={}){
 const calls=[];
 const res=x=>({status:200,ok:true,async json(){return x;}});
 const fetchFn=async(url,req)=>{
  calls.push({url,req});
  assert.equal(req.method,"GET");
  assert.equal(req.redirect,"error");
  assert.equal(req.headers.authorization,"Bearer "+TOKEN);
  assert.match(url,/^https:\/\/api\.github\.com\/repos\/DarkGh0st03\/delegation/u);
  const u=new URL(url);
  const p=u.pathname,q=u.searchParams.get("ref");
  if(adminDenied&&p.includes("/environments/"))return {status:403,ok:false};
  if(p.endsWith("/environments/"+ENV))return res(fixture().environment);
  if(p.endsWith("/actions/runners"))return res(fixture().runners);
  if(p.endsWith("/branches/main"))return res(fixture().main);
  if(p.endsWith("/branches/"+encodeURIComponent(BRANCH)))
   return res({...fixture().development,commit:{sha:headMoved?"d".repeat(40):SOURCE}});
  if(p.endsWith("/delegation"))
   return res({full_name:REPO,default_branch:"main"});
  if(p.includes("/contents/"+WF)){
   if(q==="main"&&missingOnMain)return {status:404,ok:false};
   return res({type:"file",path:WF,sha:drift&&q===BRANCH?"e".repeat(40):BLOB});
  }
  if(p.endsWith("/actions/workflows/trusted-gemini-private-session-hold.yml"))
   return res({path:WF,state:disabled?"disabled_manually":"active"});
  throw Error("Unexpected R464 test API route");
 };
 return {fetchFn,calls};
}
test("R464 paid Gemini registration and independent reviewer/one private runner are read-only",async()=>{
 const f=mock();
 const out=await verify({expectedSourceSha:SOURCE,expectedMainSha:MAIN,
  githubToken:TOKEN,fetchFn:f.fetchFn});
 assert.equal(out.status,"paid_admin_and_registration_readonly_preflight_not_r5_go");
 assert.equal(out.source_sha,SOURCE);
 assert.equal(out.main_sha,MAIN);
 assert.equal(out.workflow_registration_verified,true);
 assert.equal(out.private_runner_id,314);
 assert.equal(out.r5_go,false);
 assert.equal(out.private_engineer_host_attested,false);
 assert.equal(out.physical_runner_attested,false);
 assert.equal(out.model_api_calls,0);
 assert.equal(f.calls.length,9);
 assert.equal(f.calls.some(c=>/dispatches|jobs\/\d+|\/merge$/.test(c.url)),false);
 assert.equal(f.calls.every(c=>c.req.method==="GET"),true);
});
test("R464 refuses insufficient reviewers, admin bypass and unsafe branch policy",()=>{
 const mutations=[
  s=>s.environment.protection_rules=[],
  s=>s.environment.protection_rules[0].prevent_self_review=false,
  s=>s.environment.can_admins_bypass=true,
  s=>{delete s.environment.can_admins_bypass;},
  s=>s.environment.deployment_branch_policy={protected_branches:true},
  s=>s.environment.name="r5-private-scripted-admission",
  s=>s.development.commit.sha="e".repeat(40),
  s=>s.main.commit.sha="e".repeat(40)
 ];
 for(const mutate of mutations){
  const state=fixture();mutate(state);
  assert.throws(()=>check(state),/R464 paid Gemini GitHub private controls NO-GO/u);
 }
});
test("R464 refuses paginated, duplicate, busy and offline private runner inventory",()=>{
 const mutations=[
  s=>s.runners.runners[0].busy=true,
  s=>s.runners.runners[0].status="offline",
  s=>s.runners.runners[0].labels.pop(),
  s=>s.runners.runners[0].id=0,
  s=>s.runners.total_count=2,
  s=>s.runners.total_count=101,
  s=>{s.runners.runners.push({...s.runners.runners[0],id:999});s.runners.total_count=2;},
  s=>{s.runners.runners.push({...s.runners.runners[0],id:314,labels:[]});s.runners.total_count=2;}
 ];
 for(const mutate of mutations){
  const state=fixture();mutate(state);
  assert.throws(()=>check(state),/R464 paid Gemini GitHub private controls NO-GO/u);
 }
});
test("R464 paid admin rejects unregistered/disabled/changed workflow and stale branch",async()=>{
 for(const config of [
  {missingOnMain:true},{disabled:true},{drift:true},{headMoved:true},{adminDenied:true}
 ]){
  const f=mock(config);
  await assert.rejects(
   verify({expectedSourceSha:SOURCE,expectedMainSha:MAIN,
    githubToken:TOKEN,fetchFn:f.fetchFn}),
   /NO-GO/u);
  assert.equal(f.calls.some(c=>c.url.includes("/dispatches")),false);
 }
});
test("R464 denies missing independent pins/token before contacting GitHub",async()=>{
 for(const changes of [
  {expectedSourceSha:"invalid"},
  {expectedMainSha:"invalid"},
  {githubToken:""}
 ]){
  const f=mock();
  await assert.rejects(verify({
   expectedSourceSha:SOURCE,expectedMainSha:MAIN,githubToken:TOKEN,
   fetchFn:f.fetchFn,...changes
  }),/NO-GO/u);
  assert.equal(f.calls.length,0);
 }
});
test("R464 owner-only CLI without 0600 token safely fails closed",()=>{
 const p=spawnSync(process.execPath,[
  new URL("../r464-gemini-private-github-readiness.mjs",import.meta.url).pathname
 ],{env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000});
 assert.equal(p.status,1);
 assert.equal(p.stdout,"");
 assert.match(p.stderr,/R464 paid private GitHub admin preflight NO-GO/u);
 assert.doesNotMatch(p.stderr,/Bearer|local-read-only-admin-test-token/u);
});
