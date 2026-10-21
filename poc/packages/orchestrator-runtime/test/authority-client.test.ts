import assert from "node:assert/strict";
import test from "node:test";
import {
  DC_BACKEND,
  DC_TEST,
  ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY,
  DeterministicOrchestratorAuthorityIssuer,
  SoftwareEngineerAuthorityBootstrap,
  type IssuedDelegationCredential
} from "../src/index.ts";

function vc(id: string, sub: string, permissions: unknown[]): IssuedDelegationCredential {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["DelegationCredential"],
    id,
    issuer: "did:thesis:test",
    validFrom: "2026-10-05T00:00:00Z",
    credentialSubject: {
      sub,
      per: permissions as never[]
    }
  };
}

const status = {
  type: "BitstringStatusListEntry" as const,
  statusPurpose: "revocation" as const,
  statusListIndex: "900",
  statusListCredential: "https://status.example/lists/phase9a"
};

test("Engineer bootstrap always sends the exact frozen root authority to the Adapter", async () => {
  const bodies: unknown[] = [];
  const client = new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl: "http://adapter.local",
    bearerToken: "engineer-token",
    fetchFn: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(
        JSON.stringify(vc(body.credential_id, "did:thesis:orchestrator", body.permissions)),
        {
          status: 201,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const credential = await client.issueOrchestratorRoot({
    credential_id: "urn:phase9a:root",
    valid_from: "2026-10-05T00:00:00Z",
    validity_seconds: 3600,
    credential_status: status
  });

  assert.equal(credential.id, "urn:phase9a:root");
  assert.equal(bodies.length, 1);

  const body = bodies[0] as Record<string, unknown>;
  assert.equal(body.delegatee, "orchestrator");
  assert.deepEqual(body.permissions, ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY);
});

test("Orchestrator child issuance derives permissions only from role/skill template", async () => {
  const bodies: unknown[] = [];
  const client = new DeterministicOrchestratorAuthorityIssuer({
    adapterBaseUrl: "http://adapter.local",
    bearerToken: "orchestrator-token",
    fetchFn: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(
        JSON.stringify(
          vc(
            body.credential_id,
            `did:thesis:${body.delegatee}-agent`,
            body.permissions
          )
        ),
        {
          status: 201,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const backend = await client.issueSpecializedChild({
    parent_credential_id: "urn:phase9a:root",
    credential_id: "urn:phase9a:backend",
    valid_from: "2026-10-05T00:00:00Z",
    validity_seconds: 1800,
    credential_status: { ...status, statusListIndex: "901" },
    selection: { role: "backend" }
  });

  const testAgent = await client.issueSpecializedChild({
    parent_credential_id: "urn:phase9a:root",
    credential_id: "urn:phase9a:test",
    valid_from: "2026-10-05T00:00:00Z",
    validity_seconds: 1800,
    credential_status: { ...status, statusListIndex: "902" },
    selection: { skill: "test-account-lifecycle" }
  });

  assert.equal(backend.role, "backend");
  assert.equal(testAgent.role, "test");
  assert.deepEqual(
    (bodies[0] as { permissions: unknown }).permissions,
    DC_BACKEND
  );
  assert.deepEqual(
    (bodies[1] as { permissions: unknown }).permissions,
    DC_TEST
  );
});

test("arbitrary child permission injection is rejected before any Adapter call", async () => {
  let fetchCalls = 0;
  const client = new DeterministicOrchestratorAuthorityIssuer({
    adapterBaseUrl: "http://adapter.local",
    bearerToken: "orchestrator-token",
    fetchFn: async () => {
      fetchCalls += 1;
      throw new Error("must not be called");
    }
  });

  await assert.rejects(
    () =>
      client.issueSpecializedChild({
        parent_credential_id: "urn:phase9a:root",
        credential_id: "urn:phase9a:bad",
        valid_from: "2026-10-05T00:00:00Z",
        validity_seconds: 1800,
        credential_status: { ...status, statusListIndex: "903" },
        selection: {
          role: "backend",
          permissions: [
            {
              resource: "gitea://gitea.local/thesis/iam-console-poc",
              operation: "create_pull_request"
            }
          ]
        }
      }),
    /unsupported fields/u
  );

  assert.equal(fetchCalls, 0);
});


test("trusted scoped Engineer root sends only bounded read-only permissions to Rust Adapter",async()=>{
  const requests:{url:string;body:any;authorization?:string}[]=[];
  const client=new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl:"http://adapter.local/",
    bearerToken:"engineer-only-token",
    fetchFn:async(input,init)=>{
      const body=JSON.parse(String(init?.body));
      requests.push({
        url:String(input),body,
        authorization:new Headers(init?.headers).get("authorization")??undefined
      });
      return new Response(
        JSON.stringify(vc(body.credential_id,"did:thesis:orchestrator",body.permissions)),
        {status:201,headers:{"content-type":"application/json"}}
      );
    }
  });
  const permissions=[
    {resource:"gitea://gitea.local/thesis/iam-console-poc",operation:"read_repository" as const},
    {resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/directories",operation:"list_directory" as const},
    {resource:"gitea://gitea.local/thesis/iam-console-poc/branches/main/files/app.ts",operation:"read_file" as const}
  ];
  const issued=await client.issueScopedOrchestratorRoot({
    credential_id:"urn:root:preliminary",
    valid_from:"2026-10-21T09:00:00Z",validity_seconds:600,
    credential_status:{...status,statusListIndex:"9781"},
    permissions
  });
  assert.equal(issued.id,"urn:root:preliminary");
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"http://adapter.local/v1/credentials/root");
  assert.equal(requests[0].authorization,"Bearer engineer-only-token");
  assert.deepEqual(requests[0].body.permissions,permissions);
  assert.equal(requests[0].body.delegatee,"orchestrator");
});

test("trusted root issuance rejects Adapter permission expansion or loss",async()=>{
  for(const serverPermissions of [
    [{resource:"gitea://attacker.invalid/x",operation:"update_file"}],
    [],
    [{resource:"gitea://gitea.local/thesis/iam-console-poc",operation:"read_repository"},
     {resource:"gitea://gitea.local/thesis/iam-console-poc",operation:"create_branch"}]
  ]){
    const client=new SoftwareEngineerAuthorityBootstrap({
      adapterBaseUrl:"http://adapter.local",bearerToken:"engineer-only",
      fetchFn:async()=>new Response(
        JSON.stringify(vc("urn:root:staged","did:thesis:orchestrator",serverPermissions)),
        {status:201,headers:{"content-type":"application/json"}}
      )
    });
    await assert.rejects(()=>client.issueScopedOrchestratorRoot({
      credential_id:"urn:root:staged",
      valid_from:"2026-10-21T09:00:00Z",validity_seconds:600,
      credential_status:status,
      permissions:[{resource:"gitea://gitea.local/thesis/iam-console-poc",operation:"read_repository"}]
    }),/response differs/);
  }
});

test("Engineer-only revocation requires exact terminal status receipt",async()=>{
  const calls:unknown[]=[];
  const success=new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl:"http://adapter.local/",bearerToken:"engineer-only",
    fetchFn:async(url,init)=>{
      calls.push({url:String(url),body:JSON.parse(String(init?.body)),
        auth:new Headers(init?.headers).get("authorization")});
      return new Response(JSON.stringify({
        credential_id:"urn:root:preliminary",
        status_set:true,status_purpose:"revocation",version:2
      }),{status:200});
    }
  });
  await success.revokeRoot("urn:root:preliminary");
  assert.deepEqual(calls,[{
    url:"http://adapter.local/v1/credentials/status",
    body:{credential_id:"urn:root:preliminary",status_set:true},
    auth:"Bearer engineer-only"
  }]);
  for(const body of [
    {credential_id:"urn:root:preliminary",status_set:false,status_purpose:"revocation"},
    {credential_id:"urn:root:other",status_set:true,status_purpose:"revocation"},
    {credential_id:"urn:root:preliminary",status_set:true,status_purpose:"suspension"}
  ]){
    const client=new SoftwareEngineerAuthorityBootstrap({
      adapterBaseUrl:"http://adapter.local",bearerToken:"engineer-only",
      fetchFn:async()=>new Response(JSON.stringify(body),{status:200})
    });
    await assert.rejects(()=>client.revokeRoot("urn:root:preliminary"),/not confirmed/);
  }
});
