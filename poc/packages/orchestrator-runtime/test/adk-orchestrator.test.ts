import assert from "node:assert/strict";
import test from "node:test";
import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from "@google/adk";
import {
  AdkAccountSuspensionOrchestrator,
  type AccountSuspensionSequentialRunResult
} from "../src/index.ts";

const SHA = "a".repeat(40);
const HIDDEN = "ROOT_DELEGATION_SECRET_DO_NOT_SEND_TO_MODEL";
const completed = {
  workflow: {
    state:"pr_created",
    completed_roles:["backend","frontend","test"],
    pull_request:{number:7,head_revision:SHA}
  },
  pull_request:{pull_request_number:7,revision:SHA}
} as AccountSuspensionSequentialRunResult;

type Step = "invoke" | "invent_success" | "invalid_workflow";
class Scripted extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  readonly steps: Step[];
  constructor(steps:Step[]) {
    super({model:"phase6-orchestrator-stub"});
    this.steps=steps;
  }
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void> {
    this.requests.push(request);
    const step=this.steps[this.requests.length-1]??"invent_success";
    if(step==="invent_success"){
      yield {content:{role:"model",parts:[{text:"All actions succeeded."}]}};
      return;
    }
    yield {content:{role:"model",parts:[{
      functionCall:{id:"orchestrator-"+this.requests.length,
        name:"run_account_suspension_workflow",
        args:{workflow:step==="invoke"?"account_suspension":"other_workflow"}}
    }]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection> {
    return Promise.reject(new Error("Live ADK connection disabled"));
  }
}

test("Phase 6 ADK Orchestrator delegates exactly once and returns coordinator evidence", async()=>{
  const model=new Scripted(["invoke","invent_success"]);
  let calls=0;
  const coordinator={secret:HIDDEN,run:async()=>{calls++;return completed;}};
  const actual=await new AdkAccountSuspensionOrchestrator({
    model,workflow:coordinator,maxModelTurns:4
  }).run();
  assert.equal(actual,completed);
  assert.equal(calls,1);
  assert.equal(model.requests.length,2);
  const observed=JSON.stringify(model.requests.map(r=>({
    contents:r.contents,config:r.config
  })));
  assert.equal(observed.includes(HIDDEN),false);
  assert.equal(observed.includes("delegation_evidence"),false);
  assert.equal(observed.includes("private_key"),false);
  assert.match(observed,/run_account_suspension_workflow/u);
});

test("Phase 6 rejects LLM prose claiming success without a real workflow call",async()=>{
  let called=false;
  const model=new Scripted(["invent_success"]);
  await assert.rejects(()=>new AdkAccountSuspensionOrchestrator({
    model,workflow:{run:async()=>{called=true;return completed;}}
  }).run(),/did not finish/u);
  assert.equal(called,false);
});

test("Phase 6 blocks repeated invocations and allows no second feature branch or PR",async()=>{
  let calls=0;
  const model=new Scripted(["invoke","invoke","invent_success"]);
  await assert.rejects(()=>new AdkAccountSuspensionOrchestrator({
    model,workflow:{run:async()=>{calls++;return completed;}}
  }).run(),/did not finish/u);
  assert.equal(calls,1);
});

test("Phase 6 fails closed when the protected sequential workflow fails",async()=>{
  const model=new Scripted(["invoke","invent_success"]);
  await assert.rejects(()=>new AdkAccountSuspensionOrchestrator({
    model,workflow:{run:async()=>{throw new Error(HIDDEN);}}
  }).run(),/did not finish/u);
  const visible=JSON.stringify(model.requests.map(r=>({
    contents:r.contents,config:r.config
  })));
  assert.equal(visible.includes(HIDDEN),false);
  assert.match(visible,/protected_workflow_failed/u);
});

test("Phase 6 never executes workflow for a model-supplied wrong workflow id",async()=>{
  let called=false;
  const model=new Scripted(["invalid_workflow","invent_success"]);
  await assert.rejects(()=>new AdkAccountSuspensionOrchestrator({
    model,workflow:{run:async()=>{called=true;return completed;}}
  }).run(),/did not finish/u);
  assert.equal(called,false);
});
