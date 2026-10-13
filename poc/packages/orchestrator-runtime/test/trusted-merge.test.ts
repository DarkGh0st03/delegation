import assert from "node:assert/strict";
import test from "node:test";
import {TrustedGiteaMergeExecutor,TrustedMergeDenied}
  from "../src/trusted-merge.ts";
import {MergeReadinessDenied} from "../src/merge-readiness.ts";

const head="a".repeat(40),base="b".repeat(40),mergedSha="c".repeat(40);
const reviewer={id:101,login:"software-engineer"};
const ci={id:102,login:"trusted-security-ci"};
const writer={id:103,login:"human-merge-controller"};
const api="/api/v1/repos/thesis/iam-console-poc";

function fixture(options:{
  approval?:boolean;ciSuccess?:boolean;
  writerAdmin?:boolean;writerId?:number;writerBot?:boolean;
  staleOnSecondCheck?:boolean;staleDuringMerge?:boolean;
  mergeResponse?:number;ignoreMerge?:boolean;
  reviewerDismissed?:boolean;
}={}){
  const seen:Array<{path:string;method:string;auth:string;body:unknown}>=[];
  let pulls=0,accepted=false;
  const pr=(merged=false)=>({
    number:3,state:merged?"closed":"open",merged,
    mergeable:!merged,
    head:{ref:"feature/account-suspension",sha:head,
      repo:{full_name:"thesis/iam-console-poc"}},
    base:{ref:"main",sha:base,
      repo:{full_name:"thesis/iam-console-poc"}}
  });
  const rule={
    branch_name:"main",enable_push:false,enable_force_push:false,
    required_approvals:1,block_admin_merge_override:true,
    dismiss_stale_approvals:true,block_on_outdated_branch:true
  };
  const reads:Record<string,unknown>={
    [api+"/branches/feature%2Faccount-suspension"]:{commit:{id:head}},
    [api+"/branch_protections/main"]:rule,
    [api+"/pulls/3/reviews"]:options.approval===false?[]:
      options.reviewerDismissed?[
        {id:7,state:"APPROVED",commit_id:head,user:reviewer},
        {id:8,state:"REQUEST_CHANGES",commit_id:head,user:reviewer}
      ]:[{id:7,state:"APPROVED",commit_id:head,user:reviewer}],
    [api+"/commits/"+head+"/statuses"]:options.ciSuccess===false?
      [{id:8,context:"thesis/security-pipeline",status:"pending",
        sha:head,creator:ci}]:
      [{id:8,context:"thesis/security-pipeline",status:"success",
        sha:head,creator:ci}]
  };
  const fetchFn:typeof fetch=async(input,init)=>{
    const u=new URL(String(input)),path=u.pathname;
    const method=init?.method??"GET";
    const auth=new Headers(init?.headers).get("authorization")??"";
    const body=init?.body?JSON.parse(String(init.body)):null;
    seen.push({path,method,auth,body});
    let value:unknown,code=200;
    if(method==="POST"&&path===api+"/pulls/3/merge"){
      code=options.mergeResponse??200;
      if(code===200&&!options.ignoreMerge&&!options.staleDuringMerge){
        accepted=true;
      }
      value={};
      if(options.staleDuringMerge)code=409;
    }else if(path==="/api/v1/user"){
      value={...writer,id:options.writerId??writer.id,
        is_admin:options.writerAdmin??false,
        is_bot:options.writerBot??false};
    }else if(path===api+"/pulls/3"){
      pulls++;
      const stale=options.staleOnSecondCheck&&pulls>=3&&!accepted;
      value=stale?{...pr(),head:{...pr().head,sha:"d".repeat(40)}}:
        pr(accepted);
    }else if(path===api+"/branches/main"){
      value={commit:{id:accepted?mergedSha:base}};
    }else if(path in reads){
      value=reads[path];
    }else{
      code=404;value={message:"not found"};
    }
    return new Response(JSON.stringify(value),{
      status:code,headers:{"content-type":"application/json"}
    });
  };
  const client=new TrustedGiteaMergeExecutor({
    giteaBaseUrl:"http://127.0.0.1:3030",
    readToken:"read-scope",
    branchProtectionReadToken:"rule-inspector",
    humanReviewer:reviewer,
    securityPipelineActor:ci,
    mergeToken:"merge-only-token",
    mergeActor:writer,fetchFn
  });
  const run=()=>client.execute({pullRequestNumber:3,expectedHeadSha:head});
  const writes=()=>seen.filter(x=>x.method!=="GET");
  return {seen,writes,run,client};
}
test("isolated fixture with valid review, CI, protected branch merges only exact head",async()=>{
  const x=fixture();
  const result=await x.run();
  assert.deepEqual(result,{
    merged:true,pull_request_number:3,head_sha:head,
    previous_main_sha:base,merged_main_sha:mergedSha,
    review_id:7,security_status_id:8,merge_actor_id:writer.id
  });
  assert.equal(x.writes().length,1);
  const write=x.writes()[0];
  assert.equal(write.path,api+"/pulls/3/merge");
  assert.equal(write.auth,"token merge-only-token");
  assert.deepEqual(write.body,{
    Do:"merge",head_commit_id:head,force_merge:false,
    merge_when_checks_succeed:false,delete_branch_after_merge:false
  });
  assert.ok(x.seen.filter(x=>x.method==="GET"&&
    x.path.includes("branch_protections")).every(x=>x.auth==="token rule-inspector"));
  assert.ok(x.seen.filter(x=>x.method==="GET"&&
    x.path.includes("/pulls/3/reviews")).every(x=>x.auth==="token read-scope"));
  assert.equal(x.seen.filter(x=>x.path==="/api/v1/user").length,1);
});
test("missing, withdrawn or revised human approval prohibits merge",async()=>{
  for(const options of [{approval:false},{reviewerDismissed:true}]){
    const x=fixture(options);
    await assert.rejects(x.run(),
      (e:unknown)=>e instanceof MergeReadinessDenied&&
        e.reason==="human_approval_missing");
    assert.deepEqual(x.writes(),[]);
  }
});
test("CI pending blocks merge even if human approved",async()=>{
  const x=fixture({ciSuccess:false});
  await assert.rejects(x.run(),
    (e:unknown)=>e instanceof MergeReadinessDenied&&
      e.reason==="security_pipeline_missing");
  assert.deepEqual(x.writes(),[]);
});
test("admin, bot and wrong merge identity cannot bypass branch protection",async()=>{
  for(const options of [{writerAdmin:true},{writerBot:true},{writerId:999}]){
    const x=fixture(options);
    await assert.rejects(x.run(),
      (e:unknown)=>e instanceof TrustedMergeDenied&&
        e.reason==="untrusted_merge_identity");
    assert.deepEqual(x.writes(),[]);
  }
});
test("stale PR detected during second gate: no POST",async()=>{
  const x=fixture({staleOnSecondCheck:true});
  await assert.rejects(x.run(),
    (e:unknown)=>e instanceof MergeReadinessDenied&&
      e.reason==="pr_revision_mismatch");
  assert.deepEqual(x.writes(),[]);
});
test("server rejects stale head at merge transaction: no retries",async()=>{
  const x=fixture({staleDuringMerge:true});
  await assert.rejects(x.run(),
    (e:unknown)=>e instanceof TrustedMergeDenied&&
      e.reason==="provider_rejected");
  assert.equal(x.writes().length,1);
});
test("2xx alone does not prove a merge and cannot become success",async()=>{
  const x=fixture({ignoreMerge:true});
  await assert.rejects(x.run(),
    (e:unknown)=>e instanceof TrustedMergeDenied&&
      e.reason==="merge_not_confirmed");
  assert.equal(x.writes().length,1);
});
test("invalid SHA, missing PR and unsafe remote HTTP fail before merge",async()=>{
  const x=fixture();
  await assert.rejects(x.client.execute({
    pullRequestNumber:3,expectedHeadSha:"nope"
  }),(e:unknown)=>e instanceof TrustedMergeDenied&&
    e.reason==="invalid_input");
  await assert.rejects(x.client.execute({
    pullRequestNumber:0,expectedHeadSha:head
  }),(e:unknown)=>e instanceof TrustedMergeDenied&&
    e.reason==="invalid_input");
  assert.equal(x.seen.length,0);
  assert.throws(()=>new TrustedGiteaMergeExecutor({
    giteaBaseUrl:"http://untrusted.example",readToken:"reader",
    mergeToken:"merger",mergeActor:writer,humanReviewer:reviewer,
    securityPipelineActor:ci
  }),/invalid_input/);
  assert.throws(()=>new TrustedGiteaMergeExecutor({
    giteaBaseUrl:"http://127.0.0.1",readToken:"reader",
    mergeToken:"merger",mergeActor:reviewer,humanReviewer:reviewer,
    securityPipelineActor:ci
  }),/invalid_input/);
});
