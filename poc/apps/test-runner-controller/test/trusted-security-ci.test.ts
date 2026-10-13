import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTrustedSecurityRunnerResult,TrustedGiteaSecurityCi,
  SECURITY_STATUS_CONTEXT
} from "../src/trusted-security-ci.ts";
import type {RunnerRunRequest,RunnerRunResult} from "../src/types.ts";

const sha="a".repeat(40);
const other="b".repeat(40);
const actor={id:27,login:"trusted-ci"};
const request:RunnerRunRequest={
  request_id:"ci-exact-sha-test",
  repository:"gitea://gitea.local/thesis/iam-console-poc",
  branch:"feature/account-suspension",commit_sha:sha,profile:"poc-default"
};
const names=[
  "dependency_install","typecheck","backend_tests",
  "frontend_tests","build","playwright_e2e"
] as const;
function makeResult(projectFailure=false,acceptanceFailure=false):RunnerRunResult{
  const project=names.map((phase,i)=>({
    phase,status:projectFailure&&i===0?"fail" as const:projectFailure?"skipped" as const:"pass" as const
  }));
  const acceptance={phase:"researcher_acceptance" as const,
    status:projectFailure?"skipped" as const:acceptanceFailure?"fail" as const:"pass" as const
  };
  return {
    request_id:request.request_id,repository:request.repository,
    branch:request.branch,tested_commit_sha:sha,runner_profile:"poc-default",
    status:projectFailure||acceptanceFailure?"fail":"pass",
    phases:[...project,acceptance],
    project_tests:{status:projectFailure?"fail":"pass",phases:project},
    researcher_acceptance:acceptance,
    log_reference:"runner-log://real-run-reference"
  };
}
function harness(result:RunnerRunResult=makeResult(true),opts:{
  sha?:string;actor?:{id:number;login:string};throwRunner?:boolean;
  moveAfterRun?:boolean;postError?:boolean
}={}){
  const calls:Array<{method:string;path:string;auth:string;body:Record<string,unknown>|null}>=[];
  let runCount=0,branchReads=0,sequence=0;
  const fetchFn:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    const path=url.pathname,method=init?.method??"GET";
    const auth=new Headers(init?.headers).get("authorization")??"";
    const body=init?.body?JSON.parse(String(init.body)):null;
    calls.push({method,path,auth,body});
    let value:unknown;
    let status=200;
    if(path==="/api/v1/user"){
      value=opts.actor??actor;
    }else if(path.endsWith("/branches/feature%2Faccount-suspension")){
      branchReads++;
      value={commit:{id:opts.moveAfterRun&&branchReads>=2?other:opts.sha??sha}};
    }else if(path.endsWith("/statuses/"+sha)&&method==="POST"){
      sequence++;
      status=201;
      value={id:sequence,context:body.context,status:body.state,
        creator:actor};
      if(opts.postError)status=503;
    }else{status=404;value={error:"no route"};}
    return new Response(JSON.stringify(value),{status,
      headers:{"content-type":"application/json"}});
  };
  const pipeline=new TrustedGiteaSecurityCi({
    giteaBaseUrl:"http://127.0.0.1:3000",
    giteaReadToken:"test-read-token",
    giteaStatusToken:"test-status-token",
    trustedStatusActor:actor,
    runner:{async run(){
      runCount++;
      if(opts.throwRunner)throw Error("docker execution failed");
      return result;
    }},fetchFn
  });
  return {pipeline,calls,getRuns:()=>runCount};
}
test("fixed real Runner phases and researcher acceptance both required for success",()=>{
  assert.equal(classifyTrustedSecurityRunnerResult(makeResult(),request),"success");
  assert.equal(classifyTrustedSecurityRunnerResult(makeResult(true),request),"failure");
  assert.equal(classifyTrustedSecurityRunnerResult(makeResult(false,true),request),"failure");
  assert.throws(()=>classifyTrustedSecurityRunnerResult({
    ...makeResult(),researcher_acceptance:{phase:"researcher_acceptance",status:"skipped"}
  },request),/contradicts|differs/);
  assert.throws(()=>classifyTrustedSecurityRunnerResult({
    ...makeResult(),tested_commit_sha:other
  },request),/exact authorized revision/);
  assert.throws(()=>classifyTrustedSecurityRunnerResult({
    ...makeResult(),project_tests:{status:"pass",phases:[]}
  },request),/fixed complete pipeline evidence/);
  assert.throws(()=>classifyTrustedSecurityRunnerResult({
    ...makeResult(),phases:[...makeResult().phases].reverse()
  },request),/fixed complete pipeline evidence/);
});
test("real failure publishes pending then FAILURE on exact SHA and never success",async()=>{
  const {pipeline,calls,getRuns}=harness();
  const outcome=await pipeline.run(request);
  assert.equal(outcome.status,"failure");
  assert.equal(outcome.tested_commit_sha,sha);
  assert.equal(outcome.context,SECURITY_STATUS_CONTEXT);
  assert.equal(getRuns(),1);
  const post=calls.filter(c=>c.method==="POST");
  assert.deepEqual(post.map(c=>c.body?.state),["pending","failure"]);
  assert.ok(post.every(c=>c.body?.context===SECURITY_STATUS_CONTEXT&&
    c.path.endsWith("/statuses/"+sha)&&c.auth==="token test-status-token"));
  assert.ok(calls.filter(c=>c.method==="GET"&&c.path.includes("/branches/"))
    .every(c=>c.auth==="token test-read-token"));
});
test("only genuine consistent passing evidence may publish success",async()=>{
  const {pipeline,calls}=harness(makeResult());
  const result=await pipeline.run(request);
  assert.equal(result.status,"success");
  assert.deepEqual(calls.filter(c=>c.method==="POST").map(c=>c.body?.state),
    ["pending","success"]);
});
test("stale SHA and incorrect CI identity fail before any status writes",async()=>{
  for(const opts of [{sha:other},{actor:{id:55,login:"attacker"}}]){
    const {pipeline,calls,getRuns}=harness(makeResult(),opts);
    await assert.rejects(pipeline.run(request),/stale branch|wrong actor/);
    assert.equal(getRuns(),0);
    assert.equal(calls.filter(c=>c.method==="POST").length,0);
  }
});
test("runner throw, moved branch and incoherent positive evidence can only produce ERROR",async()=>{
  for(const opts of [{throwRunner:true},{moveAfterRun:true},{}]){
    const malformed=opts.throwRunner||opts.moveAfterRun
      ?makeResult():{...makeResult(),runner_profile:"foreign-profile" as "poc-default"};
    const {pipeline,calls}=harness(malformed,opts);
    await assert.rejects(pipeline.run(request));
    const statuses=calls.filter(c=>c.method==="POST").map(c=>c.body?.state);
    assert.deepEqual(statuses,["pending","error"]);
    assert.equal(statuses.includes("success"),false);
  }
});
test("cannot publish unverifiable status if Gitea refuses the response",async()=>{
  const {pipeline,calls,getRuns}=harness(makeResult(),{postError:true});
  await assert.rejects(pipeline.run(request),/HTTP request failed/);
  assert.equal(getRuns(),0);
  assert.equal(calls.filter(c=>c.method==="POST").length,1);
});
