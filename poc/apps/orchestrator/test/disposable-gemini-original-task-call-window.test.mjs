import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {DisposablePrivateBudgetedAdkModel}
 from "../src/disposable-gemini-live-budgeted-model.mjs";
import {DisposableOriginalA2AModelCallWindowStore,
 isIssuedOriginalA2ACallWindow,claimIssuedOriginalA2ACallWindow}
 from "../src/disposable-gemini-original-task-call-window.mjs";
const DENY=/Disposable original A2A model call window NO-GO/u;
class Offline extends BaseLlm{
 constructor(){super({model:"offline-trusted-a2a-window"});}
 async *generateContentAsync(){
  yield {content:{role:"model",parts:[{text:"synthetic"}]},
   usageMetadata:{promptTokenCount:1,candidatesTokenCount:2,totalTokenCount:3}};
 }
}
function create(role="backend"){
 return new DisposablePrivateBudgetedAdkModel({
  delegate:new Offline(),phase:role,maxCalls:5,
  maxReportedTokens:100,maxPerCallTokens:24
 });
}
const TASK={task_id:"signed-backend-task",
 credential_id:"urn:original:child:001",
 runtime_task_id:"dispatch_"+"A".repeat(22)};
async function oneCall(model){
 for await(const _ of model.generateContentAsync({})){}
}
test("owner-only callback records matching signed Task window after successful model turn",async()=>{
 const model=create();
 const store=new DisposableOriginalA2AModelCallWindowStore({role:"backend",model});
 const observer=store.callbackForOriginalA2A();
 assert.throws(()=>store.callbackForOriginalA2A(),DENY);
 await oneCall(model);
 observer({...TASK,role:"backend",call_index_before:0,call_index_after:1});
 const claimed=store.takeOriginalWindow(TASK);
 assert.deepEqual(claimed,{...TASK,role:"backend",
  call_index_before:0,call_index_after:1});
 assert.equal(Object.isFrozen(claimed),true);
 assert.equal(isIssuedOriginalA2ACallWindow(model,claimed),true);
 assert.equal(claimIssuedOriginalA2ACallWindow(model,claimed),claimed);
 assert.equal(isIssuedOriginalA2ACallWindow(model,claimed),false);
 assert.throws(()=>claimIssuedOriginalA2ACallWindow(model,claimed),DENY);
 assert.throws(()=>store.takeOriginalWindow(TASK),DENY);
 assert.equal(JSON.stringify(claimed).includes("synthetic"),false);
});

test("cannot forge a source window by copying its fields or stealing another model's claim",async()=>{
 const model=create(),other=create();
 const store=new DisposableOriginalA2AModelCallWindowStore({role:"backend",model});
 const observer=store.callbackForOriginalA2A();
 await oneCall(model);
 observer({...TASK,role:"backend",call_index_before:0,call_index_after:1});
 const original=store.takeOriginalWindow(TASK);
 assert.equal(isIssuedOriginalA2ACallWindow(model,{...original}),false);
 assert.equal(isIssuedOriginalA2ACallWindow(other,original),false);
 assert.throws(()=>claimIssuedOriginalA2ACallWindow(other,original),DENY);
 assert.equal(isIssuedOriginalA2ACallWindow(model,original),true);
});

test("unsigned, duplicate, out-of-order, foreign-role or over-limit windows fail closed",async()=>{
 const model=create();
 const store=new DisposableOriginalA2AModelCallWindowStore({role:"backend",model});
 const observer=store.callbackForOriginalA2A();
 assert.throws(()=>observer({...TASK,role:"backend",
  call_index_before:0,call_index_after:1}),DENY);
 await oneCall(model);
 for(const bad of [
  {...TASK,role:"frontend",call_index_before:0,call_index_after:1},
  {...TASK,role:"backend",call_index_before:0,call_index_after:2},
  {...TASK,role:"backend",call_index_before:1,call_index_after:2},
  {...TASK,role:"backend",call_index_before:0,call_index_after:21},
  {...TASK,role:"backend",call_index_before:0,call_index_after:1,
   untrusted:"model supplied"},
  {...TASK,task_id:"../untrusted",role:"backend",
   call_index_before:0,call_index_after:1}
 ])assert.throws(()=>observer(bad),DENY);
 observer({...TASK,role:"backend",call_index_before:0,call_index_after:1});
 assert.throws(()=>observer({...TASK,role:"backend",
  call_index_before:0,call_index_after:1}),DENY);
 await oneCall(model);
 assert.throws(()=>observer({...TASK,task_id:"another",role:"backend",
  call_index_before:0,call_index_after:2}),DENY);
 observer({...TASK,task_id:"another",credential_id:"urn:child:2",
  runtime_task_id:"dispatch_"+"B".repeat(22),
  role:"backend",call_index_before:1,call_index_after:2});
 const next=store.takeOriginalWindow({
  task_id:"another",credential_id:"urn:child:2",
  runtime_task_id:"dispatch_"+"B".repeat(22)
 });
 assert.equal(next.call_index_after,2);
});
