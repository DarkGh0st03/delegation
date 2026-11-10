import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {TrustedAuthorityOnlyAdkDecisionProposer,
 originalAuthorityOnlyDecisionTimeouts}
 from "../src/trusted-authority-only-adk-decision-proposer.mjs";

const BRANCH="feature/account-suspension";
const P={resource:"gitea://gitea.local/thesis/iam-console-poc",
 operation:"create_branch"};
const select=()=>{
 return {
  task_id:"original-task-branch-1",
  agent_id:"orchestrator",
  depends_on:[],
  permissions:[P],
  instruction:"Create the original authorized feature branch"
 };
};
class OfflineGeminiRequestObserver extends BaseLlm{
 calls=0;observed;
 constructor(modelName){
  super({model:modelName});
 }
 async *generateContentAsync(request){
  this.calls++;
  // Only the request generation settings are inspected. Do not log
  // prompts, tool arguments, private keys or session content.
  this.observed=request.config;
  yield {content:{
   role:"model",parts:[{text:JSON.stringify(select())}]
  }};
 }
 connect(){throw Error("No provider in low-thinking test");}
}
function proposer(model){
 return new TrustedAuthorityOnlyAdkDecisionProposer({
  model,requirement:"Offline proof of original branch model decision",
  branch:BRANCH,rootPermissions:[P],
  agents:{orchestrator:{capabilities:["create_branch"]}},
  previousTasks:[],decisionKind:"branch",nextEpoch:1
 });
}

test("original Gemini 3.8 Orchestrator Task proposer pins LOW thinking and output cap",async()=>{
 const model=new OfflineGeminiRequestObserver("gemini-3.8-flash");
 const output=await proposer(model).propose();
 assert.deepEqual(output,select());
 assert.equal(model.calls,1);
 assert.equal(model.observed?.thinkingConfig?.thinkingLevel,"LOW");
 assert.equal(model.observed?.maxOutputTokens,12000);
});

test("offline legacy model keeps previous generation contract; no paid calls",async()=>{
 const model=new OfflineGeminiRequestObserver("scripted-offline-no-provider");
 const output=await proposer(model).propose();
 assert.deepEqual(output,select());
 assert.equal(model.calls,1);
 assert.notEqual(model.observed?.thinkingConfig?.thinkingLevel,"LOW");
});

test("original owner decision timeout permits full paid provider window without weakening scripted baseline",()=>{
 const live=originalAuthorityOnlyDecisionTimeouts("gemini-3.8-flash");
 const offline=originalAuthorityOnlyDecisionTimeouts("scripted-offline-no-provider");
 assert.deepEqual(live,{modelCallMs:180000,decisionMs:190000});
 assert.deepEqual(offline,{modelCallMs:25000,decisionMs:30000});
 assert.equal(Object.isFrozen(live),true);
 assert.equal(Object.isFrozen(offline),true);
});
