import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import express from "express";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {attachPrivateMcpWorker} from "../src/private-mcp-worker-http.ts";
import {startSpecializedAgentServer} from "../src/server.ts";
import type {AdkA2ATaskHandlerConfig} from "../src/adk-a2a-handler.ts";
import type {BaseLlm} from "@google/adk";

test("R189 signed Task worker has no repository route even with a valid bearer",async()=>{
 const kp=generateKeyPairSync("ed25519");
 const privateKey=kp.privateKey.export({format:"pem",type:"pkcs8"}).toString();
 const publicKey=kp.publicKey.export({format:"pem",type:"spki"}).toString();
 const registry=new PrivateMcpTaskRegistry({
  role:"backend",signingPrivateKeyPem:privateKey,signingPublicKeyPem:publicKey
 });
 let gatewayCalls=0;
 registry.begin("signed-task",
  {invoke:async()=>{gatewayCalls++;return {ok:true};}});
 const app=express();
 attachPrivateMcpWorker(app,registry);
 const http=app.listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>http.once("listening",resolve));
 const url="http://127.0.0.1:"+(http.address() as AddressInfo).port;
 try{
  const denied=await fetch(url+"/internal/mcp-tool-call",{
   method:"POST",headers:{
    authorization:"Bearer "+registry.bearerFor("signed-task"),
    "content-type":"application/json"
   },
   body:JSON.stringify({tool:"read_file",
    arguments:{branch:"feature/signed",path:"src/private.ts"}})
  });
  assert.equal(denied.status,404,
    "No repository MCP worker endpoint may survive R189");
  assert.equal(gatewayCalls,0);
  const crypto=await fetch(url+"/internal/mcp-crypto-call",{
   method:"POST",headers:{
    authorization:"Bearer forged",
    "content-type":"application/json"
   },
   body:JSON.stringify({tool:"delegation_create_presentation",
    arguments:{request_id:"req-1"}})
  });
  assert.equal(crypto.status,401);
  const payload=await crypto.json() as {error?:{kind?:string}};
  assert.equal(payload.error?.kind,"unauthorized");
  assert.equal(gatewayCalls,0);
 }finally{
  registry.end("signed-task");
  await new Promise<void>((resolve,reject)=>
   http.close(error=>error?reject(error):resolve()));
 }
});

test("R222 canonical A2A server rejects a remote crypto HTTP worker before listening",async()=>{
 const stale={mcpCryptoUrl:"http://127.0.0.1:8097/mcp"};
 await assert.rejects(()=>startSpecializedAgentServer({
  role:"backend",port:38177,
  adk:stale as unknown as AdkA2ATaskHandlerConfig
 }),/legacy_crypto_http_mcp_retired/u);
});

test("R223 running canonical A2A server exposes no private MCP HTTP worker route",async()=>{
 const previousFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 const previousSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const keys=generateKeyPairSync("ed25519");
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 // The test checks only startup and HTTP route exposure, not VP signing.
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="/tmp/r223-not-mounted.sock";
 let active:Awaited<ReturnType<typeof startSpecializedAgentServer>>|undefined;
 try{
  active=await startSpecializedAgentServer({
   role:"backend",port:0,host:"127.0.0.1",
   mcpTaskSigning:{
    signingPrivateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    signingPublicKeyPem:keys.publicKey.export({format:"pem",type:"spki"}).toString()
   },
   adk:{
    model:{model:"r223-no-model-inference"} as BaseLlm,
    gatewayBaseUrl:"http://127.0.0.1:1",
    adapterBaseUrl:"http://127.0.0.1:2",
    adapterToken:"R223_PRIVATE_TEST_ONLY",
    fetchFn:async()=>{throw Error("No network calls in R223 A2A route test");}
   }
  });
  const address=active.server.address() as AddressInfo;
  assert.ok(address.port>0);
  const url="http://127.0.0.1:"+address.port;
  const payload={tool:"delegation_create_presentation",arguments:{request_id:"denied"}};
  for(const route of ["/internal/mcp-crypto-call","/internal/mcp-tool-call"]){
   const response=await fetch(url+route,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(payload)
   });
   assert.equal(response.status,404,route+" must never be mounted");
  }
 }finally{
  await active?.close();
  if(previousFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=previousFlag;
  if(previousSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=previousSocket;
 }
});
