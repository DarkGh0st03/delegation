import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,
  type BaseLlmConnection,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import { TaskState } from "@a2a-js/sdk";
import {safeAdkRequestShape} from "../src/adk-request-shape.ts";
import {
  DELEGATED_AUTHORIZATION_EXTENSION_URI,
  DeterministicA2AOrchestrator,
  startSpecializedAgentServer,
  type SpecializedAgentRole
} from "../src/index.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SECRET = "SECRET_DELEGATION_CREDENTIAL_PAYLOAD_PHASE3";
const BRANCH = "feature/account-suspension";
const PATHS = {
  backend: "apps/backend/src/users/user.service.ts",
  frontend: "apps/frontend/src/pages/UserDetailPage.tsx",
  test: "tests/backend/user.service.test.ts"
} as const;

class OneToolModel extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly repeat: boolean;
  constructor(toolName: string, args: Record<string, unknown>, repeat = false) {
    super({model: "phase3-adk-scripted-model"});
    this.toolName = toolName;
    this.args = args;
    this.repeat = repeat;
  }
  override async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.repeat) {
      yield {modelVersion:"phase3-adk-scripted-effective",content: {role: "model", parts: [{
        functionCall: {id:"phase3_call_" + this.requests.length, name:this.toolName, args:this.args}
      }]}};
    } else {
      yield {modelVersion:"phase3-adk-scripted-effective",content: {role:"model",parts:[{text:"Done via ADK and Gateway."}]}};
    }
  }
  override connect(_request: LlmRequest): Promise<BaseLlmConnection> {
    return Promise.reject(new Error("Live interface disabled in Phase 3 CI"));
  }
}

function fakeBoundary(role: SpecializedAgentRole, deny = false) {
  const requests: Array<{url:string;body:Record<string,unknown>}> = [];
  let prepareCalls = 0;
  let executeCalls = 0;
  const fetchFn = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const text = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string,unknown>;
    requests.push({url:text, body});
    const response = (status: number, obj: object) => new Response(JSON.stringify(obj),{
      status,headers:{"content-type":"application/json"}
    });
    if (text.endsWith("/v1/authorization/prepare")) {
      prepareCalls++;
      assert.equal(body.agent_role,role);
      assert.equal(typeof body.task_id, "string");
      return response(200,{
        request_id:"phase3-prepared-" + prepareCalls,
        audience:"cloud-access-gateway",
        challenge:"challenge-" + prepareCalls,
        required_permission:{resource:"https://gitea.local/thesis/iam-console-poc",operation:"read_file"},
        expires_at:"2026-12-01T00:00:00Z"
      });
    }
    if (text.endsWith("/v1/presentations")) {
      assert.equal(body.credential_id,"urn:phase3:child:" + role);
      assert.equal(init?.headers && (init.headers as Record<string,string>).authorization,"Bearer phase3-service-token");
      return response(200,{signed_vp:"signed-vp-not-to-be-shown-to-the-model"});
    }
    if (text.endsWith("/v1/authorization/execute")) {
      executeCalls++;
      assert.equal(typeof body.signed_vp,"string");
      if (deny) return response(403,{error:"Policy rejected this operation"});
      return response(200,{execution:role==="test"
        ? {tested_commit_sha:SHA,runner_profile:"poc-default",project_tests:{status:"pass"},researcher_acceptance:{status:"pass"}}
        : {provider:"gitea",commit_sha:SHA}});
    }
    throw new Error("Unexpected HTTP endpoint " + text);
  };
  return {requests,fetchFn,counts:()=>({prepareCalls,executeCalls})};
}

async function send(role: SpecializedAgentRole, model: BaseLlm, fetchFn: typeof fetch,
  port: number, generateContentConfig?: {maxOutputTokens:number;temperature:number}) {
  const server=await startSpecializedAgentServer({
    role,host:"127.0.0.1",port,
    adk:{model,fetchFn,gatewayBaseUrl:"http://gateway.local",
      adapterBaseUrl:"http://adapter.local",adapterToken:"phase3-service-token",
      ...(generateContentConfig ? {generateContentConfig} : {})}
  });
  const orchestrator=new DeterministicA2AOrchestrator();
  const evidence={credential:SECRET,credential_id:"urn:phase3:child:"+role,presenter_id:"did:thesis:"+role+"-agent"};
  try {
    const response=await orchestrator.sendProtectedTask({
      agent_base_url:server.baseUrl,
      subtask:{subtask_id:"phase3-"+role,instruction:"Perform a controlled change",branch:BRANCH,relevant_paths:[PATHS[role]]},
      delegation_evidence:evidence
    });
    return {response,serverContext:server.executor.taskContexts.get(response.task.id),executions:server.executor.executionCount};
  } finally {
    await server.close();
  }
}

for (const role of ["backend","frontend","test"] as const) {
  test("Phase 3 protected A2A invokes actual ADK " + role + " Runner without leaking credentials",async()=>{
    const boundary=fakeBoundary(role);
    const toolName=role==="test"?"run_tests":"update_file";
    const args=role==="test"
      ? {branch:BRANCH,profile:"poc-default"}
      : {branch:BRANCH,path:PATHS[role],content:"authorized feature implementation"};
    const model=new OneToolModel(toolName,args);
    const {response,serverContext,executions}=await send(role,model,boundary.fetchFn as typeof fetch,role==="backend"?43371:role==="frontend"?43372:43373);
    assert.equal(response.task.status?.state,TaskState.TASK_STATE_COMPLETED);
    assert.equal(response.task.artifacts.length,1);
    assert.equal(response.task.history.length,0);
    assert.equal(executions,1);
    assert.equal(serverContext?.delegation_evidence.credential,SECRET);
    assert.equal(model.requests.length,2);
    const visible=JSON.stringify(model.requests.map(x=>({contents:x.contents,config:x.config})));
    assert.equal(visible.includes(SECRET),false);
    assert.equal(visible.includes("phase3-service-token"),false);
    assert.equal(visible.includes("delegation_evidence"),false);
    const external=JSON.stringify(response.task.artifacts);
    assert.equal(external.includes(SECRET),false);
    assert.equal(external.includes("phase3-service-token"),false);
    assert.equal(external.includes("signed-vp-not-to-be-shown-to-the-model"),false);
    assert.equal(external.includes("delegation_evidence"),false);
    const part=response.task.artifacts[0]?.parts[0]?.content;
    assert.equal(part?.$case,"data");
    if(part?.$case==="data"){
      assert.equal(part.value.role,role);
      assert.equal(part.value.revision,SHA);
      assert.equal(part.value.commit_sha,SHA);
      assert.equal(part.value.model_id,"phase3-adk-scripted-effective");
      assert.equal(part.value.model_iterations,2);
      assert.deepEqual(part.value.errors,[]);
      if(role==="test"){
        assert.equal(part.value.test_outcome,"pass");
        assert.equal(part.value.tested_commit_sha,SHA);
      }else {
        assert.equal(part.value.test_outcome,"not_run");
        assert.deepEqual(part.value.files_modified,[PATHS[role]]);
      }
    }
    assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
    const call=boundary.requests.find(r=>r.url.endsWith("/v1/authorization/prepare"));
    assert.equal((call?.body.arguments as Record<string,unknown>)?.content,role==="test"?undefined:"authorized feature implementation");
    assert.ok(response.card.capabilities?.extensions.some(e=>e.uri===DELEGATED_AUTHORIZATION_EXTENSION_URI));
  });
}

test("Phase 3 Gateway denial never becomes a completed authorized A2A Artifact",async()=>{
  const role="backend";
  const boundary=fakeBoundary(role,true);
  const model=new OneToolModel("update_file",{branch:BRANCH,path:PATHS.backend,content:"forbidden"});
  let completed=false;
  try {
    const {response}=await send(role,model,boundary.fetchFn as typeof fetch,43374);
    completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
  }catch {
    // A2A SDK can propagate the handler failure as a transport error.
  }
  assert.equal(completed,false);
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
});

test("Phase 3 per-task model budget fails closed before a successful Artifact",async()=>{
  const boundary=fakeBoundary("backend");
  const model=new OneToolModel("update_file",{branch:BRANCH,path:PATHS.backend,content:"bounded"},true);
  const server=await startSpecializedAgentServer({
    role:"backend",port:43375,
    adk:{model,maxModelTurns:1,fetchFn:boundary.fetchFn as typeof fetch,
      gatewayBaseUrl:"http://gateway.local",adapterBaseUrl:"http://adapter.local",
      adapterToken:"phase3-service-token"}
  });
  try {
    const orchestrator=new DeterministicA2AOrchestrator();
    let completed=false;
    try{
      const response=await orchestrator.sendProtectedTask({
        agent_base_url:server.baseUrl,
        subtask:{subtask_id:"bounded",instruction:"Do controlled work",branch:BRANCH,relevant_paths:[PATHS.backend]},
        delegation_evidence:{credential:SECRET,credential_id:"urn:phase3:child:backend",presenter_id:"did:thesis:backend-agent"}
      });
      completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
    }catch{}
    assert.equal(completed,false);
    assert.equal(model.requests.length,1);
  }finally{await server.close();}
});

test("Phase 3 explicit backend generation cap survives the real protected A2A/ADK boundary",async()=>{
  const boundary=fakeBoundary("backend");
  const model=new OneToolModel("update_file",{
    branch:BRANCH,path:PATHS.backend,content:"export const status = 'SUSPENDED';"
  });
  const {response}=await send("backend",model,boundary.fetchFn as typeof fetch,
    43376,{maxOutputTokens:1024,temperature:0});
  assert.equal(response.task.status?.state,TaskState.TASK_STATE_COMPLETED);
  assert.equal(model.requests.length,2);
  for (const request of model.requests) {
    const diagnostic=safeAdkRequestShape(request);
    assert.equal(diagnostic.max_output_tokens,1024);
    assert.equal(diagnostic.temperature,0);
    assert.equal(diagnostic.function_declarations,2);
  }
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
});
