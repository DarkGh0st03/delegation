import assert from "node:assert/strict";
import test from "node:test";
import {GiteaMergeReadinessVerifier,MergeReadinessDenied} from "../src/merge-readiness.ts";

const a="a".repeat(40),b="b".repeat(40),c="c".repeat(40);
const owner={id:101,login:"software-engineer"};
const ci={id:102,login:"trusted-security-ci"};
const pr={
  number:3,state:"open",merged:false,mergeable:true,
  head:{ref:"feature/account-suspension",sha:a,
    repo:{full_name:"thesis/iam-console-poc"}},
  base:{ref:"main",sha:b,repo:{full_name:"thesis/iam-console-poc"}}
};
const protection={
  branch_name:"main",enable_push:false,enable_force_push:false,
  required_approvals:1,block_admin_merge_override:true,
  dismiss_stale_approvals:true,block_on_outdated_branch:true
};
const reviews=[{id:7,state:"APPROVED",commit_id:a,user:owner}];
const statuses=[{id:8,state:"success",context:"thesis/security-pipeline",
  creator:ci,sha:a}];
function harness(patches:Record<string,unknown>={}){
  const data:Record<string,unknown>={
    "/pulls/3":pr,
    "/branches/feature%2Faccount-suspension":{commit:{id:a}},
    "/branches/main":{commit:{id:b}},
    "/branch_protections/main":protection,
    "/pulls/3/reviews":reviews,
    ["/commits/"+a+"/statuses"]:statuses,
    ...patches
  };
  const calls:Array<{url:string;method:string}>= [];
  const fetchFn:typeof fetch=async(input,init)=>{
    const u=new URL(String(input));
    const path=u.pathname.replace("/api/v1/repos/thesis/iam-console-poc","");
    const cleaned=path.endsWith("/reviews")||path.endsWith("/statuses")
      ?path:path;
    calls.push({url:String(input),method:init?.method??"GET"});
    const v=data[cleaned];
    return new Response(JSON.stringify(v??{error:"not_found"}),{
      status:v===undefined?404:200,
      headers:{"content-type":"application/json"}
    });
  };
  const make=()=>new GiteaMergeReadinessVerifier({
    giteaBaseUrl:"http://127.0.0.1:3030",
    readToken:"read-only-fixture-token",
    humanReviewer:owner,securityPipelineActor:ci,fetchFn
  });
  return {make,calls};
}
async function denied(patch:Record<string,unknown>,reason:string){
  const {make}=harness(patch);
  await assert.rejects(make().verify({pullRequestNumber:3,expectedHeadSha:a}),
    (e:unknown)=>e instanceof MergeReadinessDenied&&e.reason===reason);
}
test("read-only gate requires a fresh exact-head human approval AND trusted security status",async()=>{
  const {make,calls}=harness();
  const result=await make().verify({pullRequestNumber:3,expectedHeadSha:a});
  assert.deepEqual(result,{
    ready:true,pull_request_number:3,head_sha:a,base_sha:b,
    reviewer_id:owner.id,approval_review_id:7,
    pipeline_actor_id:ci.id,security_status_id:8,
    security_context:"thesis/security-pipeline"
  });
  assert.equal(calls.length,7);
  assert.ok(calls.every(call=>call.method==="GET"));
  assert.ok(calls.every(call=>call.url.startsWith(
    "http://127.0.0.1:3030/api/v1/repos/thesis/iam-console-poc/")));
});
test("never accept no review, wrong human, stale approval or later rejection",async()=>{
  const key="/pulls/3/reviews";
  await denied({[key]:[]},"human_approval_missing");
  await denied({[key]:[{...reviews[0],user:{id:888,login:owner.login}}]},
    "human_approval_missing");
  await denied({[key]:[{...reviews[0],commit_id:c}]},"human_approval_missing");
  await denied({[key]:[reviews[0],{...reviews[0],id:10,state:"REQUEST_CHANGES"}]},
    "human_approval_missing");
  await denied({[key]:[{...reviews[0],user:{...owner,is_bot:true}}]},
    "human_approval_missing");
});
test("no CI attestation, fake actor, latest pending and stale SHA all deny",async()=>{
  const key="/commits/"+a+"/statuses";
  await denied({[key]:[]},"security_pipeline_missing");
  await denied({[key]:[{...statuses[0],creator:{id:999,login:ci.login}}]},
    "security_pipeline_missing");
  await denied({[key]:[{...statuses[0],sha:c}]},"security_pipeline_missing");
  await denied({[key]:[statuses[0],{...statuses[0],id:9,state:"pending"}]},
    "security_pipeline_missing");
  await denied({[key]:[statuses[0],{...statuses[0],id:10,creator:owner}]},
    "security_pipeline_missing");
});
test("feature moved, base moved, merged PR and weak branch protection all deny",async()=>{
  await denied({"/branches/feature%2Faccount-suspension":{commit:{id:c}}},
    "pr_revision_mismatch");
  await denied({"/branches/main":{commit:{id:c}}},"pr_revision_mismatch");
  await denied({"/pulls/3":{...pr,merged:true,state:"closed"}},"pr_not_open");
  await denied({"/pulls/3":{...pr,mergeable:false}},"pr_not_mergeable");
  await denied({"/pulls/3":{...pr,head:{...pr.head,sha:c}}},"pr_revision_mismatch");
  await denied({"/branch_protections/main":{...protection,required_approvals:0}},
    "branch_protection_insufficient");
  await denied({"/branch_protections/main":{...protection,dismiss_stale_approvals:false}},
    "branch_protection_insufficient");
  await denied({"/branch_protections/main":{...protection,block_admin_merge_override:false}},
    "branch_protection_insufficient");
});
test("rejects malformed inputs and reviewer matching service CI identity",async()=>{
  const {make}=harness();
  await assert.rejects(make().verify({pullRequestNumber:0,expectedHeadSha:a}),
    (e:unknown)=>e instanceof MergeReadinessDenied&&e.reason==="invalid_input");
  await assert.rejects(make().verify({pullRequestNumber:3,expectedHeadSha:"garbage"}),
    (e:unknown)=>e instanceof MergeReadinessDenied&&e.reason==="invalid_input");
  assert.throws(()=>new GiteaMergeReadinessVerifier({
    giteaBaseUrl:"http://user:pass@127.0.0.1",
    readToken:"secret",humanReviewer:owner,securityPipelineActor:ci
  }),/invalid_input/);
  assert.throws(()=>new GiteaMergeReadinessVerifier({
    giteaBaseUrl:"http://127.0.0.1",readToken:"secret",
    humanReviewer:owner,securityPipelineActor:owner
  }),/invalid_input/);
});
test("rejects incomplete provider lists instead of guessing success",async()=>{
  await denied({"/pulls/3/reviews":{review:"APPROVED"}},"malformed_provider_data");
  const over=Array.from({length:1000},(_,i)=>({...reviews[0],id:i+1}));
  await denied({"/pulls/3/reviews":over.slice(0,50)},"malformed_provider_data");
});
