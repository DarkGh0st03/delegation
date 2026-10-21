import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,
  FunctionTool,
  InMemorySessionService,
  LlmAgent,
  Runner,
  type BaseLlmConnection,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import {safeAdkRequestShape} from "../src/adk-request-shape.ts";
import {
  ControlledToolError,
  createAdkSpecializedAgent,
  SPECIALIZED_AGENT_PROFILES,
  type SpecializedAgentRole
} from "../src/index.ts";
import type {AdkGenerationConfig} from "../src/adk-specialized-agents.ts";

const BRANCH = "feature/account-suspension";
const PATHS: Record<SpecializedAgentRole, string> = {
  backend: "apps/backend/src/users/user.service.ts",
  frontend: "apps/frontend/src/pages/UserDetailPage.tsx",
  test: "tests/backend/user.service.test.ts"
};

class ScriptedAdkLlm extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  readonly tool: string;
  readonly args: Record<string, unknown>;
  constructor(tool: string, args: Record<string, unknown>) {
    super({ model: "thesis-scripted-adk-phase2" });
    this.tool = tool;
    this.args = args;
  }
  override async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { content: { role: "model", parts: [{ functionCall: {
        id: "phase2-tool-call", name: this.tool, args: this.args
      } }] } };
    } else {
      yield { content: { role: "model", parts: [{ text: "Completed via ADK Runner." }] } };
    }
  }
  override async connect(_request: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("Live streaming not enabled in deterministic Phase 2 tests");
  }
}

async function exercise(role: SpecializedAgentRole, tool: string, args: Record<string, unknown>,
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  generateContentConfig?: AdkGenerationConfig,
  scopeModelPaths = false, trustedBranch?:string) {
  const model = new ScriptedAdkLlm(tool, args);
  const calls: Array<{name:string; args:Record<string,unknown>}> = [];
  const gatewayClient = {
    // This object is deliberately opaque to ADK and never passed in a message.
    privateCredential: "NEVER_EXPOSE_DELEGATION_EVIDENCE",
    invoke: async (name: string, payload: Record<string, unknown>) => {
      calls.push({name, args: payload});
      return await invoke(name, payload);
    }
  };
  const built = createAdkSpecializedAgent({
    role, model, gatewayClient: gatewayClient as never,
    ...(generateContentConfig ? {generateContentConfig} : {}),
    ...(scopeModelPaths ? {scopeModelPaths: true} : {}),
    ...(trustedBranch?{trustedBranch}:{})
  });
  const sessionService = new InMemorySessionService();
  const appName = "thesis_phase2_adk_" + role;
  const userId = "phase2-test";
  const sessionId = "phase2-session";
  const runner = new Runner({appName,agent:built.agent,sessionService});
  await sessionService.createSession({appName,userId,sessionId});
  const eventParts: string[] = [];
  for await (const event of runner.runAsync({
    userId,sessionId,
    newMessage: {role:"user",parts:[{text:JSON.stringify({
      task_id:"phase2-task",role,subtask:{
        instruction:"Inspect permitted file",branch:trustedBranch??BRANCH,
        relevant_paths:[PATHS[role]]
      }
    })}]}
  })) {
    for (const part of event.content?.parts ?? []) {
      if (typeof part.text === "string") eventParts.push(part.text);
    }
  }
  return {built,model,calls,eventParts};
}

for (const role of ["backend","frontend","test"] as const) {
  test(`Phase 2: ${role} ADK Agent calls only its controlled role tools`, async () => {
    const {built,model,calls} = await exercise(
      role,"read_file",{branch:BRANCH,path:PATHS[role]},
      async () => ({provider:"gitea",content:"safe file contents"})
    );
    assert.ok(built.agent instanceof LlmAgent);
    assert.deepEqual(
      built.agent.tools.map(tool=>tool.name),
      SPECIALIZED_AGENT_PROFILES[role].tools
    );
    assert.equal(model.requests.length,2);
    assert.deepEqual(calls, [{name:"read_file",args:{branch:BRANCH,path:PATHS[role]}}]);
    const requestText=JSON.stringify(model.requests.map(r=>({contents:r.contents,config:r.config})));
    assert.ok(!requestText.includes("NEVER_EXPOSE_DELEGATION_EVIDENCE"));
    assert.ok(!requestText.includes("delegation_evidence"));
  });
}

test("Phase 2: Test role has test tools; no other role has create_file/run_tests", () => {
  for (const role of ["backend","frontend","test"] as const) {
    const built=createAdkSpecializedAgent({role, model:new ScriptedAdkLlm("read_file",{}),
      gatewayClient:{invoke:async()=>({})} as never});
    assert.equal(built.agent.tools.some(t=>t.name==="create_file"),role==="test");
    assert.equal(built.agent.tools.some(t=>t.name==="run_tests"),role==="test");
  }
});

test("Phase 2: gateway authorization denial is not bypassed or swallowed as success", async () => {
  const {calls,model} = await exercise("backend","update_file",{
    branch:BRANCH,path:"security/src/security-config.ts",content:"blocked"
  },async()=>{throw new ControlledToolError("authorization_denied","Permission is not delegated");});
  assert.equal(calls.length,1);
  assert.equal(model.requests.length,2);
  const second=JSON.stringify(model.requests[1]?.contents);
  assert.match(second,/authorization_denied/u);
  assert.doesNotMatch(second,/NEVER_EXPOSE_DELEGATION_EVIDENCE/u);
});

test("Phase 2: invalid input is rejected before any Gateway invocation", async () => {
  let calls=0;
  const {model}=await exercise("backend","read_file",{
    branch:BRANCH,path:PATHS.backend,operation:"merge_pull_request"
  },async()=>{calls++;return {provider:"gitea"};});
  assert.equal(calls,0);
  assert.equal(model.requests.length,2);
});

test("Phase 2: Test ADK agent can invoke controlled run_tests and receives exact-SHA outcome", async () => {
  const {calls,model} = await exercise("test","run_tests",{
    branch:BRANCH,profile:"poc-default"
  },async()=>({
    runner_profile:"poc-default",
    tested_commit_sha:"0123456789abcdef0123456789abcdef01234567",
    project_tests:{status:"pass"},
    researcher_acceptance:{status:"pass"}
  }));
  assert.deepEqual(calls,[{name:"run_tests",args:{branch:BRANCH,profile:"poc-default"}}]);
  const second=JSON.stringify(model.requests[1]?.contents);
  assert.match(second,/tested_commit_sha/u);
  assert.match(second,/researcher_acceptance/u);
  assert.doesNotMatch(second,/NEVER_EXPOSE_DELEGATION_EVIDENCE/u);
});

test("Phase 2: Test ADK agent can request create_file only through the Gateway", async () => {
  const {calls}=await exercise("test","create_file",{
    branch:BRANCH,path:"tests/e2e/account-suspension.spec.ts",
    content:"test('account suspension', () => {});"
  },async()=>({commit_sha:"abcdef0123456789abcdef0123456789abcdef01",provider:"gitea"}));
  assert.equal(calls.length,1);
  assert.equal(calls[0]?.name,"create_file");
});

test("Unconfigured Backend ADK first-turn request has two declared tools and no output cap",async()=>{
  const {model}=await exercise("backend","read_file",{
    branch:BRANCH,path:PATHS.backend
  },async()=>({content:"fixture"}));
  assert.equal(model.requests.length,2);
  const shape=safeAdkRequestShape(model.requests[0]!);
  assert.ok(shape.content_messages!==null && shape.content_messages>0);
  assert.ok(shape.content_text_chars!==null && shape.content_text_chars>0);
  assert.ok(shape.system_instruction_text_chars!==null &&
    shape.system_instruction_text_chars>100);
  assert.equal(shape.function_declarations,2);
  assert.equal(shape.max_output_tokens,null);
  assert.equal(shape.temperature,null);
  assert.equal(JSON.stringify(shape).includes("NEVER_EXPOSE_DELEGATION_EVIDENCE"),false);
});

test("Explicit Gemini Backend generation settings are forwarded to each ADK turn",async()=>{
  const {model,built}=await exercise("backend","read_file",{
    branch:BRANCH,path:PATHS.backend
  },async()=>({content:"synthetic backend file"}),
    {maxOutputTokens:1024,temperature:0});
  assert.equal(model.requests.length,2);
  assert.deepEqual(built.agent.tools.map(tool=>tool.name),["read_file","update_file"]);
  for (const request of model.requests) {
    const shape=safeAdkRequestShape(request);
    assert.equal(shape.max_output_tokens,1024);
    assert.equal(shape.temperature,0);
    assert.equal(shape.function_declarations,2);
  }
});

test("Extended live Backend output allowance propagates without changing Gateway tools",async()=>{
  const {model,built}=await exercise("backend","read_file",{
    branch:BRANCH,path:PATHS.backend
  },async()=>({content:"synthetic authorized file"}),
    {maxOutputTokens:16384,temperature:0});
  assert.deepEqual(built.agent.tools.map(tool=>tool.name),["read_file","update_file"]);
  assert.equal(model.requests.length,2);
  for (const request of model.requests) {
    const shape=safeAdkRequestShape(request);
    assert.equal(shape.max_output_tokens,16384);
    assert.equal(shape.temperature,0);
    assert.equal(shape.function_declarations,2);
  }
});

test("Explicit Gemini LOW thinking config is forwarded to each native ADK model call",async()=>{
  const {model}=await exercise("backend","read_file",{
    branch:BRANCH,path:PATHS.backend
  },async()=>({content:"synthetic authorized file"}),
    {maxOutputTokens:16384,temperature:0,thinkingConfig:{thinkingLevel:"LOW" as never}});
  assert.equal(model.requests.length,2);
  for(const request of model.requests) {
    assert.equal(safeAdkRequestShape(request).thinking_level,"LOW");
    assert.equal(request.config?.thinkingConfig?.thinkingLevel,"LOW");
  }
});

test("Live Backend model path declarations limit candidate reads and writes without bypassing Gateway",async()=>{
  const {model,built,calls}=await exercise("backend","read_file",{
    branch:BRANCH,path:PATHS.backend
  },async()=>({content:"synthetic authorized file"}),
    {maxOutputTokens:16384,temperature:0},true);
  assert.deepEqual(built.agent.tools.map(tool=>tool.name),["read_file","update_file"]);
  assert.equal(calls.length,1);
  const declared=(model.requests[0]?.config?.tools??[])
    .flatMap(tool=>tool.functionDeclarations??[]);
  assert.equal(declared.length,2);
  const readSchema=JSON.stringify(declared.find(tool=>tool.name==="read_file"));
  const writeSchema=JSON.stringify(declared.find(tool=>tool.name==="update_file"));
  assert.match(readSchema,/"enum"/u);
  assert.match(writeSchema,/"enum"/u);
  const profile=SPECIALIZED_AGENT_PROFILES.backend;
  for(const path of profile.writable_paths) {
    assert.ok(readSchema.includes(path));
    assert.ok(writeSchema.includes(path));
  }
  for(const path of profile.read_only_paths) {
    assert.ok(readSchema.includes(path));
    assert.ok(!writeSchema.includes(path));
  }
  assert.ok(!readSchema.includes("security/src/security-config.ts"));
});

test("Unconfigured Frontend and Test agent requests preserve provider defaults",async()=>{
  for (const role of ["frontend","test"] as const) {
    const {model}=await exercise(role,"read_file",{
      branch:BRANCH,path:PATHS[role]
    },async()=>({content:"synthetic role file"}));
    assert.equal(model.requests.length,2);
    const shape=safeAdkRequestShape(model.requests[0]!);
    assert.equal(shape.max_output_tokens,null);
    assert.equal(shape.temperature,null);
  }
});


test("Live Frontend scoped ADK declarations expose only its delegated read/write paths",async()=>{
  const {built,model,calls}=await exercise("frontend","read_file",{
    branch:BRANCH,path:PATHS.frontend
  },async()=>({content:"synthetic Frontend file"}),
    {maxOutputTokens:16384,temperature:0,thinkingConfig:{thinkingLevel:"LOW" as never}},true);
  assert.deepEqual(built.agent.tools.map(t=>t.name),["read_file","update_file"]);
  assert.equal(calls.length,1);
  const declarations=(model.requests[0]?.config?.tools??[])
    .flatMap(t=>t.functionDeclarations??[]);
  const readable=JSON.stringify(declarations.find(t=>t.name==="read_file"));
  const writable=JSON.stringify(declarations.find(t=>t.name==="update_file"));
  const profile=SPECIALIZED_AGENT_PROFILES.frontend;
  for(const p of profile.writable_paths) {
    assert.ok(readable.includes(p));
    assert.ok(writable.includes(p));
  }
  for(const p of profile.read_only_paths) {
    assert.ok(readable.includes(p));
    assert.ok(!writable.includes(p));
  }
  assert.ok(!writable.includes(PATHS.backend));
  assert.equal(safeAdkRequestShape(model.requests[0]!).thinking_level,"LOW");
});

test("Live Test Agent exposes scoped create_file and does not inherit application writes",async()=>{
  const path="tests/e2e/account-suspension.spec.ts";
  const {built,model,calls}=await exercise("test","create_file",{
    branch:BRANCH,path,content:"import { test } from '@playwright/test';"
  },async()=>({provider:"gitea",created:true}),
    {maxOutputTokens:16384,temperature:0,thinkingConfig:{thinkingLevel:"LOW" as never}},true);
  assert.deepEqual(built.agent.tools.map(t=>t.name),
    ["read_file","update_file","create_file","run_tests"]);
  assert.equal(calls.length,1);
  const declarations=(model.requests[0]?.config?.tools??[])
    .flatMap(t=>t.functionDeclarations??[]);
  const creatable=JSON.stringify(declarations.find(t=>t.name==="create_file"));
  const writable=JSON.stringify(declarations.find(t=>t.name==="update_file"));
  const readable=JSON.stringify(declarations.find(t=>t.name==="read_file"));
  assert.ok(creatable.includes(path));
  assert.ok(!creatable.includes("apps/backend/src/users/user.service.ts"));
  assert.ok(writable.includes("tests/backend/user.service.test.ts"));
  assert.ok(!writable.includes("apps/backend/src/users/user.service.ts"));
  assert.ok(readable.includes("apps/backend/src/users/user.service.ts"));
  assert.equal(safeAdkRequestShape(model.requests[0]!).thinking_level,"LOW");
});

test("32,000-token Gemini 3.8 LOW budget reaches each role's native ADK requests",async()=>{
  for(const role of ["backend","frontend","test"] as const){
    const {model,built,calls}=await exercise(role,"read_file",{
      branch:BRANCH,path:PATHS[role]
    },async()=>({content:"synthetic permitted source"}),
    {maxOutputTokens:32000,temperature:0,
      thinkingConfig:{thinkingLevel:"LOW" as never}},true);
    assert.ok(built.agent.tools.length>0);
    assert.equal(calls.length,1);
    assert.equal(model.requests.length,2);
    for(const request of model.requests) {
      const shape=safeAdkRequestShape(request);
      assert.equal(shape.max_output_tokens,32000);
      assert.equal(shape.thinking_level,"LOW");
      assert.equal(shape.temperature,0);
    }
  }
});

test("MCP-enabled Test Agent exposes run_tests once as a controlled FunctionTool",()=>{
  // Check the ADK tool registry, not source-file spelling/formatting.
  // The separate timeout tests verify the MCP SDK request options.
  const built=createAdkSpecializedAgent({
    role:"test",
    model:new ScriptedAdkLlm("run_tests",{branch:BRANCH,profile:"poc-default"}),
    gatewayClient:{invoke:async()=>({})} as never,
    mcpReadFile:{
      endpoint:"http://127.0.0.1:8097/mcp",
      bearerForRequest:()=>"test-task-bearer"
    },
    mcpRunTests:true
  });
  assert.ok(built.mcpToolset);
  const bounded= built.agent.tools.filter(tool=>tool.name==="run_tests");
  assert.equal(bounded.length,1);
  assert.ok(bounded[0] instanceof FunctionTool);
});

test("Engineer-approved branch is exposed as an exact ADK tool argument, not as authority",async()=>{
  const b="feature/engineer-approved-42";
  const {built,calls,model}=await exercise("backend","read_file",{
    branch:b,path:PATHS.backend
  },async()=>({content:"approved branch fixture"}),undefined,false,b);
  assert.deepEqual(calls,[{name:"read_file",args:{branch:b,path:PATHS.backend}}]);
  assert.equal(model.requests.length,2);
  assert.match(built.profile.system_prompt,/feature\/engineer-approved-42/);
  assert.doesNotMatch(built.profile.system_prompt,/feature\/account-suspension/);
  const denied=await exercise("backend","read_file",{
    branch:"feature/account-suspension",path:PATHS.backend
  },async()=>({content:"must not be read"}),undefined,false,b);
  assert.deepEqual(denied.calls,[]);
  assert.throws(()=>createAdkSpecializedAgent({
    role:"backend",model:new ScriptedAdkLlm("read_file",{}),
    gatewayClient:{invoke:async()=>({})} as never,
    trustedBranch:b,
    mcpReadFile:{endpoint:"http://127.0.0.1:9999",bearerForRequest:()=>"unused"}
  }),/not yet supported by shared MCP/);
});
