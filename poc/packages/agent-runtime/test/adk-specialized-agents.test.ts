import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,
  InMemorySessionService,
  LlmAgent,
  Runner,
  type BaseLlmConnection,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import {
  ControlledToolError,
  createAdkSpecializedAgent,
  SPECIALIZED_AGENT_PROFILES,
  type SpecializedAgentRole
} from "../src/index.ts";

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
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
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
    role, model, gatewayClient: gatewayClient as never
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
        instruction:"Inspect permitted file",branch:BRANCH,
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
