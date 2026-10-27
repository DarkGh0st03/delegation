import test from "node:test";
import assert from "node:assert/strict";
import {verifyR5GeminiPrivateDispatchRegistration as check}
  from "../r5-gemini-private-dispatch-registration.mjs";

const REPO="DarkGh0st03/delegation";
const BRANCH="refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/trusted-gemini-private-session-hold.yml";
const source="a".repeat(40),blob="b".repeat(40);
const pins={
  expectedRepository:REPO,expectedRef:"refs/heads/"+BRANCH,
  expectedWorkflowPath:WORKFLOW,expectedSourceSha:source
};
function fixture({missingDefault=false,drift=false,disabled=false,
  stale=false,network=false}={}){
  const paths=[];
  const fetchFn=async(url,request)=>{
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/DarkGh0st03\/delegation/u);
    assert.equal(request.headers.accept,"application/vnd.github+json");
    assert.equal(request.headers.authorization,undefined);
    paths.push(url);
    if(network)throw Error("secret should never be logged");
    const target=new URL(url);
    let value;
    if(target.pathname.endsWith("/delegation"))
      value={full_name:REPO,default_branch:"main"};
    else if(target.pathname.includes("/branches/"))
      value={name:BRANCH,commit:{sha:stale?"c".repeat(40):source}};
    else if(target.pathname.includes("/contents/")&&
       target.searchParams.get("ref")==="main"){
      if(missingDefault)return {ok:false,status:404};
      value={type:"file",path:WORKFLOW,sha:blob};
    }else if(target.pathname.includes("/contents/"))
      value={type:"file",path:WORKFLOW,sha:drift?"d".repeat(40):blob};
    else if(target.pathname.includes("/actions/workflows/"))
      value={path:WORKFLOW,state:disabled?"disabled_manually":"active"};
    else throw Error("unexpected GitHub route");
    return {ok:true,status:200,async json(){return value;}};
  };
  return {fetchFn,paths};
}
test("R5 paid-private registration proof requires matching default branch workflow and pinned source",async()=>{
  const f=fixture();
  const result=await check({pins,fetchFn:f.fetchFn});
  assert.equal(result.status,"registration_verified_only_not_r5_go");
  assert.equal(result.source_sha,source);
  assert.equal(result.workflow_blob_sha,blob);
  assert.equal(f.paths.length,5);
});
test("R5 paid-private refuses missing default-branch manual workflow, without dispatching",async()=>{
  const f=fixture({missingDefault:true});
  await assert.rejects(check({pins,fetchFn:f.fetchFn}),
    /workflow or repository not registered/);
  assert.equal(f.paths.some(x=>x.includes("/dispatches")),false);
});
test("R5 paid-private refuses stale source SHA, changed workflow and disabled registration",async()=>{
  for(const variant of [{stale:true},{drift:true},{disabled:true}]){
    const f=fixture(variant);
    await assert.rejects(check({pins,fetchFn:f.fetchFn}),
      /R5 Gemini private registration NO-GO/);
  }
});
test("R5 paid-private refuses altered owner pins before reaching network",async()=>{
  for(const changed of [
    {expectedRepository:"attacker/delegation"},
    {expectedRef:"refs/heads/main"},
    {expectedWorkflowPath:".github/workflows/gemini-paid.yml"},
    {expectedSourceSha:"f".repeat(39)}
  ]){
    const f=fixture();
    await assert.rejects(check({pins:{...pins,...changed},fetchFn:f.fetchFn}),
      /owner pins/);
    assert.equal(f.paths.length,0);
  }
});
test("R5 REST outage fails closed and does not disclose upstream error",async()=>{
  await assert.rejects(check({pins,fetchFn:fixture({network:true}).fetchFn}),
    error=>{
      assert.match(error.message,/GitHub API unavailable/);
      assert.doesNotMatch(error.message,/secret/);
      return true;
    });
});
