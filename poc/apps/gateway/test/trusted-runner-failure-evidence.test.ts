import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {RunnerClient} from "../src/runner-client.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {DurableAuthorityOnlyRunnerIntentJournal}
 from "../src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedGatewayRunnerFailEvidencePublisher,
 AuthenticatedRunnerFailureObserver}
 from "../src/trusted-authority-only-runner-failure-evidence.ts";
const branch="feature/account-suspension",sha="a".repeat(40);
const binding={
 session_id:"r336-session",authority_digest:"b".repeat(64),
 root_credential_id:"root-r336",task_id:"test-r336",
 runtime_task_id:"dispatch_"+"X".repeat(22),epoch:3,
 agent_did:"did:thesis:test",credential_id:"child-r336",
 request_id:"request-r336",request_fingerprint:"c".repeat(64)
};
const intent={
 schema:"authority-only-runner-intent-v1" as const,
 kind:"runner_test_commit_preflight_only" as const,
 ...binding,repository:"thesis/iam-console-poc",branch,
 expected_head_sha:sha,runner_profile:"poc-default" as const,
 prepared_at_ms:1762400000000,runner_execution_authorized:false as const
};
const request={
 request_id:binding.request_id,repository:"gitea://gitea.local/"+intent.repository,
 branch,commit_sha:sha,profile:"poc-default" as const
};
const phases=["dependency_install","typecheck","backend_tests",
 "frontend_tests","build","playwright_e2e","researcher_acceptance"];
function failure(){
 const states=phases.map((phase,i)=>({phase,status:i<1?"pass":i===1?"fail":"skipped"}));
 return {
  request_id:request.request_id,repository:request.repository,branch,
  tested_commit_sha:sha,runner_profile:"poc-default",status:"fail",
  phases:states,project_tests:{status:"fail",phases:states.slice(0,6)},
  researcher_acceptance:states[6],
  log_reference:"runner-log://12345678-1234-1234-1234-123456789abc"
 };
}
async function fixture(action:(p:{
 publisher:TrustedGatewayRunnerFailEvidencePublisher;
 observer:AuthenticatedRunnerFailureObserver;
 runner:RunnerClient;directory:string;move:(head:string)=>void;
 })=>Promise<void>,body:unknown=failure(),attempted=true){
 const temp=await mkdtemp(join(tmpdir(),"r336-"));
 const directory=join(temp,"proofs");await mkdir(directory,{mode:0o700});
 const attemptDirectory=join(temp,"attempts");
 await mkdir(attemptDirectory,{mode:0o700});
 const journal=new DurableAuthorityOnlyRunnerIntentJournal(attemptDirectory);
 await journal.reserve(intent);
 if(attempted)await journal.reserveAttempt(intent);
 let head=sha;
 const gitea=new GiteaClient({
  baseUrl:"http://gitea.local:3000",token:"independent-only",
  owner:"thesis",repository:"iam-console-poc",
  fetchFn:(async(_url:URL|string,init?:RequestInit)=>{
   assert.equal(init?.method,"GET");
   return new Response(JSON.stringify({name:branch,commit:{id:head}}));
  }) as typeof fetch
 });
 const runner=new RunnerClient({
  baseUrl:"http://runner.internal:8095",gatewayToken:"private-runner",
  fetchFn:(async(_url:URL|string,init?:RequestInit)=>{
   assert.equal(init?.method,"POST");
   assert.deepEqual(JSON.parse(String(init?.body)),request);
   return new Response(JSON.stringify(body),{status:200});
  }) as typeof fetch
 });
 const key=Buffer.alloc(32,21),nowMs=()=>1762400001000;
 try{
  await action({
   publisher:new TrustedGatewayRunnerFailEvidencePublisher({
    directory,key,runnerClient:runner,journal,independentGiteaClient:gitea,
    repository:intent.repository,branch,nowMs
   }),
   observer:new AuthenticatedRunnerFailureObserver({
    directory,key,giteaClient:gitea,journal,
    repository:intent.repository,branch,nowMs
   }),
   runner,directory,move:value=>{head=value;}
  });
 }finally{await rm(temp,{recursive:true,force:true});}
}
test("R336 original verified Runner FAIL is durably MAC protected and NOT D1 authority",async()=>{
 await fixture(async({publisher,observer,runner,directory})=>{
  const result=await runner.run(request);
  const digest=await publisher.publish(intent,binding,request,result,"opa-r336");
  const observed=await observer.observe(intent,binding);
  assert.equal(observed.evidence_sha256,digest);
  assert.equal(observed.first_failed_phase,"typecheck");
  assert.equal(observed.repair_candidate,true);
  assert.equal(observed.gateway_task_completed,false);
  assert.equal(observed.recovery_authorized,false);
  assert.equal(observed.tested_commit_sha,sha);
  assert.equal((await readdir(directory)).length,1);
  await assert.rejects(publisher.publish(intent,binding,request,result,"opa-r336"),
   /EEXIST/);
  await assert.rejects(observer.observe(intent,{
   ...binding,credential_id:"foreign-child"
  }),/violates signed Task/);
 });
});
test("R355.9 authenticated Runner FAIL retains only bounded TypeScript error codes",async()=>{
 await fixture(async({publisher,observer,runner,directory})=>{
  const result=await runner.run(request);
  assert.deepEqual(result.typecheck_error_codes,["TS2322","TS2345"]);
  const digest=await publisher.publish(intent,binding,request,result,"opa-r3559");
  const observed=await observer.observe(intent,binding);
  assert.equal(observed.evidence_sha256,digest);
  assert.deepEqual(observed.typecheck_error_codes,["TS2322","TS2345"]);
  assert.equal(observed.gateway_task_completed,false);
  assert.equal(observed.recovery_authorized,false);
  const [name]=await readdir(directory);
  const row=JSON.parse(await readFile(join(directory,name),"utf8"));
  assert.deepEqual(row.typecheck_error_codes,["TS2322","TS2345"]);
  row.typecheck_error_codes=["TS9999"];
  await writeFile(join(directory,name),JSON.stringify(row)+"\n");
  await assert.rejects(observer.observe(intent,binding),/MAC invalid/);
 },{...failure(),typecheck_error_codes:["TS2322","TS2345"]});
});
test("R336 copied FAIL, moved Gitea and tampered MAC fail closed",async()=>{
 await fixture(async({publisher,observer,runner,move,directory})=>{
  const result=await runner.run(request);
  await assert.rejects(publisher.publish(intent,binding,request,
   structuredClone(result),"opa"),/provenance/);
  move("d".repeat(40));
  await assert.rejects(publisher.publish(intent,binding,request,result,"opa"),
   /moved or stale/);
  move(sha);
  await publisher.publish(intent,binding,request,result,"opa");
  move("d".repeat(40));
  await assert.rejects(observer.observe(intent,binding),/moved or stale/);
  move(sha);
  const [name]=await readdir(directory);
  const row=JSON.parse(await readFile(join(directory,name),"utf8"));
  row.first_failed_phase="backend_tests";
  await writeFile(join(directory,name),JSON.stringify(row)+"\n");
  await assert.rejects(observer.observe(intent,binding),/MAC invalid/);
 });
});
test("R336 status PASS cannot publish FAIL evidence",async()=>{
 await fixture(async({runner,publisher,directory})=>{
  const result=await runner.run(request);
  await assert.rejects(publisher.publish(intent,binding,request,result,"opa"),
   /differs from original immutable Test intent/);
  assert.deepEqual(await readdir(directory),[]);
 },{...failure(),status:"pass"});
});

test("R337 missing durable original POST attempt cannot publish or observe FAIL",async()=>{
 await fixture(async({runner,publisher,observer,directory})=>{
  const result=await runner.run(request);
  await assert.rejects(publisher.publish(intent,binding,request,result,"opa"),
   /ENOENT|no such file/);
  await assert.rejects(observer.observe(intent,binding),
   /ENOENT|no such file/);
  assert.deepEqual(await readdir(directory),[]);
 },failure(),false);
});
