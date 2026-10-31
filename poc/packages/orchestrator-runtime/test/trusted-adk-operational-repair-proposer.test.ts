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

test("R151.47.2 bounded ADK includes verified source as inert data without granting tools",async()=>{
 const code="export const payment=42;\n";
 const read={
  status:"gateway_discovery_read_confirmed_no_authority" as const,
  resource:file,branch:"feature/maintenance",
  tested_commit_sha:"a".repeat(40),operation:"read_file" as const
 };
 const source={
  status:"gateway_sha256_verified_source_data_no_authority" as const,
  resource:file,branch:"feature/maintenance",
  tested_commit_sha:"a".repeat(40),
  bytes:Buffer.byteLength(code,"utf8"),content:code
 };
 const model=new ScriptedModel(boundedDraft());
 const proposal=new TrustedAdkOperationalRepairProposer({
  model,taskShape:"backend_test"
 });
 assert.deepEqual(await proposal.propose({
  ...boundedInput,diagnostic_read:read,diagnostic_source:source
 }),boundedDraft());
 assert.equal(model.requests.length,1);
 const content=JSON.stringify(model.requests[0]);
 assert.ok(content.includes("export const payment=42;"));
 assert.ok(content.includes("untrusted DATA"));
 assert.ok(!content.includes("signed_vp"));
 assert.ok(!content.includes("Bearer "));
 for(const mutation of [
  {resource:file+"-different"},
  {branch:"feature/other"},
  {tested_commit_sha:"b".repeat(40)},
  {bytes:1},{content:"x"},
  {content:"x".repeat(32769),bytes:32769}
 ]){
  const rejected=new ScriptedModel(boundedDraft());
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model:rejected,taskShape:"backend_test"
  }).propose({...boundedInput,diagnostic_read:read,
   diagnostic_source:{...source,...mutation}}),
   /untrusted source outside verified Backend/);
  assert.equal(rejected.requests.length,0);
 }
});

test("R151.72 bounded D1 can nominate one Frontend repair then Test without new authority",async()=>{
 const frontend=runner+"/files/apps/frontend/src/App.tsx";
 const frontInput={...boundedInput,
  already_delegated_grants:[
   ...boundedInput.already_delegated_grants,
   {resource:frontend,operation:"read_file"},
   {resource:frontend,operation:"update_file"}
  ]};
 const proposed={tasks:[
  {id:"fix-frontend",agent_id:"frontend",title:"Fix frontend TypeScript",
   description:"Correct the exact approved component",depends_on:[],
   permissions:[
    {resource:frontend,operation:"read_file",reason:"Inspect"},
    {resource:frontend,operation:"update_file",reason:"Fix typecheck"}
   ]},
  {id:"retest-frontend",agent_id:"test",title:"Run Docker",
   description:"Recheck the new commit",depends_on:["fix-frontend"],
   permissions:[{resource:runner,operation:"run_tests",reason:"Verify"}]}
 ]};
 const model=new ScriptedModel(proposed);
 const p=new TrustedAdkOperationalRepairProposer({
  model,taskShape:"backend_or_frontend_test"
 });
 assert.deepEqual(await p.propose(frontInput),proposed);
 assert.equal(model.requests.length,1);
 const body=JSON.parse(model.requests[0]!.contents!.at(-1)!.parts!.find(
  part=>typeof part.text==="string")!.text!);
 assert.ok(body.agents.includes("frontend"));
 assert.ok(body.already_delegated_grants.some(
  (x:{resource:string})=>x.resource===frontend));
 for(const bad of [
  {...proposed,tasks:[{...proposed.tasks[0],agent_id:"test"},proposed.tasks[1]]},
  {...proposed,tasks:[{...proposed.tasks[0],permissions:[
   ...proposed.tasks[0].permissions,
   {resource:frontend,operation:"create_file",reason:"Unauthorized"}
  ]},proposed.tasks[1]]},
  {...proposed,tasks:[...proposed.tasks,{
   id:"extra",agent_id:"backend",depends_on:[],permissions:[]}]}
 ]){
  const rejected=new ScriptedModel(bad);
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model:rejected,taskShape:"backend_or_frontend_test"
  }).propose(frontInput),/bounded repair/);
 }
});


test("R151.73 paid D1 uses exact trusted Frontend compiler target before inference",async()=>{
 const frontend=runner+"/files/apps/frontend/src/App.tsx";
 const target={status:"verified_runner_single_file_repair_target" as const,
  tested_commit_sha:"a".repeat(40),role:"frontend" as const,resource:frontend};
 const scoped={...boundedInput,agents:["backend","frontend","test"] as const,
  already_delegated_grants:[...boundedInput.already_delegated_grants,
   {resource:frontend,operation:"read_file"},
   {resource:frontend,operation:"update_file"}]};
 const baseline=boundedDraft();
 const draft={tasks:[{
  ...baseline.tasks[0],id:"fix-frontend",agent_id:"frontend",
  permissions:[{resource:frontend,operation:"read_file",reason:"Inspect"},
   {resource:frontend,operation:"update_file",reason:"Fix typecheck"}]
 },{
  ...baseline.tasks[1],depends_on:["fix-frontend"]
 }]};
 const model=new ScriptedModel(draft);
 assert.deepEqual(await new TrustedAdkOperationalRepairProposer({
  model,taskShape:"backend_or_frontend_test",
  readVerifiedRepairTarget:async()=>target
 }).propose(scoped),draft);
 const message=JSON.parse(model.requests[0]!.contents!.at(-1)!.parts!
  .find(p=>typeof p.text==="string")!.text!);
 assert.deepEqual(message.diagnostic_target,target);
 assert.deepEqual(message.already_delegated_grants,[
  {resource:frontend,operation:"read_file"},
  {resource:frontend,operation:"update_file"},
  {resource:runner,operation:"run_tests"}
 ]);
 for(const bad of [
  {...target,tested_commit_sha:"b".repeat(40)},
  {...target,resource:runner+"/files/foreign.ts"},
  undefined
 ]){
  const unbilled=new ScriptedModel(draft);
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model:unbilled,taskShape:"backend_or_frontend_test",
   readVerifiedRepairTarget:async()=>bad as typeof target
  }).propose(scoped),/no authenticated Runner repair target set/);
  assert.equal(unbilled.requests.length,0);
 }
 const wrong=new ScriptedModel(baseline);
 await assert.rejects(new TrustedAdkOperationalRepairProposer({
  model:wrong,taskShape:"backend_or_frontend_test",
  readVerifiedRepairTarget:async()=>target
 }).propose(scoped),/bounded repair Task grants|different writer/);
 assert.equal(wrong.requests.length,1);
});

test("R151.74 multi-file D1 accepts Backend + Frontend + Test, without minting grants",async()=>{
 const ui=runner+"/files/apps/frontend/src/Users.tsx";
 const scope={...boundedInput,agents:["backend","frontend","test"] as const,
  already_delegated_grants:[...boundedInput.already_delegated_grants,
   {resource:ui,operation:"read_file"},{resource:ui,operation:"update_file"}]};
 const old=boundedDraft();
 const proposal={tasks:[
  {...old.tasks[0],id:"backend-fix"},
  {id:"frontend-fix",agent_id:"frontend",title:"Correct UI",description:"Fix TS",
   depends_on:[],permissions:[
    {resource:ui,operation:"read_file",reason:"Inspect"},
    {resource:ui,operation:"update_file",reason:"Fix"}
   ]},
  {...old.tasks[1],id:"new-test",depends_on:["backend-fix","frontend-fix"]}
 ]};
 const model=new ScriptedModel(proposal);
 const draft=await new TrustedAdkOperationalRepairProposer({
  model,taskShape:"bounded_multi_edit_test"
 }).propose(scope);
 assert.deepEqual(draft,proposal);
 assert.equal(model.requests.length,1);
 const instructions=JSON.stringify(model.requests[0]?.config?.systemInstruction);
 assert.match(instructions,/BOTH Backend and Frontend/);
 const body=JSON.parse(model.requests[0]!.contents!.at(-1)!.parts!
  .find(p=>typeof p.text==="string")!.text!);
 assert.deepEqual(body.agents,["backend","frontend","test"]);
});
test("R151.74 multi-file D1 rejects foreign grants, collisions, cycles, missing Test deps",async()=>{
 const ui=runner+"/files/apps/frontend/src/Users.tsx";
 const scope={...boundedInput,agents:["backend","frontend","test"] as const,
  already_delegated_grants:[...boundedInput.already_delegated_grants,
   {resource:ui,operation:"read_file"},{resource:ui,operation:"update_file"}]};
 const old=boundedDraft();
 const valid={tasks:[
  {...old.tasks[0],id:"b-fix"},
  {id:"f-fix",agent_id:"frontend",title:"UI",description:"Repair",
   depends_on:[],permissions:[
    {resource:ui,operation:"read_file",reason:"Inspect"},
    {resource:ui,operation:"update_file",reason:"Fix"}]},
  {...old.tasks[1],id:"t1",depends_on:["b-fix","f-fix"]}
 ]};
 const bad=[
  {...valid,tasks:[valid.tasks[0],{...valid.tasks[1],permissions:[
   ...valid.tasks[1].permissions,
   {resource:ui+"/foreign",operation:"update_file",reason:"No"}]},valid.tasks[2]]},
  {...valid,tasks:[valid.tasks[0],{...valid.tasks[1],
   permissions:valid.tasks[0].permissions},valid.tasks[2]]},
  {...valid,tasks:[valid.tasks[0],valid.tasks[1],
   {...valid.tasks[2],depends_on:["b-fix"]}]},
  {...valid,tasks:[{...valid.tasks[0],depends_on:["f-fix"]},
   {...valid.tasks[1],depends_on:["b-fix"]},valid.tasks[2]]},
  {...valid,tasks:[valid.tasks[0],{...valid.tasks[1],id:"b-fix"},valid.tasks[2]]},
  {...valid,tasks:[valid.tasks[0],{...valid.tasks[1],
   depends_on:["outside-task"]},valid.tasks[2]]}
 ];
 for(const payload of bad){
  const m=new ScriptedModel(payload);
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model:m,taskShape:"bounded_multi_edit_test"
  }).propose(scope),/Trusted ADK repair proposer NO-GO/);
  assert.equal(m.requests.length,1);
 }
 const off=new ScriptedModel(valid);
 await assert.rejects(new TrustedAdkOperationalRepairProposer({
  model:off,taskShape:"bounded_multi_edit_test"
 }).propose({...scope,already_delegated_grants:
  scope.already_delegated_grants.filter(p=>p.resource!==ui)}),
  /multi-edit permission outside original root/);
 assert.equal(off.requests.length,1);
});

test("R151.74.2 paid auto mode sends two independently attributed Runner files to multi-D1 model",async()=>{
 const ui=runner+"/files/apps/frontend/src/Users.tsx";
 const targets={status:"verified_runner_multi_file_repair_targets" as const,
  tested_commit_sha:"a".repeat(40),targets:[
   {role:"backend" as const,resource:file},
   {role:"frontend" as const,resource:ui}
  ]};
 const scoped={...boundedInput,agents:["backend","frontend","test"] as const,
  already_delegated_grants:[...boundedInput.already_delegated_grants,
   {resource:ui,operation:"read_file"},{resource:ui,operation:"update_file"}]};
 const old=boundedDraft();
 const plan={tasks:[
  {...old.tasks[0],id:"b-fix"},
  {id:"f-fix",agent_id:"frontend",title:"UI",description:"Fix UI",
   depends_on:[],permissions:[
    {resource:ui,operation:"read_file",reason:"Inspect"},
    {resource:ui,operation:"update_file",reason:"Fix"}]},
  {...old.tasks[1],id:"test-again",depends_on:["b-fix","f-fix"]}
 ]};
 const m=new ScriptedModel(plan);
 assert.deepEqual(await new TrustedAdkOperationalRepairProposer({
  model:m,taskShape:"bounded_auto_edit_test",
  readVerifiedRepairTarget:async()=>targets
 }).propose(scoped),plan);
 const sent=JSON.parse(m.requests[0]!.contents!.at(-1)!.parts!
  .find(p=>typeof p.text==="string")!.text!);
 assert.deepEqual(sent.diagnostic_targets,targets);
 assert.deepEqual(sent.agents,["backend","frontend","test"]);
 for(const wrong of [
  {...targets,targets:[targets.targets[0]]},
  {...targets,targets:[...targets.targets,targets.targets[0]]},
  {...targets,targets:[targets.targets[0],{
   role:"frontend" as const,resource:ui+"/not-approved"
  }]}
 ]){
  const unused=new ScriptedModel(plan);
  await assert.rejects(new TrustedAdkOperationalRepairProposer({
   model:unused,taskShape:"bounded_auto_edit_test",
   readVerifiedRepairTarget:async()=>wrong
  }).propose(scoped),/no authenticated Runner repair target set/);
  assert.equal(unused.requests.length,0);
 }
});

const acceptanceInput={...boundedInput,feedback:{...boundedInput.feedback,
 failed_phase:"researcher_acceptance",typecheck_error_codes:[],
 acceptance_failure:{failed_checks:["service_persistence"],timed_out:false,
  unclassified_failure:false}}};
const acceptanceTarget={status:"verified_runner_single_file_repair_target" as const,
 tested_commit_sha:input.feedback.tested_commit_sha,role:"backend" as const,resource:file};

test("R151.78 actionable acceptance reaches bounded ADK with a separately verified target",async()=>{
 const model=new ScriptedModel(boundedDraft());
 const result=await new TrustedAdkOperationalRepairProposer({model,
  taskShape:"bounded_auto_edit_test",readVerifiedRepairTarget:async()=>acceptanceTarget
 }).propose(acceptanceInput);
 assert.deepEqual(result,boundedDraft());
 const sent=JSON.parse(model.requests[0]!.contents!.at(-1)!.parts!
  .find(p=>typeof p.text==="string")!.text!);
 assert.deepEqual(sent.feedback.acceptance_failure,acceptanceInput.feedback.acceptance_failure);
 assert.deepEqual(sent.diagnostic_target,acceptanceTarget);
 assert.equal(sent.already_delegated_grants.some(g=>g.operation==="create_pull_request"),false);
});

test("R151.78 timeout, unknown checks and missing/stale/outside-root target make no model call",async()=>{
 const base=acceptanceInput.feedback.acceptance_failure;
 for(const acceptance_failure of [
  {...base,timed_out:true},{...base,unclassified_failure:true},
  {...base,failed_checks:[]},{...base,failed_checks:["PRIVATE_ASSERTION"]}
 ]){
  const model=new ScriptedModel(boundedDraft());
  await assert.rejects(new TrustedAdkOperationalRepairProposer({model,
   taskShape:"bounded_auto_edit_test",readVerifiedRepairTarget:async()=>acceptanceTarget
  }).propose({...acceptanceInput,feedback:{...acceptanceInput.feedback,acceptance_failure}}),
   /requires verified TypeScript diagnostics or actionable acceptance/);
  assert.equal(model.requests.length,0);
 }
 for(const target of [
  {...acceptanceTarget,tested_commit_sha:"b".repeat(40)},
  {...acceptanceTarget,resource:file+"/outside"}
 ]){
  const model=new ScriptedModel(boundedDraft());
  await assert.rejects(new TrustedAdkOperationalRepairProposer({model,
   taskShape:"bounded_auto_edit_test",readVerifiedRepairTarget:async()=>target
  }).propose(acceptanceInput),/no authenticated Runner repair target/);
  assert.equal(model.requests.length,0);
 }
 const model=new ScriptedModel(boundedDraft());
 await assert.rejects(new TrustedAdkOperationalRepairProposer({model,
  taskShape:"backend_test"}).propose(acceptanceInput),/independently verified Runner target/);
 assert.equal(model.requests.length,0);
});

test("R151.79 acceptance candidate stays pinned to the exact observed failed requirement",async()=>{
 const candidate={...acceptanceTarget,status:"verified_acceptance_single_file_repair_candidate" as const,
  failed_checks:["service_persistence"]};
 const model=new ScriptedModel(boundedDraft());
 assert.deepEqual(await new TrustedAdkOperationalRepairProposer({model,
  taskShape:"bounded_auto_edit_test",readVerifiedRepairTarget:async()=>candidate
 }).propose(acceptanceInput),boundedDraft());
 const wrong=new ScriptedModel(boundedDraft());
 await assert.rejects(new TrustedAdkOperationalRepairProposer({model:wrong,
  taskShape:"bounded_auto_edit_test",readVerifiedRepairTarget:async()=>({...candidate,
   failed_checks:["ui_state_actions"]})
 }).propose(acceptanceInput),/candidate differs from verified failed checks/u);
 assert.equal(wrong.requests.length,0);
});
