import assert from "node:assert/strict";
import test from "node:test";
import {request as rawRequest} from "node:http";
import { createGatewayHttpServer } from "../src/http.ts";
import { InMemoryAuditSink } from "../src/prepare.ts";
import { GatewayRuntime } from "../src/runtime.ts";
import type {
  PolicyInput,
  PolicyPort,
  VerificationRequest,
  VerifierPort
} from "../src/types.ts";

const config = {
  bind_host: "127.0.0.1",
  bind_port: 0,
  prepare: {
    audience: "cloud-access-gateway",
    request_ttl_ms: 120_000,
    repository: {
      authority: "gitea.local",
      owner: "thesis",
      repository: "iam-console-poc"
    }
  },
  adapter_url: "http://unused",
  adapter_gateway_token: "unused",
  opa_url: "http://unused",
  opa_timeout_ms: 2_000,
  provider_mode: "mock" as const,
  gitea_timeout_ms: 3_000
};

class Verifier implements VerifierPort {
  async verify(request: VerificationRequest) {
    return {
      presenter_id: "did:thesis:backend-agent",
      credential_id: "urn:credential:backend",
      issuer_id: "did:thesis:orchestrator",
      permissions: [request.required_permission],
      hierarchy_depth: 1,
      expiration: "999999999999999999999"
    };
  }
}

class Policy implements PolicyPort {
  async evaluate(_input: PolicyInput) {
    return { allow: true, policy_version: "phase4a-v1" };
  }
}

test("HTTP prepare and execute expose verified and policy-allowed mock execution", async () => {
  const runtime = new GatewayRuntime(config, {
    verifier: new Verifier(),
    policy: new Policy(),
    audit: new InMemoryAuditSink()
  });
  const server = createGatewayHttpServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/health`);
    const healthBody = await health.json();
    assert.equal(healthBody.policy, "opa");

    const prepareResponse = await fetch(`${base}/v1/authorization/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: "task-1",
        agent_role: "backend",
        tool: "read_file",
        arguments: {
          branch: "feature/account-suspension",
          path: "apps/backend/src/users/user.service.ts"
        }
      })
    });
    assert.equal(prepareResponse.status, 201);
    const prepared = await prepareResponse.json();

    const executeResponse = await fetch(`${base}/v1/authorization/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: prepared.request_id,
        signed_vp: "signed.jwt.value"
      })
    });
    assert.equal(executeResponse.status, 200);
    const executed = await executeResponse.json();
    assert.equal(executed.decision, "allow");
    assert.equal(executed.policy.policy_version, "phase4a-v1");
    assert.equal(executed.execution.provider, "mock");
    assert.equal(executed.execution.performed, false);

    const replay = await fetch(`${base}/v1/authorization/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: prepared.request_id,
        signed_vp: "signed.jwt.value"
      })
    });
    assert.equal(replay.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});


test("AUD-010: Gateway disconnect reaches an authorized Runner execution",async()=>{
  let onStarted!:()=>void,onCanceled!:()=>void;
  const started=new Promise<void>(resolve=>{onStarted=resolve;});
  const canceled=new Promise<void>(resolve=>{onCanceled=resolve;});
  let calls=0;
  const executor={
    provider:"gitea" as const,
    providerFor:()=> "runner" as const,
    execute:async(_record:unknown,signal?:AbortSignal)=>{
      calls++;
      assert.ok(signal,"Gateway must supply its request cancellation signal");
      onStarted();
      await new Promise<void>((_resolve,reject)=>{
        if(signal.aborted){onCanceled();reject(new Error("aborted"));return;}
        signal.addEventListener("abort",()=>{
          onCanceled();
          reject(new Error("aborted"));
        },{once:true});
      });
      throw new Error("Cancelled Runner must never return PASS");
    }
  };
  const runtime=new GatewayRuntime(config,{
    verifier:new Verifier(),
    policy:new Policy(),
    executor,
    audit:new InMemoryAuditSink()
  });
  const server=createGatewayHttpServer(runtime);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address=server.address();
    assert.ok(address && typeof address==="object");
    const base="http://127.0.0.1:"+address.port;
    const prepared=await fetch(base+"/v1/authorization/prepare",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        task_id:"task-cancel-runner",agent_role:"test",tool:"run_tests",
        arguments:{branch:"feature/account-suspension",profile:"poc-default"}
      })
    });
    assert.equal(prepared.status,201);
    const body=await prepared.json();
    const requestBody=JSON.stringify({request_id:body.request_id,signed_vp:"signed.jwt.value"});
    const req=rawRequest(base+"/v1/authorization/execute",{
      method:"POST",headers:{"content-type":"application/json",
        "content-length":Buffer.byteLength(requestBody)}
    });
    req.on("error",()=>{});
    req.end(requestBody);
    await Promise.race([started,
      new Promise<never>((_r,reject)=>setTimeout(()=>reject(new Error("Gateway executor did not start")),3000))]);
    req.destroy();
    await Promise.race([canceled,
      new Promise<never>((_r,reject)=>setTimeout(()=>reject(new Error("Gateway did not cancel execution")),3000))]);
    assert.equal(calls,1);
  }finally{
    await new Promise<void>((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()));
  }
});
