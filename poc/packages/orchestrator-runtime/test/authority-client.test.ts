import assert from "node:assert/strict";
import test from "node:test";
import {SoftwareEngineerAuthorityBootstrap}
  from "../src/authority-client.ts";
import type {IssuedDelegationCredential}
  from "../src/index.ts";
import * as canonicalOrchestratorApi from "../src/index.ts";

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

test("R173 canonical Engineer exports no legacy static root or child authority",()=>{
  assert.equal(Object.hasOwn(canonicalOrchestratorApi,
    "DeterministicOrchestratorAuthorityIssuer"),false);
  assert.equal(Object.hasOwn(canonicalOrchestratorApi,
    "LegacySoftwareEngineerAuthorityBootstrap"),false);
  assert.equal(Object.hasOwn(canonicalOrchestratorApi,
    "SoftwareEngineerAuthorityBootstrap"),false,
    "R384.9: historical HTTP Adapter client must never be exported");
  assert.equal(Object.hasOwn(canonicalOrchestratorApi,
    "postCredential"),false);
  assert.equal("issueOrchestratorRoot" in
    SoftwareEngineerAuthorityBootstrap.prototype,false);
  assert.equal(typeof SoftwareEngineerAuthorityBootstrap.prototype.issueScopedOrchestratorRoot,
    "function");
});
