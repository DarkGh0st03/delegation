import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {BaseLlm,InMemorySessionService,Runner,
  type LlmRequest,type LlmResponse,type BaseLlmConnection} from "@google/adk";
import {createAdkSpecializedAgent} from "../src/adk-specialized-agents.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {createSharedMcpHttpServer} from "../../../mcp-shared/src/http-server.ts";
import {TaskRouter} from "../../../mcp-shared/src/task-router.ts";
import {ControlledToolError} from "../src/controlled-errors.ts";

const args={branch:"feature/account-suspension",profile:"poc-default"};
const sha="f".repeat(40);
const execution={provider:"runner",performed:true,tool:"run_tests",
  branch:args.branch,revision:sha,tested_commit_sha:sha,runner_profile:"poc-default",
  status:"pass",phases:[{phase:"backend_tests",status:"pass"}],
  project_tests:{status:"pass",phases:[{phase:"backend_tests",status:"pass"}]},
  researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}};
function keys(){
  const k=generateKeyPairSync("ed25519");
  return {privateKey:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:k.publicKey.export({type:"spki",format:"pem"}).toString()};
}
class ScriptedTestsModel extends BaseLlm{
  requests:LlmRequest[]=[];
  constructor(){super({model:"scripted-mcp-tests-no-provider"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
    this.requests.push(request);
    if(this.requests.length===1){
      yield {content:{role:"model",parts:[{
        functionCall:{id:"mcp-runner",name:"run_tests",args}
      }]}};
    }else yield {content:{role:"model",parts:[{text:"Done"}]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
    throw new Error("No paid model connection permitted");
  }
}
function close(server:{close:(cb:(error?:Error)=>void)=>unknown}){
  return new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
}
test("native ADK Test Agent calls run_tests via shared MCP and verifies Runner PASS",async()=>{
  const b=keys(),f=keys(),t=keys();
  const seen:string[]=[];
  const tasks=new PrivateMcpTaskRegistry({role:"test",
    signingPrivateKeyPem:t.privateKey,signingPublicKeyPem:t.publicKey});
  tasks.begin("mcp-runner-task",{
    invoke:async(tool,payload)=>{
      seen.push(tool);assert.deepEqual(payload,args);
      return execution;
    }
  },undefined,{allowRunTests:true});
  const app=express();
  attachPrivateMcpWorker(app,tasks);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(res=>worker.once("listening",res));
  const workerUrl="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.publicKey,frontend:f.publicKey,test:t.publicKey},
    router:new TaskRouter({backend:{baseUrl:workerUrl},
      frontend:{baseUrl:workerUrl},test:{baseUrl:workerUrl}})
  });
  await new Promise<void>(res=>shared.listen(0,"127.0.0.1",res));
  const endpoint="http://127.0.0.1:"+(shared.address() as AddressInfo).port+"/mcp";
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try{
    let bypass=0;
    const model=new ScriptedTestsModel();
    const outcomes:unknown[]=[];
    built=createAdkSpecializedAgent({role:"test",model,
      gatewayClient:{invoke:async()=>{bypass++;throw new Error("legacy bypass");}} as never,
      mcpReadFile:{endpoint,bearerForRequest:()=>tasks.bearerFor("mcp-runner-task")},
      mcpRunTests:true,
      onToolOutcome:event=>outcomes.push(event)
    });
    const sessions=new InMemorySessionService();
    const runner=new Runner({appName:"native_mcp_run_tests",agent:built.agent,
      sessionService:sessions});
    await sessions.createSession({appName:"native_mcp_run_tests",userId:"offline",
      sessionId:"mcp-runner-task"});
    for await(const _event of runner.runAsync({
      userId:"offline",sessionId:"mcp-runner-task",
      newMessage:{role:"user",parts:[{text:"Run controlled tests"}]}
    })){}
    assert.equal(model.requests.length,2);
    assert.deepEqual(seen,["run_tests"]);
    assert.equal(bypass,0);
    assert.deepEqual(outcomes,[{name:"run_tests",arguments:args,
      payload:{ok:true,result:execution}}]);
    const declared=(model.requests[0]?.config?.tools??[])
      .flatMap(t=>t.functionDeclarations??[]).map(t=>t.name);
    assert.deepEqual(declared.filter(n=>n==="run_tests"),["run_tests"]);
    assert.ok(declared.includes("create_file"),"Create remains legacy unless separately opted in");
    const modelContext=JSON.stringify(model.requests);
    assert.equal(modelContext.includes(t.privateKey),false);
    assert.equal(modelContext.includes(tasks.bearerFor("mcp-runner-task")),false);
  }finally{
    await built?.mcpToolset?.close();
    tasks.end("mcp-runner-task");
    await close(shared);
    await close(worker);
  }
});

/** A repeat tool call after an out-of-scope repair cannot execute Docker again.
 * The signed Test task must end and receive a NEW Engineer approval. */
test("ADK cannot replay Docker run_tests after fresh-review referral",async()=>{
  class RetryModel extends BaseLlm{
    requests:LlmRequest[]=[];
    constructor(){super({model:"scripted-offline-referral"});}
    override async *generateContentAsync(r:LlmRequest):AsyncGenerator<LlmResponse,void>{
      this.requests.push(r);
      if(this.requests.length<=2){
        yield {content:{role:"model",parts:[{
          functionCall:{id:"retry-"+this.requests.length,name:"run_tests",args}
        }]}};
      }else yield {content:{role:"model",parts:[{text:"done"}]}};
    }
    override connect(_r:LlmRequest):Promise<BaseLlmConnection>{
      throw Error("No paid models in offline test");
    }
  }
  const b=keys(),f=keys(),t=keys();
  const registry=new PrivateMcpTaskRegistry({role:"test",
    signingPrivateKeyPem:t.privateKey,signingPublicKeyPem:t.publicKey});
  const secret="DO_NOT_EXPOSE_RUNNER_PRIVATE_SOURCE";
  let dockerInvocations=0;
  registry.begin("repair-referral-task",{
    invoke:async(tool,payload)=>{
      assert.equal(tool,"run_tests");
      assert.deepEqual(payload,args);
      dockerInvocations++;
      throw new ControlledToolError("tests_failed","private Runner failure",{
        details:{first_failed_phase:"typecheck",
          repair_requires_new_approval:true,private_source:secret}
      });
    }
  },undefined,{allowRunTests:true});
  const app=express();
  attachPrivateMcpWorker(app,registry);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(res=>worker.once("listening",res));
  const url="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const shared=createSharedMcpHttpServer({
    verificationKeys:{backend:b.publicKey,frontend:f.publicKey,test:t.publicKey},
    router:new TaskRouter({backend:{baseUrl:url},frontend:{baseUrl:url},test:{baseUrl:url}})
  });
  await new Promise<void>(res=>shared.listen(0,"127.0.0.1",res));
  const endpoint="http://127.0.0.1:"+(shared.address() as AddressInfo).port+"/mcp";
  let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
  try{
    const model=new RetryModel();
    const outcomes:unknown[]=[];
    built=createAdkSpecializedAgent({role:"test",model,
      gatewayClient:{invoke:async()=>{throw Error("legacy Runner bypass");}} as never,
      mcpReadFile:{endpoint,bearerForRequest:()=>registry.bearerFor("repair-referral-task")},
      mcpRunTests:true,
      onToolOutcome:x=>outcomes.push(x)
    });
    const sessions=new InMemorySessionService();
    const runner=new Runner({appName:"safe_referral_replay",agent:built.agent,
      sessionService:sessions});
    await sessions.createSession({appName:"safe_referral_replay",
      userId:"offline",sessionId:"repair-referral-task"});
    for await(const _ of runner.runAsync({
      userId:"offline",sessionId:"repair-referral-task",
      newMessage:{role:"user",parts:[{text:"Run controlled tests"}]}
    })){}
    assert.equal(model.requests.length,3);
    assert.equal(dockerInvocations,1,
      "Second model request must NOT invoke the approved Docker Runner again");
    assert.equal(outcomes.length,2);
    for(const o of outcomes){
      const event=o as {payload:{ok:boolean;error?:{
        kind:string;details?:{repair_requires_new_approval?:boolean}
      }}};
      assert.equal(event.payload.ok,false);
      assert.equal(event.payload.error?.kind,"tests_failed");
      assert.equal(event.payload.error?.details?.repair_requires_new_approval,true);
    }
    assert.ok(!JSON.stringify(outcomes).includes(secret));
    assert.ok(!JSON.stringify(model.requests).includes(secret));
  }finally{
    await built?.mcpToolset?.close();
    registry.end("repair-referral-task");
    await close(shared);
    await close(worker);
  }
});


test("R118 a recoverable Docker FAIL is not an ADK Task PASS and permits a subsequent approved Runner attempt",async()=>{
 class RetryAfterFail extends BaseLlm{
  requests:LlmRequest[]=[];
  constructor(){super({model:"offline-recoverable-runner-failure"});}
  override async *generateContentAsync(request:LlmRequest):AsyncGenerator<LlmResponse,void>{
   this.requests.push(request);
   if(this.requests.length<=2)
    yield {content:{role:"model",parts:[{
     functionCall:{id:"run-after-failure-"+this.requests.length,
      name:"run_tests",args}
    }]}};
   else yield {content:{role:"model",parts:[{text:"Script finished; only verified PASS counts"}]}};
  }
  override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
   throw Error("Offline-only test must not call a model provider");
  }
 }
 const k=keys(),f=keys(),t=keys();
 let attempts=0;
 const privateRegistry=new PrivateMcpTaskRegistry({
  role:"test",signingPrivateKeyPem:t.privateKey,
  signingPublicKeyPem:t.publicKey
 });
 privateRegistry.begin("recoverable-fail-test-task",{
  invoke:async(tool,payload)=>{
   assert.equal(tool,"run_tests");assert.deepEqual(payload,args);
   attempts++;
   if(attempts===1)
    throw new ControlledToolError("tests_failed","intentional offline regression",{
     details:{first_failed_phase:"backend_tests",
      failing_test_files:["tests/backend/user.service.test.ts"]}
    });
   return execution;
  }
 },undefined,{allowRunTests:true,
  allowedPaths:["tests/backend/user.service.test.ts"],
  allowedFilePermissions:[{path:"tests/backend/user.service.test.ts",
   operation:"read_file"},{path:"tests/backend/user.service.test.ts",
   operation:"update_file"}],approvedBranch:args.branch});
 const app=express();attachPrivateMcpWorker(app,privateRegistry);
 const worker=app.listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>worker.once("listening",resolve));
 const url="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
 const shared=createSharedMcpHttpServer({
  verificationKeys:{backend:k.publicKey,frontend:f.publicKey,test:t.publicKey},
  router:new TaskRouter({backend:{baseUrl:url},frontend:{baseUrl:url},
   test:{baseUrl:url}})
 });
 await new Promise<void>(resolve=>shared.listen(0,"127.0.0.1",resolve));
 let built:ReturnType<typeof createAdkSpecializedAgent>|undefined;
 try{
  const model=new RetryAfterFail(),events:unknown[]=[];
  built=createAdkSpecializedAgent({
   role:"test",model,gatewayClient:{
    invoke:async()=>{throw Error("Legacy direct Gateway must not be used");}
   } as never,
   mcpReadFile:{endpoint:"http://127.0.0.1:"+
    (shared.address() as AddressInfo).port+"/mcp",
    bearerForRequest:()=>privateRegistry.bearerFor("recoverable-fail-test-task")},
   mcpRunTests:true,trustedRunTestsAllowed:true,
   trustedBranch:args.branch,
   trustedFilePermissions:[{
    path:"tests/backend/user.service.test.ts",operation:"read_file"
   },{
    path:"tests/backend/user.service.test.ts",operation:"update_file"
   }],
   onToolOutcome:e=>events.push(e)
  });
  const sessions=new InMemorySessionService();
  const runner=new Runner({appName:"r118_recoverable_failure",
   agent:built.agent,sessionService:sessions});
  await sessions.createSession({appName:"r118_recoverable_failure",
   userId:"offline",sessionId:"recoverable-fail-test-task"});
  for await(const _ of runner.runAsync({
   userId:"offline",sessionId:"recoverable-fail-test-task",
   newMessage:{role:"user",parts:[{text:"Run approved tests twice in this offline fixture"}]}
  })){}
  assert.equal(model.requests.length,3,
   "ADK must receive feedback after recoverable first Docker FAIL");
  assert.equal(attempts,2,"Only two approved actual runner calls");
  const outcomes=events as Array<{payload:{ok:boolean;error?:{
   kind:string;details?:{repair_requires_new_approval?:boolean}
  }}}>;
  assert.equal(outcomes.length,2);
  assert.equal(outcomes[0].payload.ok,false);
  assert.equal(outcomes[0].payload.error?.kind,"tests_failed");
  assert.notEqual(outcomes[0].payload.error?.details?.repair_requires_new_approval,true);
  assert.equal(outcomes[1].payload.ok,true);
 }finally{
  await built?.mcpToolset?.close();
  privateRegistry.end("recoverable-fail-test-task");
  await close(shared);await close(worker);
 }
});
