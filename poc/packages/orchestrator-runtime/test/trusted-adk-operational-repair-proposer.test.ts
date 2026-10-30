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
 assert.ok(!request.includes("create_branch\\""));
 const instruction=JSON.stringify(model.requests[0]?.config?.systemInstruction??{});
 assert.match(instruction,/NO direct tools/);
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
 assert.equal(config?.generateContentConfig?.maxOutputTokens,1024);
 assert.equal(config?.generateContentConfig?.thinkingConfig?.thinkingLevel,"LOW");
});
