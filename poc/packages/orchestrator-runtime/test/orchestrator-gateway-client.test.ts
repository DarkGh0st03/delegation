import assert from "node:assert/strict";
import test from "node:test";
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
