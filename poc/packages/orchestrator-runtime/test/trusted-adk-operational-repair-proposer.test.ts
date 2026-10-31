import test from "node:test";
import assert from "node:assert/strict";
import {
 BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection
} from "@google/adk";
import {TrustedAdkOperationalRepairProposer} from
 "../src/trusted-adk-operational-repair-proposer.ts";

const file="gitea://gitea.local/tenants/invoices/branches/feature%2Fmaintenance/files/src/payments.ts";
const runner="gitea://gitea.local/tenants/invoices/branches/feature%2Fmaintenance";
const input={
 requirement:"Correct payment invoice processing",
 feedback:{
  failed_phase:"typecheck",
  typecheck_error_codes:["TS2339"],
  tested_commit_sha:"a".repeat(40),
  work_branch:"feature/maintenance",
  remaining_repair_epochs:2
 },
 already_delegated_grants:[
  {resource:file,operation:"update_file"},
  {resource:runner,operation:"run_tests"}
 ],
 agents:["backend","frontend","test","orchestrator"] as const
};
function draft(){return {tasks:[
 {id:"repair-backend",agent_id:"backend",title:"Fix payment handler",
  description:"Correct the broken invoicing method",depends_on:[],
  permissions:[{resource:file,operation:"update_file",reason:"Fix typecheck"}]},
 {id:"retest-invoices",agent_id:"test",title:"Run acceptance",
  description:"Verify the resulting revision",depends_on:["repair-backend"],
  permissions:[{resource:runner,operation:"run_tests",reason:"Verify change"}]}
]};}
class ScriptedModel extends BaseLlm {
 readonly #payload:unknown;
 requests:LlmRequest[]=[];
 constructor(payload:unknown){super({model:"no-billing-scripted-repair"});this.#payload=payload;}
 override async *generateContentAsync(r:LlmRequest):
  AsyncGenerator<LlmResponse,void>{
  this.requests.push(r);
  yield {content:{role:"model",parts:[{
   text:typeof this.#payload==="string"?this.#payload:JSON.stringify(this.#payload)
  }]}};
 }
 override connect(_r:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("No network, no model billing"));
 }
}
test("R107 ADK proposes a one-turn non-authorizing repair DAG without tools",async()=>{
 const model=new ScriptedModel(draft()),events:string[]=[];
 const planner=new TrustedAdkOperationalRepairProposer({
  model,maxOutputTokens:4096,
  onObservation:event=>events.push(event.kind)
 });
 const result=await planner.propose(input);
 assert.deepEqual(result,draft());
 assert.equal(model.requests.length,1);
 assert.deepEqual(events,[
  "model_attempt","model_complete","proposal_parsed"
 ]);
 const request=JSON.stringify(model.requests[0]);
 assert.match(request,/TS2339/);
 assert.match(request,/feature\/maintenance/);
 assert.ok(!request.includes("signed_vp"));
 assert.ok(!request.includes("private_key"));
 assert.ok(!request.includes("issue_child"));
 assert.ok(!request.includes("create_branch"));
 const instruction=JSON.stringify(model.requests[0]?.config?.systemInstruction??{});
 assert.match(instruction,/NO tools to inspect the source/);
 assert.match(instruction,/ONLY exact existing ResourceURI\/Operation/);
 await assert.rejects(planner.propose(input),/single repair proposal already attempted/);
 assert.equal(model.requests.length,1);
});
test("R107 malformed or malicious model response never becomes a valid proposal",async()=>{
 for(const payload of [
  "not-json",{"tasks":[],engineer_approval:"yes"},
  {"secret":"token"},["tasks"]
 ]){
  const model=new ScriptedModel(payload);
  const planner=new TrustedAdkOperationalRepairProposer({model});
  await assert.rejects(planner.propose(input),
   /model did not return valid JSON|outside permitted draft/);
  assert.equal(model.requests.length,1);
 }
});
test("R107 source-free input must be a bounded trusted Runner failure",async()=>{
 const model=new ScriptedModel(draft());
 const invalid={
  ...input,feedback:{...input.feedback,tested_commit_sha:"baddata"}
 };
 await assert.rejects(new TrustedAdkOperationalRepairProposer({model})
  .propose(invalid),/invalid trusted source-free repair input/);
 assert.equal(model.requests.length,0);
});
test("R107 model is constrained by provider-level output-token setting",async()=>{
 const model=new ScriptedModel(draft());
 await new TrustedAdkOperationalRepairProposer({
  model,maxOutputTokens:1024,thinkingLevel:"LOW"
 }).propose(input);
 const config=model.requests[0]?.config;
 assert.equal(config?.maxOutputTokens,1024);
 assert.equal(config?.thinkingConfig?.thinkingLevel,"LOW");
});


const boundedInput={
 ...input,already_delegated_grants:[
  {resource:file,operation:"read_file"},...input.already_delegated_grants
 ]
};
function boundedDraft(){
 const result=draft();
 result.tasks[0].permissions.unshift({
  resource:file,operation:"read_file",reason:"Inspect approved source"
 });
 return result;
}
test("R151.13 bounded signed D1 proposes only Backend -> Test with exact existing grants",async()=>{
 const model=new ScriptedModel(boundedDraft());
 const proposer=new TrustedAdkOperationalRepairProposer({
  model,taskShape:"backend_test",maxOutputTokens:2048
 });
 assert.deepEqual(await proposer.propose(boundedInput),boundedDraft());
 assert.equal(model.requests.length,1);
 const instructions=JSON.stringify(model.requests[0]?.config?.systemInstruction??{});
 assert.match(instructions,/EXACTLY two Tasks/);
 assert.match(instructions,/Do NOT propose Frontend/);
 assert.match(instructions,/no extra read grants/);
});
test("R151.20 bounded model sees only feasible Backend/Test root grants",async()=>{
 const unusedFile=runner+"/files/src/secondary.ts";
 const unrelated={...boundedInput,already_delegated_grants:[
  ...boundedInput.already_delegated_grants,
  {resource:unusedFile,operation:"read_file"},
  {resource:runner,operation:"create_pull_request"},
  {resource:runner,operation:"delete_file"}
 ]};
 const model=new ScriptedModel(boundedDraft());
 const proposer=new TrustedAdkOperationalRepairProposer({
  model,taskShape:"backend_test"
 });
 assert.deepEqual(await proposer.propose(unrelated),boundedDraft());
 assert.equal(model.requests.length,1);
 const message=model.requests[0]?.contents?.at(-1)?.parts?.find(
  p=>typeof p.text==="string")?.text;
 assert.equal(typeof message,"string");
 const exposed=JSON.parse(message!);
 assert.deepEqual(exposed.agents,["backend","test"]);
 assert.deepEqual(exposed.feedback,unrelated.feedback);
 assert.equal(exposed.requirement,unrelated.requirement);
 assert.deepEqual(exposed.already_delegated_grants,[
  {resource:file,operation:"read_file"},
  {resource:file,operation:"update_file"},
  {resource:runner,operation:"run_tests"}
 ]);
 const instructions=JSON.stringify(model.requests[0]?.config?.systemInstruction??{});
 assert.match(instructions,/Test may only run_tests/);
 assert.ok(!instructions.includes("Backend\/Frontend:"));
 assert.ok(!message!.includes("secondary.ts"));
 assert.ok(!message!.includes("create_pull_request"));
});

test("R151.13 no inference if original root cannot express a bounded Backend/Test D1",async()=>{
 const cases=[
  input,
  {...boundedInput,agents:["frontend","test"] as const},
  {...boundedInput,already_delegated_grants:
    boundedInput.already_delegated_grants.filter(g=>g.operation!=="run_tests")},
  {...boundedInput,already_delegated_grants:
    boundedInput.already_delegated_grants.map(g=>g.operation==="run_tests"
      ?{...g,resource:g.resource+"/other"}:g)}
 ];
 for(const bad of cases){
  const model=new ScriptedModel(boundedDraft());
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model,taskShape:"backend_test"
  }).propose(bad),/bounded Backend\/Test repair missing existing root scope/);
  assert.equal(model.requests.length,0);
 }
});
test("R151.21 malformed or non-TypeScript FAIL never triggers a bounded paid repair inference",async()=>{
 const failures=[
  {failed_phase:"backend_tests"},
  {failed_phase:"build"},
  {failed_phase:"typecheck",typecheck_error_codes:[]},
  {failed_phase:"typecheck",typecheck_error_codes:["not-a-typescript-diagnostic"]},
  {failed_phase:"typecheck",typecheck_error_codes:["TS2339","TS99999"]},
  {failed_phase:"typecheck",typecheck_error_codes:Array(17).fill("TS2339")}
 ];
 for(const overrides of failures){
  const model=new ScriptedModel(boundedDraft());
  const feedback={...boundedInput.feedback,...overrides};
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model,taskShape:"backend_test"
  }).propose({...boundedInput,feedback}),
  /bounded Backend\/Test repair requires verified TypeScript diagnostics/);
  assert.equal(model.requests.length,0);
 }
});

test("R151.19 rejects extra Backend reads even if original Rust root allows them",async()=>{
 const extraFile=runner+"/files/src/ledger.ts";
 const rooted={...boundedInput,already_delegated_grants:[
  ...boundedInput.already_delegated_grants,
  {resource:extraFile,operation:"read_file"}
 ]};
 for(const resource of [extraFile,file]){
  const baseline=boundedDraft();
  const proposed={tasks:[
   {...baseline.tasks[0],permissions:[...baseline.tasks[0].permissions,{
    resource,operation:"read_file",reason:"Unnecessary extra read"
   }]},baseline.tasks[1]
  ]};
  const model=new ScriptedModel(proposed);
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model,taskShape:"backend_test"
  }).propose(rooted),/bounded repair Task grants/);
  assert.equal(model.requests.length,1);
 }
});

test("R151.13 malformed bounded model DAG cannot reach owner admission",async()=>{
 const good=boundedDraft();
 const bad=[
  {...good,tasks:[...good.tasks,good.tasks[0]]},
  {...good,tasks:[{...good.tasks[0],agent_id:"frontend"},good.tasks[1]]},
  {...good,tasks:[good.tasks[0],{...good.tasks[1],depends_on:[]}]},
  {...good,tasks:[{...good.tasks[0],permissions:
    good.tasks[0].permissions.filter(p=>p.operation!=="read_file")},good.tasks[1]]},
  {...good,tasks:[{...good.tasks[0],permissions:
    good.tasks[0].permissions.map(p=>p.operation==="update_file"
      ?{...p,resource:file+"/out-of-scope"}:p)},good.tasks[1]]},
  {...good,tasks:[good.tasks[0],{...good.tasks[1],permissions:[
    ...good.tasks[1].permissions,{resource:file,operation:"update_file",reason:"No"}
  ]}]},
  {...good,tasks:[{...good.tasks[0],permissions:[
    ...good.tasks[0].permissions,
    {resource:file+"/unapproved",operation:"read_file",reason:"No"}
  ]},good.tasks[1]]}
 ];
 for(const payload of bad){
  const model=new ScriptedModel(payload);
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model,taskShape:"backend_test"
  }).propose(boundedInput),/bounded repair/);
  assert.equal(model.requests.length,1);
 }
});
