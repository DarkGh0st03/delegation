import assert from "node:assert/strict";
import test from "node:test";
import {TrustedGiteaSecurityCi,SECURITY_STATUS_CONTEXT}
 from "../../../apps/test-runner-controller/src/trusted-security-ci.ts";
import {GiteaMergeReadinessVerifier,MergeReadinessDenied}
 from "../src/merge-readiness.ts";
import type {RunnerRunRequest,RunnerRunResult}
 from "../../../apps/test-runner-controller/src/types.ts";

/** R396: same-PR/SHA Security CI -> read-only Human Gate integration.
 * One shared disposable Gitea HTTP fixture, not a claim of live Gitea or
 * native Docker execution. Only the independent controlled Runner can
 * publish the fixed CI status. No method exposes approval or merge writes.
 */
const HEAD="a".repeat(40),BASE="b".repeat(40),MOVED="c".repeat(40);
const REPO="/api/v1/repos/thesis/iam-console-poc";
const actor={id:227,login:"thesis-security-ci"};
const human={id:228,login:"thesis-human-reviewer"};
const request:RunnerRunRequest={
 request_id:"r396-readiness-fixed-commit",
 repository:"gitea://gitea.local/thesis/iam-console-poc",
 branch:"feature/account-suspension",commit_sha:HEAD,profile:"poc-default"
};
const phases=["dependency_install","typecheck","backend_tests",
 "frontend_tests","build","playwright_e2e"] as const;
const result:RunnerRunResult={
 request_id:request.request_id,repository:request.repository,
 branch:request.branch,tested_commit_sha:HEAD,runner_profile:"poc-default",
 status:"pass",
 phases:[...phases.map(phase=>({phase,status:"pass" as const})),
  {phase:"researcher_acceptance" as const,status:"pass" as const}],
 project_tests:{status:"pass",
  phases:phases.map(phase=>({phase,status:"pass" as const}))},
 researcher_acceptance:{phase:"researcher_acceptance",status:"pass"},
 log_reference:"runner-log://r396-original-signed-pass"
};

test("R396: one actual CI status producer and read-only Gate see same PR and exact SHA",async()=>{
 const statusRows:Array<{id:number;status:string;context:string;
  creator:typeof actor;sha:string}>=[];
 const calls:Array<{method:string;path:string;auth:string}>=[];
 let branchHead=HEAD,prHead=HEAD;
 let running!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{running=resolve;});
 const proceed=new Promise<void>(resolve=>{release=resolve;});
 let runnerCalls=0;
 const fetchFn:typeof fetch=async(raw,init)=>{
  const url=new URL(String(raw)),path=url.pathname;
  const method=init?.method??"GET";
  const auth=new Headers(init?.headers).get("authorization")??"";
  calls.push({method,path,auth});
  let value:unknown;let status=200;
  if(path==="/api/v1/user"&&method==="GET"){
   assert.equal(auth,"token ci-writer-private");
   value=actor;
  }else if(path===REPO+"/branches/feature%2Faccount-suspension"&&method==="GET"){
   value={commit:{id:branchHead}};
  }else if(path===REPO+"/branches/main"&&method==="GET"){
   value={commit:{id:BASE}};
  }else if(path===REPO+"/pulls/17"&&method==="GET"){
   value={number:17,state:"open",merged:false,draft:false,mergeable:true,
    head:{ref:"feature/account-suspension",sha:prHead,
     repo:{full_name:"thesis/iam-console-poc"}},
    base:{ref:"main",sha:BASE,repo:{full_name:"thesis/iam-console-poc"}}};
  }else if(path===REPO+"/pulls/17/reviews"&&method==="GET"){
   value=[{id:19,state:"APPROVED",commit_id:HEAD,user:human}];
  }else if(path===REPO+"/branch_protections/main"&&method==="GET"){
   assert.equal(auth,"token protection-reader");
   value={branch_name:"main",enable_push:false,enable_force_push:false,
    required_approvals:1,block_admin_merge_override:true,
    dismiss_stale_approvals:true,block_on_outdated_branch:true};
  }else if(path===REPO+"/commits/"+HEAD+"/statuses"&&method==="GET"){
   value=[...statusRows];
  }else if(path===REPO+"/statuses/"+HEAD&&method==="POST"){
   assert.equal(auth,"token ci-writer-private");
   const body=JSON.parse(String(init?.body));
   assert.equal(body.context,SECURITY_STATUS_CONTEXT);
   assert.ok(["pending","success","failure","error"].includes(body.state));
   const row={id:statusRows.length+1,status:body.state as string,
    context:body.context as string,creator:actor,sha:HEAD};
   statusRows.push(row);value=row;status=201;
  }else{
   throw Error("Unexpected Gitea operation, possibly unauthorized merge: "+
    method+" "+path);
  }
  return Response.json(value,{status});
 };
 const trustedCi=new TrustedGiteaSecurityCi({
  giteaBaseUrl:"http://127.0.0.1:3000",
  giteaReadToken:"ci-read-only",
  giteaStatusToken:"ci-writer-private",
  trustedStatusActor:actor,
  runner:{async run(r){
   runnerCalls++;
   assert.deepEqual(r,request);
   running();await proceed;
   return result;
  }},fetchFn
 });
 const gate=new GiteaMergeReadinessVerifier({
  giteaBaseUrl:"http://127.0.0.1:3000",
  readToken:"gate-read-only",
  branchProtectionReadToken:"protection-reader",
  humanReviewer:human,securityPipelineActor:actor,fetchFn
 });
 const denied=async(reason:string)=>
  assert.rejects(gate.verify({pullRequestNumber:17,expectedHeadSha:HEAD}),
   (e:unknown)=>e instanceof MergeReadinessDenied&&e.reason===reason);
 const inFlight=trustedCi.run(request);
 await started;
 assert.deepEqual(statusRows.map(x=>x.status),["pending"]);
 await denied("security_pipeline_missing");
 release();
 const outcome=await inFlight;
 assert.equal(outcome.status,"success");
 assert.equal(outcome.tested_commit_sha,HEAD);
 assert.equal(outcome.context,SECURITY_STATUS_CONTEXT);
 assert.equal(outcome.gitea_status_id,2);
 const ready=await gate.verify({pullRequestNumber:17,expectedHeadSha:HEAD});
 assert.equal(ready.ready,true);
 assert.equal(ready.pull_request_number,17);
 assert.equal(ready.head_sha,HEAD);
 assert.equal(ready.base_sha,BASE);
 assert.equal(ready.pipeline_actor_id,actor.id);
 assert.equal(ready.reviewer_id,human.id);
 assert.equal(ready.security_status_id,2);
 assert.deepEqual(statusRows.map(x=>x.status),["pending","success"]);
 assert.equal(runnerCalls,1);
 const writes=calls.filter(c=>c.method!=="GET");
 assert.equal(writes.length,2);
 assert.ok(writes.every(c=>c.method==="POST"&&
  c.path===REPO+"/statuses/"+HEAD&&c.auth==="token ci-writer-private"));
 assert.ok(calls.filter(c=>c.method==="GET"&&
  c.path.startsWith(REPO)).every(c=>c.auth!=="token ci-writer-private"),
  "Human Gate must never inherit the CI status writer token");
 branchHead=MOVED;
 await denied("pr_revision_mismatch");
 branchHead=HEAD;prHead=MOVED;
 await denied("pr_revision_mismatch");
 prHead=HEAD;
 statusRows.push({id:3,status:"pending",context:SECURITY_STATUS_CONTEXT,
  creator:actor,sha:HEAD});
 await denied("security_pipeline_missing");
 assert.equal(calls.filter(c=>c.method==="POST").length,2,
  "readiness gate does not approve, publish statuses or invoke merges");
});
