import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm, FunctionTool, InMemorySessionService, LlmAgent, Runner,
  type BaseLlmConnection, type LlmRequest, type LlmResponse
} from "@google/adk";
import {z} from "zod";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";
import {safeAdkRequestShape} from "../src/adk-request-shape.ts";

const BRANCH="feature/account-suspension";
const PATH="apps/backend/src/users/user.service.ts";
const OUTPUT={maxOutputTokens:1024,temperature:0};

/**
 * Both agents use the actual ADK Runner + FunctionTool declaration pipeline.
 * The LLM is an inert local capture model: no Gemini API, no network, no
 * repository, no delegation credentials, no Gateway execution.
 */
class FirstTurnCapture extends BaseLlm {
  readonly requests:LlmRequest[]=[];
  constructor(){super({model:"offline-no-provider"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    yield {content:{role:"model",parts:[{text:"Offline request captured; no tool execution."}]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(new Error("Offline test has no live transport"));
  }
}

async function capture(agent:LlmAgent,model:FirstTurnCapture,label:string):Promise<LlmRequest>{
  const appName="offline_schema_parity_"+label;
  const sessionService=new InMemorySessionService();
  const runner=new Runner({appName,agent,sessionService});
  const userId="offline",sessionId="isolated";
  await sessionService.createSession({appName,userId,sessionId});
  for await(const event of runner.runAsync({
    userId,sessionId,
    newMessage:{role:"user",parts:[{
      text:label==="smoke"
        ? "Use the only available controlled read_file tool once to inspect the synthetic fixture."
        : JSON.stringify({task:{
            task_id:"offline-backend-task",
            role:"backend",
            subtask:{
              subtask_id:"account-suspension-backend",
              instruction:"Implement the backend Account Suspension lifecycle and shared status contract.",
              branch:BRANCH,
              relevant_paths:[
                "packages/shared/src/account-status.ts",
                PATH,
                "apps/backend/src/users/user.controller.ts",
                "apps/backend/src/users/user.routes.ts"
              ]
            }
          }})
    }]}
  })){
    assert.equal(event.errorCode,undefined);
    assert.equal(event.errorMessage,undefined);
  }
  assert.equal(model.requests.length,1,"Only one local capture turn is allowed");
  return model.requests[0]!;
}

function declarations(request:LlmRequest){
  return (request.config?.tools??[]).flatMap(group=>group.functionDeclarations??[]);
}
function schemaOf(decl:ReturnType<typeof declarations>[number]):Record<string,unknown>{
  const schema=decl.parametersJsonSchema??decl.parameters;
  assert.ok(schema && typeof schema==="object" && !Array.isArray(schema));
  return schema as Record<string,unknown>;
}
function propsOf(schema:Record<string,unknown>):Record<string,unknown>{
  const props=schema.properties;
  assert.ok(props && typeof props==="object" && !Array.isArray(props));
  return props as Record<string,unknown>;
}
function assertRequiredSchema(schema:Record<string,unknown>,expected:string[]){
  const props=propsOf(schema);
  assert.deepEqual(Object.keys(props).sort(),expected.slice().sort());
  assert.deepEqual((schema.required as string[] | undefined)?.slice().sort(),expected.slice().sort());
  // @google/adk 2.2.1 emits only the declared parameters and required keys;
  // additionalProperties may be omitted even though Zod .strict() is enforced
  // locally by FunctionTool.runAsync. No provider schema may explicitly allow it.
  assert.ok(schema.additionalProperties===undefined || schema.additionalProperties===false,
    "Provider schema must not explicitly authorize unknown arguments");
}
test("OFFLINE: Gemini function smoke vs real Backend share ADK request parameters, differ only in declared scope",async()=>{
  const smokeModel=new FirstTurnCapture();
  let smokeExecutions=0, backendGatewayExecutions=0;
  const smokeAgent=new LlmAgent({
    name:"thesis_gemini_readonly_smoke",
    description:"Safe external Gemini ADK tool-calling test.",
    model:smokeModel,
    instruction:"Call read_file exactly once, with branch=feature/account-suspension "+
      "and path=apps/backend/src/users/user.service.ts. When done reply READY.",
    tools:[new FunctionTool({
      name:"read_file",
      description:"Read one harmless synthetic TypeScript fixture stored in memory.",
      parameters:z.object({branch:z.literal(BRANCH),path:z.literal(PATH)}).strict(),
      execute:async()=>{smokeExecutions++;throw new Error("Smoke tool must never execute offline");}
    })],
    disallowTransferToParent:true,
    disallowTransferToPeers:true,
    generateContentConfig:OUTPUT
  });
  const backendModel=new FirstTurnCapture();
  const {agent:backendAgent}=createAdkSpecializedAgent({
    role:"backend",
    model:backendModel,
    gatewayClient:{
      invoke:async()=>{backendGatewayExecutions++;throw new Error("Offline test must never contact Gateway");}
    } as never,
    generateContentConfig:OUTPUT
  });
  const smoke=await capture(smokeAgent,smokeModel,"smoke");
  const backend=await capture(backendAgent,backendModel,"backend");
  const smokeNames=declarations(smoke).map(d=>d.name);
  const backendNames=declarations(backend).map(d=>d.name);
  assert.deepEqual(smokeNames,["read_file"]);
  assert.deepEqual(backendNames,["read_file","update_file"]);
  const smokeShape=safeAdkRequestShape(smoke);
  const backendShape=safeAdkRequestShape(backend);
  assert.equal(smokeShape.max_output_tokens,1024);
  assert.equal(backendShape.max_output_tokens,1024);
  assert.equal(smokeShape.temperature,0);
  assert.equal(backendShape.temperature,0);
  assert.equal(smokeShape.function_declarations,1);
  assert.equal(backendShape.function_declarations,2);
  assert.ok(backendShape.system_instruction_text_chars!==null &&
    smokeShape.system_instruction_text_chars!==null &&
    backendShape.system_instruction_text_chars>smokeShape.system_instruction_text_chars);
  assert.ok(backendShape.content_text_chars!==null &&
    smokeShape.content_text_chars!==null &&
    backendShape.content_text_chars>smokeShape.content_text_chars);
  assertRequiredSchema(schemaOf(declarations(smoke)[0]!),["branch","path"]);
  assertRequiredSchema(schemaOf(declarations(backend)[0]!),["branch","path"]);
  assertRequiredSchema(schemaOf(declarations(backend)[1]!),["branch","path","content"]);
  for(const decl of declarations(backend)){
    assert.ok(!/merge|security|test_runner/u.test(decl.name??""),
      "Backend must publish no merge or privileged tools");
  }
  assert.equal(smokeExecutions,0);
  assert.equal(backendGatewayExecutions,0);
});

test("OFFLINE: Backend update_file declaration exposes only the required argument names",()=>{
  const backendModel=new FirstTurnCapture();
  const {agent}=createAdkSpecializedAgent({
    role:"backend",
    model:backendModel,
    gatewayClient:{invoke:async()=>{throw new Error("No Gateway in schema check");}} as never,
    generateContentConfig:OUTPUT
  });
  assert.deepEqual(agent.tools.map(t=>t.name),["read_file","update_file"]);
  const declarationsFromAdk=agent.tools.map(t=>t._getDeclaration());
  assert.deepEqual(declarationsFromAdk.map(d=>d.name),["read_file","update_file"]);
  assertRequiredSchema(schemaOf(declarationsFromAdk[0]!),["branch","path"]);
  assertRequiredSchema(schemaOf(declarationsFromAdk[1]!),["branch","path","content"]);
});
