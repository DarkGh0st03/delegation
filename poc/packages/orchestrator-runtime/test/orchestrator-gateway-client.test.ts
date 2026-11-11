import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {OrchestratorGatewayTransport}
 from "../src/orchestrator-gateway-transport.ts";
import * as canonicalApi from "../src/index.ts";
import {OrchestratorPlanningGatewayReadClient}
 from "../src/orchestrator-gateway-client.ts";

test("R173 canonical Orchestrator excludes fixed Account Suspension branch/PR writer",()=>{
 const planning=OrchestratorPlanningGatewayReadClient.prototype;
 assert.equal(typeof canonicalApi.OrchestratorPlanningGatewayReadClient,"function");
 assert.equal(Object.hasOwn(planning,"readPlanningResource"),true);
 assert.equal(Object.hasOwn(planning,"createFeatureBranch"),false);
 assert.equal(Object.hasOwn(planning,"createAccountSuspensionPullRequest"),false);
 assert.equal(Object.hasOwn(canonicalApi,"OrchestratorProtectedGatewayClient"),false);
});

test("R5 session cancellation between prepare and VP prevents Adapter and execute",async()=>{
  const controller=new AbortController();
  const calls:string[]=[];
  const fetchFn:typeof fetch=async(url,init)=>{
    calls.push(String(url));
    assert.equal(init?.signal?.aborted,false);
    // A simulated slow/uncooperative Gateway can still return a response
    // after the controller cancels. No VP may be signed afterward.
    controller.abort();
    return new Response(JSON.stringify({
      request_id:"once",audience:"gateway",challenge:"nonce",
      required_permission:{operation:"read_repository",
        resource:"gitea://gitea.local/thesis/invoices"}
    }),{status:201});
  };
  const client=new OrchestratorPlanningGatewayReadClient({
    gatewayBaseUrl:"http://gateway",adapterBaseUrl:"http://adapter",
    adapterToken:"private",rootCredentialId:"planning-root",fetchFn
  });
  await assert.rejects(()=>client.readPlanningResource(
    "planning-session","read_repository",{},
    {authority:"gitea.local",owner:"thesis",repository:"invoices"},
    controller.signal
  ),/cancelled/);
  assert.equal(calls.length,1);
  assert.ok(calls[0].endsWith("/prepare"));
});

test("R5 pre-cancelled Planning call cannot contact Gateway",async()=>{
  let calls=0;
  const controller=new AbortController();controller.abort();
  const client=new OrchestratorPlanningGatewayReadClient({
    gatewayBaseUrl:"http://gateway",adapterBaseUrl:"http://adapter",
    adapterToken:"private",rootCredentialId:"planning-root",
    fetchFn:async()=>{calls++;throw Error("must not run");}
  });
  await assert.rejects(()=>client.readPlanningResource(
    "planning-session","read_repository",{},
    {authority:"gitea.local",owner:"thesis",repository:"invoices"},
    controller.signal
  ),/cancelled/);
  assert.equal(calls,0);
});

async function nativeIssuerFixture(t:import("node:test").TestContext,
 onRequest:(request:Record<string,unknown>)=>unknown){
 const directory=mkdtempSync(join(tmpdir(),"delegation-r218-native-"));
 const socketPath=join(directory,"issuer.sock");
 const calls:Record<string,unknown>[]=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  let input="";
  socket.on("data",chunk=>input+=chunk.toString("utf8"));
  socket.on("end",()=>{
   try{
    const request=JSON.parse(input) as Record<string,unknown>;
    calls.push(request);
    socket.end(JSON.stringify(onRequest(request)));
   }catch{socket.destroy();}
  });
 });
 await new Promise<void>((resolve,reject)=>{
  server.once("error",reject);
  server.listen(socketPath,resolve);
 });
 t.after(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  rmSync(directory,{recursive:true,force:true});
 });
 return {socketPath,calls};
}

test("R218 Orchestrator Gateway uses native Rust VP and never downgrades on native denial",async t=>{
 let denied=false;
 const native=await nativeIssuerFixture(t,()=>denied
  ?{ok:false,error:"PRIVATE_RUST_SIGNER_KEY"}
  :{ok:true,result:{signed_vp:"native.signed.vp"}});
 const oldSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const oldFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=native.socketPath;
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 let prepareCalls=0,executeCalls=0,adapterCalls=0;
 try{
  const fetchFn:typeof fetch=async(url,init)=>{
   const target=String(url);
   if(target==="http://trusted-gateway.invalid/v1/authorization/prepare"){
    prepareCalls++;
    return new Response(JSON.stringify({
     request_id:"gateway-challenge-1",audience:"cloud-access-gateway",
     challenge:"gateway-nonce",
     required_permission:{resource:"gitea://gitea.local/thesis/invoices",
      operation:"read_repository"}
    }),{status:201});
   }
   if(target==="http://trusted-gateway.invalid/v1/authorization/execute"){
    executeCalls++;
    assert.equal(JSON.parse(String(init?.body)).signed_vp,"native.signed.vp");
    return new Response(JSON.stringify({execution:{provider:"gitea",performed:true}}));
   }
   adapterCalls++;
   throw Error("Legacy Adapter HTTP must not be contacted");
  };
  const client=new OrchestratorGatewayTransport({
   gatewayBaseUrl:"http://trusted-gateway.invalid",
   adapterToken:"PRIVATE_ORCHESTRATOR_BEARER",
   rootCredentialId:"urn:root:orchestrator",
   fetchFn
  });
  const first=await client.invoke("planning-1","read_repository",{});
  assert.deepEqual(first,{provider:"gitea",performed:true});
  assert.deepEqual(native.calls[0],{
   token:"PRIVATE_ORCHESTRATOR_BEARER",operation:"create_presentation",
   body:{credential_id:"urn:root:orchestrator",
    disclosed_permissions:[{resource:"gitea://gitea.local/thesis/invoices",
      operation:"read_repository"}],
    audience:"cloud-access-gateway",challenge:"gateway-nonce"}
  });
  denied=true;
  await assert.rejects(()=>client.invoke("planning-1","read_repository",{}),
   error=>{
    assert.match(String(error),/Native Rust Orchestrator presentation denied/u);
    assert.doesNotMatch(String(error),/PRIVATE_RUST_SIGNER_KEY/u);
    return true;
   });
  assert.equal(prepareCalls,2);
  assert.equal(executeCalls,1);
  assert.equal(native.calls.length,2);
  assert.equal(adapterCalls,0);
 }finally{
  if(oldSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=oldSocket;
  if(oldFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=oldFlag;
 }
});

test("R218 canonical Orchestrator refuses a missing native socket before Gateway prepare",()=>{
 const oldSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const oldFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  assert.throws(()=>new OrchestratorGatewayTransport({
   gatewayBaseUrl:"http://trusted-gateway.invalid",
   adapterToken:"PRIVATE_ORCHESTRATOR_BEARER",
   rootCredentialId:"urn:root:orchestrator",
   fetchFn:async()=>{throw Error("Forbidden Gateway request");}
  }),/Canonical signed DAG requires native Rust Orchestrator signer socket/u);
 }finally{
  if(oldSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=oldSocket;
  if(oldFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=oldFlag;
 }
});

test("R240 historical Orchestrator HTTP signer requires explicit Adapter URL when native socket absent",()=>{
 const priorSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const priorFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 try{
  delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  assert.throws(()=>new OrchestratorGatewayTransport({
   gatewayBaseUrl:"http://trusted-gateway.invalid",
   adapterToken:"PRIVATE_ORCHESTRATOR_BEARER",
   rootCredentialId:"urn:r240:root"
  }),/Historical Orchestrator HTTP signing requires explicit Adapter URL/u);
 }finally{
  if(priorSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=priorSocket;
  if(priorFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=priorFlag;
 }
});
