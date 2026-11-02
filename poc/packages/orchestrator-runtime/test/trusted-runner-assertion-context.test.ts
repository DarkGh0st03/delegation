import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection} from "@google/adk";
import {loadTrustedRunnerAssertionContext as load,verifyTrustedRunnerAssertionContext as verify} from "../src/trusted-runner-assertion-context.ts";
import {retainFailureEvidence} from "../../../apps/test-runner-controller/src/failure-evidence.ts";
import {TrustedAdkOperationalRepairProposer} from "../src/trusted-adk-operational-repair-proposer.ts";
const repo={authority:"gitea.local",owner:"demo",repository:"app"},branch="feature/fix",sha="a".repeat(40);
const repository="gitea://gitea.local/demo/app",runner=repository+"/branches/feature%2Ffix";
const path="tests/backend/generated.test.ts",resource=runner+"/files/"+path;
const logReference="runner-log://11111111-1111-4111-8111-111111111111";
async function fixture(t:import("node:test").TestContext){
 const root=await mkdtemp(join(tmpdir(),"assertion-context-"));t.after(()=>rm(root,{recursive:true,force:true}));
 const archivePath=join(root,"source.tar.gz"),directory=join(root,"evidence");await writeFile(archivePath,"archive");
 const phases=[{phase:"backend_tests" as const,status:"fail" as const}];
 await retainFailureEvidence({directory,archivePath,log:"private log",logReference,
  request:{request_id:"r",repository,branch,commit_sha:sha,profile:"poc-default"},phases,
  privateVitestFailure:{status:"captured",failures:[{path,test_id:"duplicate transition",failure_messages:["AssertionError: expected 200 to be 409\nSECRET_STACK /outside/secret.ts"]}]}});
 const approvedRows=[{agent_id:"test",task_id:"original-test",resource,operation:"read_file"}];
 const rootPermissions=[{resource,operation:"read_file"}];
 const effect={provider:"runner",performed:true,tool:"run_tests",branch,revision:sha,tested_commit_sha:sha,status:"fail",phases,log_reference:logReference,failing_test_files:[path]};
 const args={directory,effect,repo,branch,approvedRows,rootPermissions,roles:["test"]};
 return {args,manifest:join(directory,(await readdir(directory))[0],"manifest.json"),directory};
}
test("only the exact failed Runner reference, revision and original role read scope disclose assertion headers",async t=>{
 const f=await fixture(t),context=await load(f.args);
 assert.ok(context);assert.equal(verify(context,sha,branch,["test"]),context);
 assert.deepEqual(context.assertions,[{role:"test",resource,test_id:"duplicate transition",message:"AssertionError: expected 200 to be 409"}]);
 assert.doesNotMatch(JSON.stringify(context),/SECRET_STACK|outside|private log|runner-log/);
 for(const patch of [{roles:["backend"]},{approvedRows:[]},{rootPermissions:[]}])assert.equal(await load({...f.args,...patch}),null);
 assert.equal(await load({...f.args,effect:{...f.args.effect,log_reference:logReference.replace("11111111","22222222")}}),null);
 assert.equal(await load({...f.args,effect:{...f.args.effect,failing_test_files:["tests/backend/other.test.ts"]}}),null);
 await assert.rejects(load({...f.args,effect:{...f.args.effect,revision:"b".repeat(40),tested_commit_sha:"b".repeat(40)}}),/NO-GO/);
 assert.throws(()=>verify(structuredClone(context),sha,branch,["test"]),/NO-GO/);
 assert.throws(()=>verify(context,"b".repeat(40),branch,["test"]),/NO-GO/);
 assert.throws(()=>verify(context,sha,branch,["backend"]),/NO-GO/);
 const log=join(f.directory,(await readdir(f.directory))[0],"runner.log");await writeFile(log,"modified");
 await assert.rejects(load(f.args),/NO-GO/);
});
class Scripted extends BaseLlm{
 requests:LlmRequest[]=[];constructor(){super({model:"offline-assertion-context"});}
 override async *generateContentAsync(r:LlmRequest):AsyncGenerator<LlmResponse,void>{this.requests.push(r);yield {content:{role:"model",parts:[{text:JSON.stringify({tasks:[
  {id:"edit",agent_id:"test",title:"Investigate assertion",description:"Read and correct only if justified",depends_on:[],permissions:[{resource,operation:"read_file",reason:"Inspect"},{resource,operation:"update_file",reason:"Correct if justified"}]},
  {id:"retest",agent_id:"test",title:"Rerun",description:"Validate repaired revision",depends_on:["edit"],permissions:[{resource:runner,operation:"run_tests",reason:"Validate"}]}
 ]})}]}};}
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{return Promise.reject(Error("No provider"));}
}
test("trusted private assertion context reaches the actual ADK proposer without adding grants",async t=>{
 const f=await fixture(t),model=new Scripted();
 const input={requirement:"Reject duplicate transitions",agents:["test"] as const,
  feedback:{failed_phase:"backend_tests",typecheck_error_codes:[],tested_commit_sha:sha,work_branch:branch,remaining_repair_epochs:2,project_test_failure:{phase:"backend_tests",failed_test_file_count:1}},
  already_delegated_grants:[{resource,operation:"read_file"},{resource,operation:"update_file"},{resource:runner,operation:"run_tests"}]};
 const target={status:"verified_original_generated_test_edit_scope" as const,tested_commit_sha:sha,project_test_failure:input.feedback.project_test_failure,causal_attribution:"not_established" as const,candidates:[{role:"test" as const,resource}]};
 const make=(callback:any)=>new TrustedAdkOperationalRepairProposer({model,taskShape:"bounded_generated_test_edit",readVerifiedRepairTarget:async()=>target,readVerifiedAssertionContext:callback});
 await make(async roles=>{assert.deepEqual(roles,["test"]);return load({...f.args,roles});}).propose(input);
 const payload=JSON.parse(model.requests[0].contents!.at(-1)!.parts!.find(p=>typeof p.text==="string")!.text!);
 assert.equal(payload.diagnostic_assertions.assertions[0].message,"AssertionError: expected 200 to be 409");
 assert.deepEqual(payload.already_delegated_grants,input.already_delegated_grants);
 assert.doesNotMatch(JSON.stringify(payload),/SECRET_STACK/);
 const count=model.requests.length;
 await assert.rejects(make(async()=>({status:"forged"})).propose(input),/NO-GO/);
 await assert.rejects(make(async()=>null).propose({...input,diagnostic_assertions:{status:"forged"}} as any),/trusted owner port/);
 assert.equal(model.requests.length,count);
});


test("route selection sees only verified bounded assertion headers before deciding",async t=>{
 const f=await fixture(t),context=await load(f.args);
 const {createBoundedD1GeminiInvestigationChoice}=await import("../../../apps/gateway/native-test/trusted-d1-gemini-investigation-choice.mjs");
 const requests:any[]=[];
 const model={model:"offline-no-provider",async *generateContentAsync(request:any){
  requests.push(request);yield {content:{parts:[{text:'{"mode":"insufficient_evidence"}'}]}};
 }};
 const observation={tested_commit_sha:sha,failed_phase:"backend_tests",source_candidate_count:1,test_candidate_count:1,causal_attribution:"not_established"};
 assert.equal(await createBoundedD1GeminiInvestigationChoice({model,requirement:"Reject duplicates",branch,assertionContext:context})(observation),"insufficient_evidence");
 const prompt=requests[0].contents[0].parts[0].text;
 assert.match(prompt,/expected 200 to be 409/);assert.match(prompt,/untrusted DATA/);
 assert.doesNotMatch(prompt,/SECRET_STACK|private log/);
 await assert.rejects(createBoundedD1GeminiInvestigationChoice({model,requirement:"Reject duplicates",branch,assertionContext:structuredClone(context)})(observation),/NO-GO/);
 assert.equal(requests.length,1);
});
