import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {createSharedMcpHttpServer} from "../src/http-server.ts";
import {TaskRouter} from "../src/task-router.ts";
import {issueTaskToken} from "../src/task-token.ts";
import {PrivateMcpTaskRegistry,PrivateMcpTaskError} from
  "../../packages/agent-runtime/src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from
  "../../packages/agent-runtime/src/private-mcp-worker-http.ts";
import {parseCreatePresentationArgs} from "../src/crypto-catalog.ts";

function pair(){
  const kp=generateKeyPairSync("ed25519");
  return {
    privateKey:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:kp.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
async function listen(server:{
  listen:(port:number,host:string,cb:()=>void)=>unknown;
  address:()=>unknown
}):Promise<string>{
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  return "http://127.0.0.1:"+(server.address() as AddressInfo).port;
}
const close=(server:{close:(cb:(error?:Error)=>void)=>unknown})=>
  new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
async function client(url:string,bearer:string){
  const transport=new StreamableHTTPClientTransport(new URL(url+"/mcp"),{
    requestInit:{headers:{authorization:"Bearer "+bearer}}
  });
  const conn=new Client({name:"crypto-mcp-test",version:"0.1.0"},{capabilities:{}});
  await conn.connect(transport);
  return conn;
}
const prepared=(id="req-A")=>({
  request_id:id,audience:"cloud-access-gateway",
  challenge:"Gateway-issued-nonce",expires_at:new Date(Date.now()+90_000).toISOString(),
  required_permission:{
    resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/files/app.ts",
    operation:"read_file"
  }
});

test("crypto profile publishes only delegation_create_presentation, holds signed VP privately",async()=>{
  const backend=pair(),frontend=pair(),testing=pair();
  const calls:unknown[]=[];
  const reg=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:backend.privateKey,
    signingPublicKeyPem:backend.publicKey
  });
  reg.begin("task-A",{invoke:async()=>{throw Error("Gateway execution unavailable in crypto profile");}},
    undefined,{evidenceHandler:{
      credentialId:"urn:delegation:task-A",
      presenterId:"did:thesis:backend",
      async createPresentation(p){
        calls.push(p);
        return "signed.jwt.privately-held";
      }
    }});
  reg.stageGatewayChallenge("task-A",prepared());

  const app=express();
  attachPrivateMcpWorker(app,reg);
  const worker=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>worker.once("listening",r));
  const endpoint="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  const router=new TaskRouter({
    backend:{baseUrl:endpoint},frontend:{baseUrl:endpoint},test:{baseUrl:endpoint}
  });
  const shared=createSharedMcpHttpServer({
    profile:"crypto",
    verificationKeys:{
      backend:backend.publicKey,frontend:frontend.publicKey,test:testing.publicKey
    },
    router
  });
  const base=await listen(shared);
  const connections:Client[]=[];
  try{
    const health=await (await fetch(base+"/health")).json();
    assert.equal(health.tool_count,1);
    assert.equal(health.profile,"crypto");

    const c=await client(base,reg.bearerFor("task-A"));
    connections.push(c);
    const listed=await c.listTools();
    assert.deepEqual(listed.tools.map(t=>t.name),["delegation_create_presentation"]);
    const response=await c.callTool({
      name:"delegation_create_presentation",arguments:{request_id:"req-A"}
    });
    assert.notEqual(response.isError,true);
    const result=response.structuredContent as {
      ok:boolean;result:{request_id:string;proof_ref:string;prepared:boolean}
    };
    assert.equal(result.ok,true);
    assert.equal(result.result.prepared,true);
    assert.equal(result.result.request_id,"req-A");
    assert.match(result.result.proof_ref,/^proof_[0-9a-f-]{36}$/u);
    // Never let a signed VP or Adapter caller secret flow into MCP.
    assert.doesNotMatch(JSON.stringify(response),/signed\.jwt|PRIVATE KEY|Gateway-issued-nonce/u);
    assert.deepEqual(calls,[prepared()].map(p=>({
      ...p,expires_at:(calls[0] as {expires_at:string}).expires_at
    })));
    assert.equal(reg.takeSignedPresentation("task-A",result.result.proof_ref),
      "signed.jwt.privately-held");
    assert.throws(
      ()=>reg.takeSignedPresentation("task-A",result.result.proof_ref),
      (e:unknown)=>e instanceof PrivateMcpTaskError && e.kind==="invalid_tool_call"
    );
    const replay=await c.callTool({
      name:"delegation_create_presentation",arguments:{request_id:"req-A"}
    });
    assert.equal(replay.isError,true);
    assert.equal(calls.length,1);

    const unprepared=await c.callTool({
      name:"delegation_create_presentation",arguments:{request_id:"req-other"}
    });
    assert.equal(unprepared.isError,true);
    assert.equal(calls.length,1);

    const wrongTask=await client(base,issueTaskToken(backend.privateKey,"backend","task-B"));
    connections.push(wrongTask);
    const forged=await wrongTask.callTool({
      name:"delegation_create_presentation",arguments:{request_id:"req-A"}
    });
    assert.equal(forged.isError,true);
    assert.equal(calls.length,1);

    const wrongRole=await client(base,issueTaskToken(frontend.privateKey,"frontend","task-A"));
    connections.push(wrongRole);
    const crossRole=await wrongRole.callTool({
      name:"delegation_create_presentation",arguments:{request_id:"req-A"}
    });
    assert.equal(crossRole.isError,true);

    reg.end("task-A");
    const ended=await c.callTool({
      name:"delegation_create_presentation",arguments:{request_id:"req-A"}
    });
    assert.equal(ended.isError,true);
  }finally{
    for(const c of connections)await c.close();
    await close(shared);
    await close(worker);
  }
});

test("strict tool shape prevents selecting proof authority from model arguments",()=>{
  assert.deepEqual(parseCreatePresentationArgs({request_id:"req_123"}),{
    request_id:"req_123"
  });
  for(const item of [
    {},{request_id:""},{request_id:"  req"},{request_id:"../req"},
    {request_id:"req",challenge:"forged"},
    {request_id:"req",signed_vp:"fake"},
    {request_id:"req",credential_id:"attacker"},
    {request_id:"req",required_permission:{}},null,[1]
  ])assert.throws(()=>parseCreatePresentationArgs(item),/invalid_tool_arguments/);
});

test("crypto registry rejects unstaged, expired, duplicated or foreign challenges",()=>{
  const k=pair(),reg=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:k.privateKey,signingPublicKeyPem:k.publicKey
  });
  reg.begin("task-1",{invoke:async()=>({})},undefined,{
    evidenceHandler:{
      credentialId:"one",presenterId:"did:thesis:backend",
      async createPresentation(){return "signed";}
    }
  });
  assert.throws(()=>reg.stageGatewayChallenge("wrong",prepared()),/inactive_task/);
  const expired={...prepared(),expires_at:new Date(Date.now()-1000).toISOString()};
  assert.throws(()=>reg.stageGatewayChallenge("task-1",expired),/invalid_tool_call/);
  const invalid={...prepared(),audience:"attacker-service"};
  assert.throws(()=>reg.stageGatewayChallenge("task-1",invalid),/invalid_tool_call/);
  reg.stageGatewayChallenge("task-1",prepared());
  assert.throws(()=>reg.stageGatewayChallenge("task-1",prepared()),/invalid_tool_call/);
  reg.end("task-1");
  assert.throws(()=>reg.takeSignedPresentation("task-1","proof-nonexistent"),/inactive_task/);
});

test("crypto bearer and task lifecycle prevent calls after cancellation",async()=>{
  const k=pair(),abort=new AbortController();
  const reg=new PrivateMcpTaskRegistry({
    role:"backend",signingPrivateKeyPem:k.privateKey,
    signingPublicKeyPem:k.publicKey
  });
  let finish!:(x:string)=>void;
  const waiting=new Promise<string>(resolve=>{finish=resolve;});
  reg.begin("task-1",{invoke:async()=>({})},abort.signal,{
    evidenceHandler:{
      credentialId:"one",presenterId:"did:thesis:backend",
      async createPresentation(){return waiting;}
    }
  });
  reg.stageGatewayChallenge("task-1",prepared());
  const token=reg.bearerFor("task-1");
  const pending=reg.invokeCrypto("Bearer "+token,{
    tool:"delegation_create_presentation",arguments:{request_id:"req-A"}
  });
  abort.abort();
  finish("signed.jwt.rejected");
  await assert.rejects(pending,/inactive_task/);
});
