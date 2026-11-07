import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import type {AddressInfo} from "node:net";
import {startSpecializedAgentServer} from "../src/server.ts";
import type {AdkA2ATaskHandlerConfig} from "../src/adk-a2a-handler.ts";
import type {BaseLlm} from "@google/adk";

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


test("R381.6 private native MCP signer cannot start outside owner-authorized ADK Task registry",async()=>{
 const prior=process.env.DELEGATION_GATEWAY_ARCHITECTURE;
 const base={
  role:"backend" as const,port:0,
  adk:{
   model:{model:"no-inference"} as BaseLlm,
   gatewayBaseUrl:"http://127.0.0.1:1",
   adapterToken:"PRIVATE_BACKEND",
   nativePresentationTransport:"mcp-stdio" as const
  }
 };
 try{
  delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  await assert.rejects(startSpecializedAgentServer(base),
   /private_native_mcp_requires_owner_bound_task/u);
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="legacy-signed-dag";
  await assert.rejects(startSpecializedAgentServer(base),
   /private_native_mcp_requires_owner_bound_task/u);
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
  await assert.rejects(startSpecializedAgentServer(base),
   /private_native_mcp_requires_owner_bound_task/u);
 }finally{
  if(prior===undefined)delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  else process.env.DELEGATION_GATEWAY_ARCHITECTURE=prior;
 }
});

test("R381.6 direct ADK handler cannot bypass original authority-only registries",async()=>{
 const {createAdkA2ATaskHandler}=await import("../src/adk-a2a-handler.ts");
 const prior=process.env.DELEGATION_GATEWAY_ARCHITECTURE;
 try{
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
  assert.throws(()=>createAdkA2ATaskHandler({
   model:{model:"no-inference"} as BaseLlm,
   gatewayBaseUrl:"http://127.0.0.1:1",
   adapterToken:"PRIVATE_BACKEND",
   nativePresentationTransport:"mcp-stdio"
  }),/private_native_mcp_requires_owner_bound_task/u);
 }finally{
  if(prior===undefined)delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  else process.env.DELEGATION_GATEWAY_ARCHITECTURE=prior;
 }
});
