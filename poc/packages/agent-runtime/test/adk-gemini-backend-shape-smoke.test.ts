import assert from "node:assert/strict";
import test from "node:test";
import {BaseLlm} from "@google/adk";
import {runBackendShapeSmoke} from "../scripts/gemini-backend-shape-smoke.mjs";

const BRANCH="feature/account-suspension";
const READ_PATH="apps/backend/src/users/user.service.ts";

class SyntheticModel extends BaseLlm{
  constructor(mode){super({model:"offline-fixture"});this.mode=mode;this.turns=0;this.requests=[];}
  async *generateContentAsync(request){
    this.turns++;this.requests.push(request);
    if(this.mode==="503"){
      const error=new Error("Provider simulation only; NEVER echo this content");
      error.name="ApiError";error.status=503;
      throw error;
    }
    if(this.mode==="read"){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"synthetic-read",name:"read_file",args:{branch:BRANCH,path:READ_PATH}
      }}]}};
      return;
    }
    if(this.mode==="write"){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"synthetic-write",name:"update_file",
        args:{branch:BRANCH,path:READ_PATH,content:"synthetic untrusted edit"}
      }}]}};
      return;
    }
    yield {content:{role:"model",parts:[{text:"Done without invoking a tool"}]}};
  }
  async connect(){throw new Error("No streaming");}
}

test("Backend shape probe uses one provider turn and a purely synthetic read",async()=>{
  const model=new SyntheticModel("read");
  const shapes=[];
  const result=await runBackendShapeSmoke({model,onRequestShape:s=>shapes.push(s)});
  assert.equal(result.result,"gemini-backend-shape-pass");
  assert.equal(result.provider_turns,1);
  assert.equal(result.model_turns,2);
  assert.equal(result.synthetic_reads,1);
  assert.equal(result.rejected_writes,0);
  assert.equal(result.actual_repository_access,false);
  assert.equal(model.turns,1);
  assert.equal(shapes.length,1);
  assert.equal(shapes[0].function_declarations,2);
  assert.equal(shapes[0].max_output_tokens,1024);
  assert.equal(shapes[0].temperature,0);
  assert.equal(JSON.stringify(shapes).includes("synthetic untrusted edit"),false);
});

test("Backend shape probe forbids model-initiated update_file without reaching a repository",async()=>{
  const result=await runBackendShapeSmoke({model:new SyntheticModel("write")});
  assert.equal(result.result,"gemini-backend-shape-incomplete");
  assert.equal(result.reason,"first_response_tool_contract_not_met");
  assert.equal(result.provider_turns,1);
  assert.equal(result.synthetic_reads,0);
  assert.equal(result.rejected_writes,1);
  assert.equal(result.actual_repository_access,false);
});

test("Backend shape probe classifies an upstream numeric 503 without provider details",async()=>{
  const result=await runBackendShapeSmoke({model:new SyntheticModel("503")});
  assert.equal(result.result,"gemini-backend-shape-failed");
  assert.deepEqual(result.diagnostic,{
    category:"api_service_unavailable",
    http_status:503,
    classification_source:"http_status",
    error_type:"api_error"
  });
  assert.equal(result.provider_turns,1);
  assert.equal(result.synthetic_reads,0);
  assert.equal(result.actual_repository_access,false);
  assert.equal(JSON.stringify(result).includes("NEVER echo"),false);
});

test("Backend shape probe refuses no-tool prose as an incomplete functional test",async()=>{
  const model=new SyntheticModel("prose");
  const result=await runBackendShapeSmoke({model});
  assert.equal(result.result,"gemini-backend-shape-incomplete");
  assert.equal(result.provider_turns,1);
  assert.equal(result.synthetic_reads,0);
  assert.equal(model.turns,1);
});
