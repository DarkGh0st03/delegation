/**
 * R385.7: executable, source-derived offline ADK integration.
 * This is intentionally NOT a native Rust/EVM/Gitea/OPA/MCP E2E and NOT
 * generative AI: disposable files + actual Node test subprocesses, with
 * simulated original owner/Gateway journals, make its limits explicit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {BaseLlm} from "@google/adk";
import {runTrustedAuthorityOnlyAdaptiveWorkLoop as run}
 from "../src/trusted-authority-only-adaptive-work-loop.mjs";
import {selectTrustedRepairDiagnosticRead as verifyRead}
 from "../src/trusted-authority-only-repair-diagnostic-gate.mjs";

const exec=promisify(execFile),digest=s=>createHash("sha256").update(s).digest("hex");
const head=s=>createHash("sha1").update(s).digest("hex");
const branch="feature/account-suspension";
const base="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension";
const path="apps/backend/suspension.mjs",resource=base+"/files/"+path;
const grant=(operation,res=resource)=>({operation,resource:res});
const originals=[
 'export function suspend(user){return {...user,status:user.status};}\n// independent metadata A\n',
 'export function suspend(user){return {...user,status:"ACTIVE"};}\n// independent metadata B\n'
];
const target='"SUSPENDED"';
const testSource=[
 'import test from "node:test";',
 'import assert from "node:assert/strict";',
 'import {suspend} from "../apps/backend/suspension.mjs";',
 'test("suspendUser state transition",()=>{',
 ' assert.equal(suspend({id:"usr-001",status:"ACTIVE"}).status,"SUSPENDED");',
 '});'
].join("\n")+"\n";
const choice=(task_id,agent_id,depends_on,permissions,instruction)=>({
 action:"delegate",task:{task_id,agent_id,depends_on,permissions,instruction}
});
const readChoice=choice("diagnose-backend","backend",[],[grant("read_file")],
 "Read actual signed Backend file at the original current HEAD");
const repair=(from)=>choice("repair-backend","backend",["diagnose-backend"],
 [grant("read_file"),grant("update_file")],
 JSON.stringify({edit:"replace-exact-status-expression",from,to:target}));
const retest=choice("retest","test",["repair-backend"],[grant("run_tests",base)],
 "Retest changed HEAD with independent Node test runner");

class SourceDrivenDecider extends BaseLlm{
 constructor(){super({model:"r3857-source-derived-zero-cost-adk"});this.calls=0;this.requestTexts=[];
  this.selectedFrom=null;this.sawFailure=false;this.sawSource=false;}
 async *generateContentAsync(request){
  const prompt=JSON.stringify(request);
  this.requestTexts.push(prompt);
  const step=this.calls++;
  let result;
  if(step===0)result=choice("original-test","test",[],[grant("run_tests",base)],
   "Run Node project test on signed initial HEAD");
  else if(step===1){
   assert.match(prompt,/independent_runner_failure/u);
   assert.doesNotMatch(prompt,/source_observations/u);
   this.sawFailure=true;result=readChoice;
  }else if(step===2){
   assert.match(prompt,/source_observations/u);
   assert.match(prompt,/source_sha256/u);
   assert.match(prompt,/independent_runner_failure/u);
   assert.match(prompt,/independently_gateway_completed_tasks/u);
   this.sawSource=true;
   // The model is NOT initialized with either source variant. It chooses
   // a different exact edit from the authenticated read excerpt alone.
   const from=prompt.includes("status:user.status")?"user.status":
    prompt.includes("status:")&&prompt.includes("ACTIVE")?'"ACTIVE"':null;
   if(!from)throw Error("R385.7 ADK decision has no authenticated source expression");
   this.selectedFrom=from;result=repair(from);
  }else if(step===3){
   assert.doesNotMatch(prompt,/source_observations/u,
    "stale source evidence must be dropped after the independent CAS");
   result=retest;
  }else if(step===4){
   assert.match(prompt,/retest/u);
   result={action:"ready_for_pr",reason:"Independently completed latest Test PASS"};
  }else throw Error("R385.7 unexpected further ADK decision");
  yield {content:{role:"model",parts:[{text:JSON.stringify(result)}]}};
 }
 connect(){throw Error("R385.7 network/inference connections are prohibited");}
}

async function fixture(t,source,{forgery=null}={}){
 const dir=await mkdtemp(join(tmpdir(),"delegation-r3857-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,"apps/backend"),{recursive:true});
 await mkdir(join(dir,"tests"),{recursive:true});
 const sourceFile=join(dir,path),testFile=join(dir,"tests/suspend.test.mjs");
 await writeFile(sourceFile,source);
 await writeFile(testFile,testSource);
 let originalHead=head(source),nextEpoch=1,retired=false,failed=null;
 let completed=[],evidence=null,readRecords=[],actualRunnerResults=[],updates=0;
 let verifierCalls=0,mutationsBeforeRead=0;
 const events=[];
 const roots=[grant("read_file"),grant("update_file"),grant("run_tests",base)];
 const capabilities={backend:{capabilities:["read_file","update_file"]},
  test:{capabilities:["run_tests"]}};
 const model=new SourceDrivenDecider();
 async function runIndependentTest(){
  // Node's parent test runner injects NODE_TEST_CONTEXT=child-v8.
  // If inherited, a nested 'node --test' silently runs ZERO tests and
  // exits 0. Remove that internal variable and require authentic TAP
  // counts: otherwise a fake green subprocess would authorize a PR.
  const env={...process.env};
  delete env.NODE_TEST_CONTEXT;
  let ok=false,out="";
  try{
   const result=await exec(process.execPath,["--test",testFile],
    {cwd:dir,timeout:10000,env});
   out=String(result.stdout??"");
   if(!/^# tests 1$/mu.test(out)||!/^# pass 1$/mu.test(out)||
      !out.includes("suspendUser state transition"))
    throw Error("R385.7 independent Node PASS has no complete TAP receipt");
   ok=true;
  }catch(error){
   if(error.code!==1||!/^# tests 1$/mu.test(String(error.stdout??""))||
      !/^# fail 1$/mu.test(String(error.stdout??""))||
      !String(error.stdout??"").includes("suspendUser state transition"))
    throw Error("R385.7 unverifiable nested Node test result",{cause:error});
   out=String(error.stdout??"");
  }
  actualRunnerResults.push(ok?"pass":"fail");
  return {ok,proof:digest("independent-node-runner|"+originalHead+"|"+(ok?"pass":"fail")),
   output:out};
 }
 const hooks={
  async readContext(){
   if(retired)throw Error("original Root retired");
   const live=await readFile(sourceFile,"utf8");
   const current=head(live);
   if(current!==originalHead)throw Error("original owner HEAD diverged without CAS");
   const observed=evidence?.revision===current?[{
    task_id:evidence.task_id,agent_id:"backend",path,
    revision:evidence.revision,source_sha256:evidence.source_sha256,
    source_bytes:evidence.source_bytes,excerpt:evidence.excerpt,
    excerpt_truncated:false,evidence_sha256:evidence.evidence_sha256
   }]:[];
   return {requirement:"Implement Account Suspension with exact signed permissions",
    branch,maxVerifiedFailures:2,rootPermissions:roots,
    agents:capabilities,
    previousTasks:completed.map(p=>({task_id:p.task_id,agent_id:p.agent_id})),
    nextEpoch,executionProgress:{current_head_sha:originalHead,
     completed_work:completed.map(p=>({...p})),
     ...(observed.length?{source_observations:observed}:{})},
    ...(failed?{verifiedFailure:{
     failed_phase:"backend_tests",source_evidence_sha256:failed.source_evidence_sha256},
     verifiedFailureHistory:[{failed_task_id:failed.failed_task_id,
      failed_phase:"backend_tests",source_evidence_sha256:failed.source_evidence_sha256,
      tested_commit_sha:failed.tested_commit_sha}]}:{})
   };
  },
  async beforeDecision(){events.push("owner_decision");},
  async executeTask(task,context){
   assert.equal(retired,false);
   assert.equal(context.executionProgress.current_head_sha,originalHead);
   assert.ok(task.permissions.every(p=>roots.some(g=>
    g.operation===p.operation&&g.resource===p.resource)));
   const epoch=nextEpoch++;
   const operation=task.permissions.find(p=>p.operation==="update_file"||
    p.operation==="run_tests")?.operation??"read_file";
   events.push("provider:"+operation+":"+task.task_id);
   if(operation==="run_tests"){
    const outcome=await runIndependentTest();
    if(!outcome.ok){
     assert.equal(task.task_id,"original-test");
     failed={failed_task_id:task.task_id,failed_runtime_task_id:"dispatch_"+"F".repeat(22),
      tested_commit_sha:originalHead,failed_phase:"backend_tests",
      source_evidence_sha256:outcome.proof,epoch,
      status:"owner_verified_native_test_failure_preflight_only",
      gateway_task_completed:false,recovery_authorized:false};
     return {status:"owner_verified_native_test_failure_preflight_only"};
    }
   }else if(operation==="read_file"){
    const actual=await readFile(sourceFile,"utf8");
    assert.equal(head(actual),originalHead);
    const evidenceDigest=digest("signed-read|"+epoch+"|"+originalHead+"|"+actual);
    evidence={task_id:task.task_id,revision:originalHead,source_sha256:digest(actual),
     source_bytes:Buffer.byteLength(actual),excerpt:actual,evidence_sha256:evidenceDigest};
    readRecords.push({task_id:task.task_id,agent_id:"backend",epoch,
     revision:originalHead,resource,
     signed_permissions:task.permissions.map(p=>({...p})),
     gateway_task_completed:true,
     evidence_sha256:evidenceDigest,
     gateway_evidence_sha256:forgery==="bad-gateway-mac"?"d".repeat(64):evidenceDigest});
   }else if(operation==="update_file"){
    if(!evidence)mutationsBeforeRead++;
    const instruction=JSON.parse(task.instruction);
    assert.equal(instruction.edit,"replace-exact-status-expression");
    assert.equal(instruction.to,target);
    const latest=await readFile(sourceFile,"utf8");
    assert.equal(head(latest),originalHead,"one-shot head CAS required");
    const old="status:"+instruction.from;
    assert.equal(latest.split(old).length,2,"worker must not replace an ambiguous expression");
    await writeFile(sourceFile,latest.replace(old,"status:"+instruction.to));
    originalHead=head(await readFile(sourceFile,"utf8"));updates++;
   }else throw Error("unexpected operation");
   completed.push({task_id:task.task_id,agent_id:task.agent_id,
    operation,instruction:task.instruction});
  },
  async observeVerifiedTestFailure({task,context}){
   assert.equal(task.task_id,"original-test");
   assert.equal(context.executionProgress.current_head_sha,failed?.tested_commit_sha);
   events.push("owner_authenticated_failure");
   return failed;
  },
  async verifyRepairDiagnostic({task,context}){
   verifierCalls++;
   assert.equal(failed?.epoch,1);
   events.push("original_gateway_read_provenance");
   return verifyRead({repairTask:task,failedEpoch:failed.epoch,
    currentHead:context.executionProgress.current_head_sha,
    readRecords});
  },
  async confirmReady(){
   assert.deepEqual(actualRunnerResults,["fail","pass"]);
   assert.ok(completed.some(p=>p.task_id==="retest"));
   return {status:"owner_verified_tested_head_not_pr_authorized",
    tested_commit_sha:originalHead,task_id:"retest",
    runtime_task_id:"dispatch_"+"T".repeat(22)};
  },
  async retire(){retired=true;events.push("original_root_retired");}
 };
 return {hooks,model,sourceFile,run:()=>run({model,hooks,
  maxSteps:5,requireVerifiedRepairDiagnostic:true}),
  state:()=>({retired,originalHead,completed,actualRunnerResults,updates,
   verifierCalls,mutationsBeforeRead,events,readRecords})};
}

for(const [index,source] of originals.entries()){
 test("R385.7 actual Node FAIL -> signed read -> source-derived ADK choice -> local CAS -> Node PASS, variant "+index,async t=>{
  const f=await fixture(t,source);
  let outcome;
  try{outcome=await f.run();}
  catch(error){
   throw Error("R385.7 offline fixture diagnostics "+JSON.stringify({
    modelCalls:f.model.calls,prompts:f.model.requestTexts.length,
    events:f.state().events,runnerOutcomes:f.state().actualRunnerResults,
    reason:String(error)
   }),{cause:error});
  }
  assert.equal(outcome.status,"owner_adaptive_work_ready_for_pr");
  assert.equal(outcome.executed_tasks,3,"failed Test is never Gateway-completed");
  assert.equal(outcome.pr_created,false,"readiness cannot post a PR");
  const state=f.state();
  assert.deepEqual(state.actualRunnerResults,["fail","pass"]);
  assert.deepEqual(state.completed.map(x=>x.task_id),["diagnose-backend","repair-backend","retest"]);
  assert.equal(state.verifierCalls,1);
  assert.equal(state.updates,1);
  assert.equal(state.mutationsBeforeRead,0);
  assert.equal(state.retired,false);
  assert.equal(f.model.sawFailure,true);
  assert.equal(f.model.sawSource,true);
  assert.equal(f.model.selectedFrom,index===0?"user.status":'"ACTIVE"');
  const final=await readFile(f.sourceFile,"utf8");
  assert.match(final,/status:"SUSPENDED"/u);
  assert.ok(final.includes("independent metadata "+(index?"B":"A")),
   "source-grounded edit must preserve unrelated repository text");
  assert.ok(state.events.indexOf("owner_gateway")===-1);
  assert.ok(state.events.indexOf("original_gateway_read_provenance")>
   state.events.indexOf("provider:read_file:diagnose-backend"));
  assert.ok(state.events.indexOf("provider:update_file:repair-backend")>
   state.events.indexOf("original_gateway_read_provenance"));
 });
}
test("R385.7 forged Gateway read receipt blocks model-derived UPDATE before local CAS and retires Root",async t=>{
 const f=await fixture(t,originals[0],{forgery:"bad-gateway-mac"});
 await assert.rejects(f.run(),/R385\.6 signed diagnostic repair NO-GO/u);
 const state=f.state();
 assert.deepEqual(state.actualRunnerResults,["fail"]);
 assert.equal(state.updates,0);
 assert.equal(state.retired,true);
 assert.equal(await readFile(f.sourceFile,"utf8"),originals[0]);
 assert.ok(!state.completed.some(x=>x.task_id==="repair-backend"));
});
