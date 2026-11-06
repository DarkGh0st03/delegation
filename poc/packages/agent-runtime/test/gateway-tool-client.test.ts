import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlledToolError,
  DelegationEvidenceHandler,
  GatewayControlledToolClient
} from "../src/index.ts";

function evidenceHandler(): DelegationEvidenceHandler {
  return new DelegationEvidenceHandler({
    adapterBaseUrl: "http://adapter.local",
    adapterToken: "phase8a-adapter-test-token",
    evidence: {
      credential: "phase8a-child-credential-payload",
      credential_id: "urn:phase8a:backend",
      presenter_id: "did:thesis:backend-agent"
    },
    fetchFn: async () =>
      new Response(JSON.stringify({ signed_vp: "phase8a-signed-vp" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
}

test("Gateway wrapper hides prepare -> presentation -> execute from the model-visible result", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const gateway = new GatewayControlledToolClient({
    gatewayBaseUrl: "http://gateway.local",
    agentRole: "backend",
    taskId: "task-phase8a",
    evidenceHandler: evidenceHandler(),
    fetchFn: async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      requests.push({ url, body });

      if (url.endsWith("/prepare")) {
        return new Response(
          JSON.stringify({
            request_id: "req_phase8a",
            audience: "cloud-access-gateway",
            challenge: "phase8a-challenge",
            required_permission: {
              resource:
                "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
              operation: "read_file"
            },
            expires_at: "2026-10-05T18:00:00.000Z"
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          request_id: "req_phase8a",
          decision: "allow",
          verified_delegation: {
            credential_id: "urn:phase8a:backend"
          },
          execution: {
            provider: "gitea",
            performed: true,
            tool: "read_file",
            branch: "feature/account-suspension",
            path: "apps/backend/src/users/user.service.ts",
            content: "export class UserService {}"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await gateway.invoke("read_file", {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts"
  });

  assert.equal(requests.length, 2);
  assert.equal(
    (requests[1]?.body as { signed_vp?: string }).signed_vp,
    "phase8a-signed-vp"
  );
  assert.deepEqual(result, {
    provider: "gitea",
    performed: true,
    tool: "read_file",
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts",
    content: "export class UserService {}"
  });
  assert.equal(JSON.stringify(result).includes("verified_delegation"), false);
  assert.equal(JSON.stringify(result).includes("phase8a-signed-vp"), false);
});

test("Gateway wrapper converts Runner failure into a controlled tests_failed outcome", async () => {
  const gateway = new GatewayControlledToolClient({
    gatewayBaseUrl: "http://gateway.local",
    agentRole: "test",
    taskId: "task-phase8a-tests",
    evidenceHandler: evidenceHandler(),
    fetchFn: async (input) => {
      const url = String(input);
      if (url.endsWith("/prepare")) {
        return new Response(
          JSON.stringify({
            request_id: "req_tests",
            audience: "cloud-access-gateway",
            challenge: "challenge",
            required_permission: {
              resource:
                "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension",
              operation: "run_tests"
            },
            expires_at: "2026-10-05T18:00:00.000Z"
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          execution: {
            provider: "runner",
            performed: true,
            tool: "run_tests",
            status: "fail",
            tested_commit_sha: "a".repeat(40),
            phases: [
              {
                phase: "researcher_acceptance",
                status: "fail",
                errors: ["acceptance failed"]
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  await assert.rejects(
    () =>
      gateway.invoke("run_tests", {
        branch: "feature/account-suspension",
        profile: "poc-default"
      }),
    (error: unknown) =>
      error instanceof ControlledToolError &&
      error.kind === "tests_failed" &&
      typeof error.details === "object" &&
      JSON.stringify(error.details).includes("researcher_acceptance") &&
      !JSON.stringify(error.details).includes("acceptance failed")
  );
});

test("prepare diagnostics preserve rejection semantics and never execute",async()=>{
 for(const status of [400,403,500,0]){
  let calls=0;
  const client=new GatewayControlledToolClient({gatewayBaseUrl:"http://gateway.local",
   agentRole:"frontend",taskId:"diagnostic",evidenceHandler:evidenceHandler(),
   fetchFn:async()=>{calls++;if(!status)throw new Error("PRIVATE");
    return new Response(JSON.stringify({error:"PRIVATE"}),{status});}
  });
  await assert.rejects(client.invoke("read_file",{
   branch:"feature/account-suspension",path:"apps/frontend/src/Profile.tsx"
  }),(e:any)=>e.reason===(status>=500||status===0?"upstream_unavailable":"gateway_prepare_rejected"));
  assert.equal(calls,1);
 }
});

test("trusted prepare categories are allowlisted without changing denial semantics",async()=>{
 for(const reason of ["request_validation_rejected","task_binding_rejected","signed_permission_rejected",
  "dependency_rejected","task_inactive_or_expired","runtime_scope_rejected","source_witness_missing","PRIVATE"]){
  let calls=0;
  const client=new GatewayControlledToolClient({gatewayBaseUrl:"http://gateway.local",agentRole:"frontend",
   taskId:"diagnostic",evidenceHandler:evidenceHandler(),fetchFn:async()=>{calls++;
    return new Response(JSON.stringify({error:"trusted_operation_denied",prepare_reason:reason}),{status:403});}});
  await assert.rejects(client.invoke("read_file",{branch:"feature/account-suspension",path:"apps/frontend/src/Profile.tsx"}),
   (e:any)=>e.kind==="invalid_tool_call"&&e.reason===(reason==="PRIVATE"?"gateway_prepare_rejected":reason));
  assert.equal(calls,1);
 }
});

test("R281 run_tests Gateway execute denials retain only fixed native gate codes",async()=>{
  const known=["verification_rejected","policy_denied","approved_plan_denied"];
  const cases=[
    ...known.map(code=>({code,expected:code,status:403})),
    {code:"PRIVATE_PROVIDER_SECRET",expected:"gateway_execute_unclassified",status:403},
    {code:"policy_denied",expected:"upstream_unavailable",status:503},
    {code:"expired_request",expected:"expired_request",status:410}
  ];
  for(const {code,expected,status} of cases){
    let prepareCalls=0,executeCalls=0;
    const client=new GatewayControlledToolClient({
      gatewayBaseUrl:"http://gateway.local",agentRole:"test",
      taskId:"trusted-test-epoch-task",evidenceHandler:evidenceHandler(),
      fetchFn:async(input)=>{
        const url=String(input);
        if(url.endsWith("/prepare")){
          prepareCalls++;
          return new Response(JSON.stringify({
            request_id:"req_native_r281",audience:"cloud-access-gateway",
            challenge:"nonce",required_permission:{
              resource:"runner://local/poc-default",operation:"run_tests"},
            expires_at:"2026-11-06T00:00:00.000Z"
          }),{status:201});
        }
        assert.ok(url.endsWith("/execute"));
        executeCalls++;
        return new Response(JSON.stringify({error:code,message:"PRIVATE_PROVIDER_SECRET"}),
          {status});
      }
    });
    await assert.rejects(client.invoke("run_tests",{
      branch:"feature/account-suspension",profile:"poc-default"
    }),(error:unknown)=>{
      assert.ok(error instanceof ControlledToolError);
      assert.equal(error.kind,status>=500?"tool_unavailable":"authorization_denied");
      assert.equal(error.reason,expected);
      assert.equal(error.statusCode,status);
      assert.ok(!JSON.stringify({kind:error.kind,reason:error.reason})
        .includes("PRIVATE_PROVIDER_SECRET"));
      return true;
    });
    assert.equal(prepareCalls,1);
    assert.equal(executeCalls,1);
  }
});

test("R358 authenticated read-only Task stages before signed VP and Gateway execute",async()=>{
 const calls:string[]=[];
 const gateway=new GatewayControlledToolClient({
  gatewayBaseUrl:"http://gateway.local",agentRole:"backend",taskId:"owner-read-only",
  evidenceHandler:evidenceHandler(),
  trustedEffectStager:{stagedTool:"read_file",async stage(id){
   assert.equal(id,"read-r358");calls.push("stage");return {gateway_execution_authorized:false};
  }},
  fetchFn:async(input)=>{
   if(String(input).endsWith("/prepare")){
    calls.push("prepare");return new Response(JSON.stringify({
     request_id:"read-r358",audience:"gateway",challenge:"nonce",
     expires_at:"2026-11-06T21:00:00Z",required_permission:{
      resource:"gitea://local/repo/files/source.ts",operation:"read_file"
     }
    }),{status:201});
   }
   calls.push("execute");
   return new Response(JSON.stringify({request_id:"read-r358",decision:"allow",
    execution:{provider:"gitea",performed:true,tool:"read_file",content:"ok"}}),{status:200});
  }
 });
 await gateway.invoke("read_file",{branch:"feature/account-suspension",path:"source.ts"});
 assert.deepEqual(calls,["prepare","stage","execute"]);
});
