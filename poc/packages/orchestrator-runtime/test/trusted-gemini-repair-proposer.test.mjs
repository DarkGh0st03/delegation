import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedGeminiRepairProposer} from
 "../src/trusted-gemini-repair-proposer.mjs";

const file="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Ffix/files/apps/backend/src/example.ts";
const branch="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Ffix";
const source={
 requirement:"Repair a failing TypeScript backend",
 feedback:{failed_phase:"typecheck",typecheck_error_codes:["TS2820"],
  tested_commit_sha:"a".repeat(40),work_branch:"feature/fix",
  remaining_repair_epochs:2},
 already_delegated_grants:[
  {resource:file,operation:"read_file"},
  {resource:file,operation:"update_file"},
  {resource:branch,operation:"run_tests"}
 ],
 agents:["backend","test","orchestrator"]
};
const draft={tasks:[
 {id:"repair-source",agent_id:"backend",title:"Fix type error",
  description:"Inspect type mismatch",depends_on:[],permissions:[
   {resource:file,operation:"read_file",reason:"Read failing source"},
   {resource:file,operation:"update_file",reason:"Correct type mismatch"}
  ]},
 {id:"verify-repair",agent_id:"test",title:"Re-run Docker",
  description:"Test corrected SHA",depends_on:["repair-source"],permissions:[
   {resource:branch,operation:"run_tests",reason:"Validate repair"}
  ]}
]};
function fakeModel(output=JSON.stringify(draft)){
 let requests=0;
 return {model:"gemini-fixture-no-network",
  get requests(){return requests;},
  async *generateContentAsync(req){
   requests++;
   assert.equal(req.config.temperature,0);
   assert.equal(req.contents.length,1);
   assert.equal(req.contents[0].role,"user");
   assert.equal(req.contents[0].parts[0].text.includes("TS2820"),true);
   assert.equal(req.contents[0].parts[0].text.includes("already_delegated_grants"),true);
   yield {content:{role:"model",parts:[{text:output}]}};
  }
 };
}

test("R151 model proposes a one-use repair DAG, but cannot grant or execute",async()=>{
 const model=fakeModel();
 const propose=createTrustedGeminiRepairProposer({model});
 const result=await propose(source);
 assert.deepEqual(result,draft);
 assert.equal(model.requests,1);
 await assert.rejects(propose(source),/R151 model repair proposal unavailable/);
 assert.equal(model.requests,1);
});

test("R151 rejects markdown, malformed shape and oversized model result",async()=>{
 const tick=String.fromCharCode(96).repeat(3);
 for(const output of [
  "Here is your plan: "+JSON.stringify(draft),
  tick+"json\n"+JSON.stringify(draft)+"\n"+tick,
  JSON.stringify({tasks:draft.tasks,permission_granted:true}),
  JSON.stringify({tasks:[]}),
  "x".repeat(48100)
 ]){
  const propose=createTrustedGeminiRepairProposer({model:fakeModel(output)});
  await assert.rejects(propose(source),/R151 model repair proposal unavailable/);
 }
});
test("R151 rejects untrusted feedback before invoking model",async()=>{
 const model=fakeModel();
 const propose=createTrustedGeminiRepairProposer({model});
 await assert.rejects(propose({...source,feedback:{...source.feedback,
   tested_commit_sha:"not-a-real-sha"}}),/R151 model repair proposal unavailable/);
 assert.equal(model.requests,0);
 await assert.rejects(propose(source),/R151 model repair proposal unavailable/);
});
test("R151 provider exceptions never leak raw model output or credentials",async()=>{
 const model={model:"gemini-fixture-no-network",
  async *generateContentAsync(){throw Error("SECRET_API_KEY_NEVER_LOG");}
 };
 const p=createTrustedGeminiRepairProposer({model});
 await assert.rejects(p(source),e=>{
  assert.equal(String(e).includes("SECRET_API_KEY_NEVER_LOG"),false);
  return /R151 model repair proposal unavailable/.test(String(e));
 });
});
