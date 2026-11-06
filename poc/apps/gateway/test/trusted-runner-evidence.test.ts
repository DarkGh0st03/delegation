import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,rm,readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {RunnerClient} from "../src/runner-client.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,
 AuthenticatedRunnerCompletionObserver}
 from "../src/trusted-authority-only-runner-evidence.ts";

const branch="feature/account-suspension";
const head="a".repeat(40);
const request={
 request_id:"request-r303",
 repository:"gitea://gitea.local/thesis/iam-console-poc",
 branch,commit_sha:head,profile:"poc-default" as const
};
const expected={
 session_id:"r303-session",authority_digest:"b".repeat(64),
 root_credential_id:"urn:r303:root",task_id:"task-r303",
 runtime_task_id:"runtime-r303",epoch:1,
 agent_did:"did:thesis:test",credential_id:"urn:r303:child",
 request_id:request.request_id,request_fingerprint:"c".repeat(64)
};
const intent={
 schema:"authority-only-runner-intent-v1" as const,
 kind:"runner_test_commit_preflight_only" as const,
 ...expected,repository:"thesis/iam-console-poc",branch,
 expected_head_sha:head,runner_profile:"poc-default" as const,
 prepared_at_ms:1762340000000,runner_execution_authorized:false as const
};
const PHASES=["dependency_install","typecheck","backend_tests",
 "frontend_tests","build","playwright_e2e"];
function success(){
 return {
  request_id:request.request_id,repository:request.repository,
  branch,tested_commit_sha:head,
  runner_profile:"poc-default",status:"pass",
  phases:[...PHASES,"researcher_acceptance"].map(phase=>({
   phase,status:"pass"
  })),
  project_tests:{status:"pass",phases:PHASES.map(phase=>({
   phase,status:"pass"
  }))},
  researcher_acceptance:{phase:"researcher_acceptance",status:"pass"},
  log_reference:"runner-log://12345678-1234-1234-1234-123456789abc"
 };
}
async function fixture(fn:(x:{
 publisher:TrustedGatewayRunnerPassEvidencePublisher;
 observer:AuthenticatedRunnerCompletionObserver;
 runner:RunnerClient;dir:string;
 setHead:(value:string)=>void;
})=>Promise<void>,payload:unknown=success()){
 const root=await mkdtemp(join(tmpdir(),"r303-pass-receipt-"));
 const dir=join(root,"receipts");
 await mkdir(dir,{mode:0o700});
 let actualHead=head;
 const gitea=new GiteaClient({
  baseUrl:"http://gitea.local:3000",token:"independent-only",
  owner:"thesis",repository:"iam-console-poc",
  fetchFn:(async(raw:URL|string,init?:RequestInit)=>{
   assert.equal(init?.method,"GET");
   assert.ok(new URL(String(raw)).pathname.endsWith(
    "/branches/feature%2Faccount-suspension"));
   return new Response(JSON.stringify({name:branch,
    commit:{id:actualHead}}));
  }) as typeof fetch
 });
 const runner=new RunnerClient({
  baseUrl:"http://runner.internal:8095",
  gatewayToken:"owner-private-token",
  fetchFn:(async(_raw:URL|string,init?:RequestInit)=>{
   assert.equal(init?.method,"POST");
   assert.equal((init.headers as Record<string,string>).authorization,
    "Bearer owner-private-token");
   assert.deepEqual(JSON.parse(String(init.body)),request);
   return new Response(JSON.stringify(payload),{status:200});
  }) as typeof fetch
 });
 const key=Buffer.alloc(32,19),nowMs=()=>1762340001000;
 try{
  await fn({runner,dir,
   publisher:new TrustedGatewayRunnerPassEvidencePublisher({
    directory:dir,key,runnerClient:runner,
    independentGiteaClient:gitea,
    repository:"thesis/iam-console-poc",branch,nowMs
   }),
   observer:new AuthenticatedRunnerCompletionObserver({
    directory:dir,key,giteaClient:gitea,
    repository:"thesis/iam-console-poc",branch,nowMs
   }),
   setHead:value=>{actualHead=value;}
  });
 }finally{await rm(root,{recursive:true,force:true});}
}
test("R303.3 signed PASS receipt reopens with MAC, tested SHA and original Task Child",async()=>{
 await fixture(async({runner,publisher,observer,dir})=>{
  const result=await runner.run(request);
  const digest=await publisher.publish(
   intent,expected,request,result,"opa-r303");
  const verified=await observer.observe(expected);
  assert.equal(verified.evidence_sha256,digest);
  assert.equal(verified.status,"owner_verified_provider_result");
  assert.equal(verified.credential_id,expected.credential_id);
  await assert.rejects(publisher.publish(
   intent,expected,request,result,"opa-r303"),/EEXIST/);
  await assert.rejects(observer.observe({
   ...expected,credential_id:"urn:foreign:child"
  }),/differs from signed Task/);
  const [filename]=await readdir(dir);
  const written=await readFile(join(dir,filename),"utf8");
  assert.ok(!written.includes("owner-private-token"));
  const tampered=JSON.parse(written);
  tampered.tested_commit_sha="d".repeat(40);
  await writeFile(join(dir,filename),JSON.stringify(tampered)+"\n","utf8");
  await assert.rejects(observer.observe(expected),/invalid owner MAC/);
 });
});
test("R303.3 moved Gitea HEAD after PASS cannot unlock Test Task",async()=>{
 await fixture(async({runner,publisher,observer,setHead})=>{
  const result=await runner.run(request);
  setHead("d".repeat(40));
  await assert.rejects(publisher.publish(intent,expected,request,result,
   "opa"),/stale or moved feature branch/);
  setHead(head);
  await publisher.publish(intent,expected,request,result,"opa");
  setHead("d".repeat(40));
  await assert.rejects(observer.observe(expected),
   /stale or moved feature branch/);
 });
});
test("R303.3 foreign Child, SHA, fake or failed Runner result cannot publish PASS",async()=>{
 await fixture(async({runner,publisher,dir})=>{
  const result=await runner.run(request);
  await assert.rejects(publisher.publish({...intent,
   credential_id:"urn:other:child"},expected,request,result,"opa"),
   /belongs to another Task/);
  await assert.rejects(publisher.publish(intent,expected,{
   ...request,commit_sha:"d".repeat(40)
  },result,"opa"),/belongs to another Task/);
  await assert.rejects(publisher.publish(intent,expected,request,
   structuredClone(result),"opa"),/provenance/);
  assert.equal((await readdir(dir)).length,0);
 });
 await fixture(async({runner,publisher,dir})=>{
  const result=await runner.run(request);
  await assert.rejects(publisher.publish(intent,expected,request,
   result,"opa"),/Runner PASS claim/);
  assert.equal((await readdir(dir)).length,0);
 },{...success(),status:"fail"});
});


test("R353.0 original authenticated PASS exposes only independently current tested HEAD",async()=>{
 await fixture(async({runner,publisher,observer,setHead})=>{
  await assert.rejects(observer.observeTestedHead(expected),/ENOENT/);
  const result=await runner.run(request);
  const digest=await publisher.publish(intent,expected,request,result,"opa");
  const proof=await observer.observeTestedHead(expected);
  assert.equal(proof.tested_commit_sha,head);
  assert.equal(proof.repository,"thesis/iam-console-poc");
  assert.equal(proof.branch,branch);
  assert.equal(proof.project_tests,"pass");
  assert.equal(proof.researcher_acceptance,"pass");
  assert.equal(proof.completion.evidence_sha256,digest);
  assert.deepEqual(proof.completion,await observer.observe(expected));
  assert.equal(Object.isFrozen(proof),true);
  assert.equal(Object.isFrozen(proof.completion),true);
  await assert.rejects(observer.observeTestedHead({...expected,
   root_credential_id:"foreign-root"}),/differs from signed Task/);
  setHead("d".repeat(40));
  await assert.rejects(observer.observeTestedHead(expected),/stale or moved/);
 });
});
test("R353.0 a tampered PASS cannot provide a PR tested SHA",async()=>{
 await fixture(async({runner,publisher,observer,dir})=>{
  const result=await runner.run(request);
  await publisher.publish(intent,expected,request,result,"opa");
  const [filename]=await readdir(dir);
  const path=join(dir,filename);
  const row=JSON.parse(await readFile(path,"utf8"));
  row.tested_commit_sha="e".repeat(40);
  await writeFile(path,JSON.stringify(row)+"\n");
  await assert.rejects(observer.observeTestedHead(expected),/invalid owner MAC/);
 });
});
test("R353.0 observer owner binding rejects foreign repository, branch and prototype spoof",async()=>{
 await fixture(async({observer})=>{
  assert.equal(AuthenticatedRunnerCompletionObserver.isForRepository(
   observer,"thesis/iam-console-poc",branch),true);
  assert.equal(AuthenticatedRunnerCompletionObserver.isForRepository(
   observer,"thesis/other",branch),false);
  assert.equal(AuthenticatedRunnerCompletionObserver.isForRepository(
   observer,"thesis/iam-console-poc","feature/other"),false);
  assert.equal(AuthenticatedRunnerCompletionObserver.isForRepository(
   Object.create(AuthenticatedRunnerCompletionObserver.prototype),
   "thesis/iam-console-poc",branch),false);
 });
});

test("R353.0 public projection override cannot replace existing completion verification",async()=>{
 await fixture(async({runner,publisher,observer,dir})=>{
  const result=await runner.run(request);
  await publisher.publish(intent,expected,request,result,"opa");
  Object.defineProperty(observer,"observeTestedHead",{value:async()=>{
   throw Error("overridden projection must not run");
  }});
  assert.equal((await observer.observe(expected)).status,"owner_verified_provider_result");
  const [filename]=await readdir(dir);
  const path=join(dir,filename);
  const row=JSON.parse(await readFile(path,"utf8"));
  row.tested_commit_sha="f".repeat(40);
  await writeFile(path,JSON.stringify(row)+"\n");
  await assert.rejects(observer.observe(expected),/invalid owner MAC/);
 });
});
