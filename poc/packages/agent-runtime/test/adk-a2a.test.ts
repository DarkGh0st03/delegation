import assert from "node:assert/strict";
import test from "node:test";
import {
  BaseLlm,
  type BaseLlmConnection,
  type LlmRequest,
  type LlmResponse
} from "@google/adk";
import { TaskState } from "@a2a-js/sdk";
import {safeAdkRequestShape,safeAdkFunctionHistoryShape} from "../src/adk-request-shape.ts";
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

function fakeBoundary(role: SpecializedAgentRole, deny = false,
  readOnly = false, failedFirstTest = false) {
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
      return response(200,{execution:readOnly
        ? {provider:"gitea",performed:true,tool:"read_file",
           branch:BRANCH,path:PATHS[role],revision:SHA,
           content:"authenticated file contents",blob_sha:"b",
           last_commit_sha:SHA,size:27,encoding:"utf-8"}
        :role==="test"
          ? {tested_commit_sha:SHA,runner_profile:"poc-default",
            ...(failedFirstTest&&executeCalls===1?{
              status:"fail",
              phases:[{phase:"backend_tests",status:"fail",
                private_log:"SECRET_FAILING_TEST_LOG"}],
              project_tests:{status:"fail"},researcher_acceptance:{status:"skipped"}
            }:{
              status:"pass",
              project_tests:{status:"pass"},researcher_acceptance:{status:"pass"}
            })}
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


test("ADK read-only specialist completes from a Gateway-pinned revision",async()=>{
  const boundary=fakeBoundary("backend",false,true);
  const model=new OneToolModel("read_file",{branch:BRANCH,path:PATHS.backend});
  const {response}=await send("backend",model,boundary.fetchFn as typeof fetch,43378);
  assert.equal(response.task.status?.state,TaskState.TASK_STATE_COMPLETED);
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
});




test("R79 provider MAX_TOKENS with functionCall cannot execute any controlled tool",async()=>{
  class TruncatedToolModel extends BaseLlm {
    readonly requests:LlmRequest[]=[];
    constructor(){super({model:"offline-truncated-tool-no-provider"});}
    override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      yield {content:{role:"model",parts:[{
        functionCall:{id:"truncated-untrusted-edit",name:"update_file",
          args:{branch:BRANCH,path:PATHS.frontend,content:"INCOMPLETE_EDIT"}}
      }]},finishReason:"MAX_TOKENS"};
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("Live generation prohibited in R79 regression"));
    }
  }
  const boundary=fakeBoundary("frontend");
  const model=new TruncatedToolModel();
  let completed=false;
  try{
    const {response}=await send("frontend",model,
      boundary.fetchFn as typeof fetch,43414);
    completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
  }catch{/* Fail-closed A2A may surface model failure as a transport error. */}
  assert.equal(completed,false);
  assert.equal(model.requests.length,1);
  assert.deepEqual(boundary.counts(),{prepareCalls:0,executeCalls:0},
    "Truncated functionCall must not reach the controlled Gateway");
});

/**
 * R78: Paid R77 Frontend showed MAX_TOKENS followed by an approved-plan
 * denial. This local model reproduces a terminal truncated response after
 * one genuine Gateway read; no provider API or private source is used.
 * A read-only specialist can still finish on STOP (separate regression).
 */
test("R78 Frontend terminal MAX_TOKENS cannot attest a completed A2A Task",async()=>{
  class TruncatedFrontendModel extends BaseLlm {
    readonly requests:LlmRequest[]=[];
    constructor(){super({model:"offline-truncated-frontend-no-provider"});}
    override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      if(this.requests.length===1){
        yield {content:{role:"model",parts:[{
          functionCall:{id:"read-before-truncation",name:"read_file",
            args:{branch:BRANCH,path:PATHS.frontend}}
        }]}};
      }else{
        yield {content:{role:"model",parts:[{text:"UNFINISHED_RESPONSE"}]},
          finishReason:"MAX_TOKENS"};
      }
    }
    override connect():Promise<BaseLlmConnection>{
      return Promise.reject(Error("No provider calls in R78 regression"));
    }
  }
  const boundary=fakeBoundary("frontend",false,true);
  const model=new TruncatedFrontendModel();
  let completed=false;
  try{
    const {response}=await send("frontend",model,
      boundary.fetchFn as typeof fetch,43413);
    completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
  }catch{/* A2A may propagate a protected model failure as a transport error. */}
  assert.equal(completed,false,
    "Truncated final model output cannot be accepted from read evidence alone");
  assert.equal(model.requests.length,2);
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
});


/**
 * Offline regression for the actual protected A2A -> BoundedModel -> ADK
 * function-response path. Gemini 3 requires the model's original signature
 * when the next request includes its prior functionCall. This fixture makes
 * no provider calls and carries no real signature or credential.
 */
test("Protected A2A preserves synthetic model thought signature through Gateway read",async()=>{
  const signature="SYNTHETIC_SIGNATURE_NOT_FROM_ANY_PROVIDER";
  class SignedReadModel extends BaseLlm {
    readonly requests:LlmRequest[]=[];
    constructor(){super({model:"local-signed-read-no-provider"});}
    override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      if(this.requests.length===1)yield {content:{role:"model",parts:[{
        functionCall:{id:"offline-signed-read",name:"read_file",
          args:{branch:BRANCH,path:PATHS.backend}},
        thoughtSignature:signature
      }]}};
      else yield {content:{role:"model",parts:[{text:"Gateway read complete"}]}};
    }
    override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
      return Promise.reject(Error("External Gemini calls forbidden in offline signature regression"));
    }
  }
  const boundary=fakeBoundary("backend",false,true);
  const model=new SignedReadModel();
  const {response}=await send("backend",model,boundary.fetchFn as typeof fetch,43401);
  assert.equal(response.task.status?.state,TaskState.TASK_STATE_COMPLETED);
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
  assert.equal(model.requests.length,2);
  const second=model.requests[1]!;
  const history=second.contents;
  const callIndex=history.findIndex(content=>content.role==="model" &&
    content.parts?.some(part=>part.functionCall?.name==="read_file"));
  assert.ok(callIndex>=0,"Prior signed model functionCall must remain in ADK history");
  const toolIndex=history.findIndex((content,index)=>index>callIndex &&
    content.parts?.some(part=>part.functionResponse?.name==="read_file"));
  assert.ok(toolIndex>callIndex,"Function response must follow its signed model call");
  const signedPart=history[callIndex]?.parts?.find(part=>
    part.functionCall?.name==="read_file");
  assert.equal(signedPart?.thoughtSignature,signature);
  assert.deepEqual(safeAdkFunctionHistoryShape(second),{
    function_call_messages:1,function_call_messages_missing_signature:0
  });
  assert.equal(JSON.stringify(safeAdkFunctionHistoryShape(second)).includes(signature),false);
});

class TwoRunsModel extends BaseLlm {
  readonly requests:LlmRequest[]=[];
  constructor(){super({model:"phase3-offline-recoverable-tests"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    if(this.requests.length<=2){
      yield {content:{role:"model",parts:[{
        functionCall:{id:"run_"+this.requests.length,name:"run_tests",
          args:{branch:BRANCH,profile:"poc-default"}}
      }]}};
    }else yield {content:{role:"model",parts:[{text:"Done"}]}};
  }
  override connect():Promise<BaseLlmConnection>{
    return Promise.reject(Error("Live model prohibited"));
  }
}

test("R120 Test A2A FAIL cannot be turned into same-task PASS",async()=>{
  const boundary=fakeBoundary("test",false,false,true);
  const model=new TwoRunsModel();
  let completed=false,artifacts="";
  try{
    const {response}=await send("test",model,boundary.fetchFn as typeof fetch,43379);
    completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
    artifacts=JSON.stringify(response.task.artifacts);
  }catch{/* A2A may surface terminal failure through the transport. */}
  assert.equal(completed,false);
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
  assert.equal(model.requests.length,3);
  assert.equal(artifacts.includes("SECRET_FAILING_TEST_LOG"),false);
});

test("Protected A2A Test Agent cannot complete with only failed Docker evidence",async()=>{
  const boundary=fakeBoundary("test",false,false,true);
  const model=new OneToolModel("run_tests",{branch:BRANCH,profile:"poc-default"});
  let completed=false;
  try{
    const {response}=await send("test",model,boundary.fetchFn as typeof fetch,43380);
    completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
  }catch{}
  assert.equal(completed,false);
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
});


class RepairWorkflowModel extends BaseLlm{
  readonly requests:LlmRequest[]=[];
  constructor(){super({model:"offline-adk-realistic-repair"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    const calls=[
      {name:"run_tests",args:{branch:BRANCH,profile:"poc-default"}},
      {name:"read_file",args:{branch:BRANCH,path:PATHS.test}},
      {name:"update_file",args:{branch:BRANCH,path:PATHS.test,
        content:"approved test repair"}},
      {name:"run_tests",args:{branch:BRANCH,profile:"poc-default"}}
    ];
    const next=calls[this.requests.length-1];
    yield {content:{role:"model",parts:next?[{
      functionCall:{id:"repair_"+this.requests.length,...next}
    }]:[{text:"Completed verified repair"}]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    return Promise.reject(Error("No provider API in offline repair test"));
  }
}
test("R120 same-task source edit after failed Runner cannot authorize a second PASS",async()=>{
  const calls:string[]=[];
  const initialSha="a".repeat(40),fixedSha="b".repeat(40);
  let pending="",revision=initialSha;
  const respond=(status:number,value:object)=>new Response(JSON.stringify(value),{
    status,headers:{"content-type":"application/json"}
  });
  const fetchFn=async(url:URL|RequestInfo,init?:RequestInit):Promise<Response>=>{
    const target=String(url);
    const payload=JSON.parse(String(init?.body??"{}"));
    if(target.endsWith("/v1/authorization/prepare")){
      pending=payload.tool;
      return respond(201,{request_id:"repair-"+calls.length,
        audience:"cloud-access-gateway",challenge:"challenge",
        required_permission:{operation:pending,resource:"approved-task"},
        expires_at:"2026-12-01T00:00:00Z"});
    }
    if(target.endsWith("/v1/presentations"))
      return respond(200,{signed_vp:"fixture-only-signed-vp"});
    if(!target.endsWith("/v1/authorization/execute"))
      throw Error("Unexpected trusted endpoint");
    calls.push(pending);
    switch(pending){
      case "read_file":return respond(200,{execution:{
        provider:"gitea",performed:true,tool:"read_file",branch:BRANCH,
        path:PATHS.test,revision,content:"pre-repair source"
      }});
      case "update_file":
        revision=fixedSha;
        return respond(200,{execution:{provider:"gitea",performed:true,
          tool:"update_file",branch:BRANCH,path:PATHS.test,commit_sha:revision}});
      case "run_tests":{
        const passed=revision===fixedSha;
        return respond(200,{execution:{provider:"runner",performed:true,
          tool:"run_tests",branch:BRANCH,revision,
          status:passed?"pass":"fail",tested_commit_sha:revision,
          runner_profile:"poc-default",
          phases:[{phase:"backend_tests",status:passed?"pass":"fail"}],
          project_tests:{status:passed?"pass":"fail"},
          researcher_acceptance:{status:passed?"pass":"skipped"}
        }});
      }
    }
    throw Error("Unapproved tool");
  };
  const model=new RepairWorkflowModel();
  let completed=false;
  try{
    const {response}=await send("test",model,fetchFn as typeof fetch,43381);
    completed=response.task.status?.state===TaskState.TASK_STATE_COMPLETED;
  }catch{/* A failed Test must not be accepted as completed. */}
  assert.equal(completed,false);
  assert.deepEqual(calls,["run_tests","read_file","update_file"],
    "Second same-task run_tests cannot reach Gateway or Docker");
  assert.equal(revision,fixedSha,
    "Source edit alone is not a new verified Test acceptance");
});

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

test("Protected non-streaming ADK preserves Gemini tool thought signature across turns",async()=>{
  const signature="OFFLINE_SYNTHETIC_GEMINI_SIGNATURE_DO_NOT_LOG";
  class SignatureModel extends BaseLlm{
    readonly requests:LlmRequest[]=[];
    constructor(){super({model:"signed-nonstream-gemini-simulator"});}
    override async *generateContentAsync(request:LlmRequest):
      AsyncGenerator<LlmResponse,void>{
      this.requests.push(request);
      if(this.requests.length===1){
        yield {content:{role:"model",parts:[{
          functionCall:{id:"signed-file-edit",name:"update_file",args:{
            branch:BRANCH,path:PATHS.backend,content:"authorized edit"
          }},
          thoughtSignature:signature
        }]}};
      }else{
        yield {content:{role:"model",parts:[{text:"Done."}]}};
      }
    }
    override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
      return Promise.reject(new Error("No provider connection"));
    }
  }
  const boundary=fakeBoundary("backend");
  const model=new SignatureModel();
  const {response}=await send("backend",model,boundary.fetchFn as typeof fetch,
    43377);
  assert.equal(response.task.status?.state,TaskState.TASK_STATE_COMPLETED);
  assert.equal(model.requests.length,2);
  const signedHistory=model.requests[1].contents.filter(c=>c.role==="model")
    .flatMap(c=>c.parts??[]).filter(p=>p.functionCall);
  assert.equal(signedHistory.length,1);
  assert.equal(signedHistory[0].thoughtSignature,signature,
    "ADK must not drop original provider signature in subsequent tool turn");
  assert.deepEqual(boundary.counts(),{prepareCalls:1,executeCalls:1});
});
