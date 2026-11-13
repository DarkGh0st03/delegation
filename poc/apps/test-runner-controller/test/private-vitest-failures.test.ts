import {IAM_CONSOLE_PROJECT_PROFILE,projectProfileDigest} from "../../../packages/plan-contracts/src/project-profile.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,readdir,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {extractPrivateVitestFailures as extract} from "../src/private-vitest-failures.ts";
import {IsolatedDockerRunnerExecutor} from "../src/isolated-executor.ts";
const report={success:false,testResults:[{name:"/workspace/tests/frontend/actions.test.tsx",assertionResults:[{
 status:"failed",fullName:"actions keeps previous status on failure",
 failureMessages:["AssertionError: expected SUSPENDED to equal ACTIVE\nPRIVATE_ASSERTION"]
}]}]};
test("private Vitest diagnostics retain failed IDs/messages of canonical project test files only",()=>{
 const result=extract(JSON.stringify(report));
 assert.equal(result.status,"captured");assert.equal(result.failures.length,1);
 assert.equal(result.failures[0].path,"tests/frontend/actions.test.tsx");
 assert.match(result.failures[0].failure_messages[0],/PRIVATE_ASSERTION/);
 for(const raw of ["not json",JSON.stringify({...report,success:true}),"x".repeat(1024*1024+1)])
  assert.equal(extract(raw).status,"unavailable");
 const bad=structuredClone(report);bad.testResults[0].name="/workspace/tests/frontend/../secret.test.ts";
 assert.equal(extract(JSON.stringify(bad)).status,"unavailable");
 const many=structuredClone(report);many.testResults[0].assertionResults=Array(30).fill({
  status:"failed",fullName:"bounded",failureMessages:["x".repeat(9000)]});
 const bounded=extract(JSON.stringify(many));
 assert.equal(bounded.failures.length,16);
 assert.equal(bounded.failures[0].failure_messages[0].length,8000);
});
test("Runner keeps machine-readable assertions exclusively in private SHA-bound manifest",async()=>{
 const root=await mkdtemp(join(tmpdir(),"private-vitest-"));
 try{
  const request={request_id:"r",repository:"gitea://fixture/o/r",branch:"feature/test",commit_sha:"a".repeat(40),profile:"poc-default" as const,project_profile:IAM_CONSOLE_PROJECT_PROFILE,project_profile_sha256:projectProfileDigest(IAM_CONSOLE_PROJECT_PROFILE)};
  const commands:string[][]=[];
  const runner=new IsolatedDockerRunnerExecutor({gitea_base_url:"http://fixture.invalid",gitea_token:"private-token",phase_timeout_ms:1000,log_dir:join(root,"logs"),failure_evidence_dir:join(root,"evidence")},{
   fetch_fn:async url=>String(url).includes("/archive/")?new Response("exact archive"):new Response(JSON.stringify({commit:{id:request.commit_sha}})),
   command_runner:async(_command,args)=>{
    commands.push(args);
    if(args.includes("cat"))return {exit_code:0,stdout:JSON.stringify(report),stderr:"",timed_out:false};
    const fail=args.some(x=>x.includes("vitest run tests/frontend"));
    return {exit_code:fail?1:0,stdout:"",stderr:"",timed_out:false};
   }
  });
  const result=await runner.run(request);
  assert.equal(result.status,"fail");
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ASSERTION|private_vitest_failure|private-token/);
  assert.ok(commands.some(args=>args.includes("cat")&&args.at(-1)==="/tmp/runner-frontend_tests-vitest.json"));
  assert.ok(commands.some(args=>args.some(x=>x.includes("--reporter=default --reporter=json --outputFile="))));
  const dir=join(root,"evidence",(await readdir(join(root,"evidence")))[0]);
  const manifest=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
  assert.equal(manifest.tested_commit_sha,request.commit_sha);
  assert.equal(manifest.private_vitest_failure.status,"captured");
  assert.equal(manifest.private_vitest_failure.causal_attribution,"not_established");
  assert.match(JSON.stringify(manifest.private_vitest_failure),/PRIVATE_ASSERTION/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("Runner FAIL response names the failed tests with their cleaned error message",async()=>{
 const root=await mkdtemp(join(tmpdir(),"runner-test-failures-"));
 try{
  const request={request_id:"r",repository:"gitea://fixture/o/r",branch:"feature/test",commit_sha:"a".repeat(40),profile:"poc-default" as const,project_profile:IAM_CONSOLE_PROJECT_PROFILE,project_profile_sha256:projectProfileDigest(IAM_CONSOLE_PROJECT_PROFILE)};
  // No private evidence directory: the messages still reach the response.
  const runner=new IsolatedDockerRunnerExecutor({gitea_base_url:"http://fixture.invalid",gitea_token:"private-token",phase_timeout_ms:1000,log_dir:join(root,"logs")},{
   fetch_fn:async url=>String(url).includes("/archive/")?new Response("exact archive"):new Response(JSON.stringify({commit:{id:request.commit_sha}})),
   command_runner:async(_command,args)=>{
    if(args.includes("cat"))return {exit_code:0,stdout:JSON.stringify(report),stderr:"",timed_out:false};
    const fail=args.some(x=>x.includes("vitest run tests/frontend"));
    return {exit_code:fail?1:0,stdout:fail?" FAIL  tests/frontend/actions.test.tsx > actions keeps previous status on failure\n":"",stderr:"",timed_out:false};
   }
  });
  const result=await runner.run(request);
  assert.equal(result.status,"fail");
  assert.deepEqual(result.failing_test_files,["tests/frontend/actions.test.tsx"]);
  assert.deepEqual(result.test_failures,[{file:"tests/frontend/actions.test.tsx",
   test:"actions keeps previous status on failure",
   message:"AssertionError: expected SUSPENDED to equal ACTIVE\nPRIVATE_ASSERTION"}]);
  assert.doesNotMatch(JSON.stringify(result),/private-token/);
 }finally{await rm(root,{recursive:true,force:true});}
});
