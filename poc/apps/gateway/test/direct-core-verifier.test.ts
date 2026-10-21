import assert from "node:assert/strict";
import test from "node:test";
import {DirectCoreRustVerifier,type CoreRustBinding} from "../src/direct-core-verifier.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {parseGatewayVerifierMode} from "../src/config.ts";
import {
  VerificationRejectedError,VerificationUnavailableError
} from "../src/errors.ts";
import {InMemoryAuditSink,InMemoryRequestStore} from "../src/prepare.ts";
import type {
  Permission,VerificationRequest,MultipleVerificationRequest,VerifiedDelegation,
  VerifierPort
} from "../src/types.ts";

const ids={
  orchestrator:"did:thesis:orchestrator",
  backend:"did:thesis:backend",
  frontend:"did:thesis:frontend",
  test:"did:thesis:test"
} as const;
const read:Permission={
  resource:"gitea://gitea.local/thesis/repository/branches/main/files/app.ts",
  operation:"read_file"
};
const write:Permission={...read,operation:"update_file"};
const legacy:VerificationRequest={
  presenter:"backend",audience:"cloud-access-gateway",challenge:"nonce",
  required_permission:read,signed_vp:"signed.jwt.payload"
};
const multi:MultipleVerificationRequest={
  presenter:"backend",audience:"cloud-access-gateway",challenge:"nonce",
  required_permissions:[read,write],signed_vp:"signed.jwt.payload"
};
function result(permissions:Permission[],presenter_id:string=ids.backend){
  return JSON.stringify({
    presenter_id,credential_id:"urn:delegation:backend",
    issuer_id:ids.orchestrator,permissions,
    hierarchy_depth:1,expiration:"999999999999999999"
  });
}
function fakeBinding(handler:(context:Record<string,unknown>,jwt:string)=>string):CoreRustBinding {
  return {
    verify_verifiable_presentation(ctx,jwt){
      return handler(JSON.parse(ctx) as Record<string,unknown>,jwt);
    }
  };
}

test("direct Core wrapper builds Rust-compatible AuthorizationContext for single and multi",async()=>{
  const contexts:Record<string,unknown>[]=[];
  const core=new DirectCoreRustVerifier(fakeBinding((ctx,jwt)=>{
    contexts.push(ctx);
    assert.equal(jwt,"signed.jwt.payload");
    return result(ctx.required_permission ?
      [ctx.required_permission as Permission] :
      ctx.required_permissions as Permission[]);
  }),ids);
  const a=await core.verify(legacy);
  const b=await core.verifyMultiple(multi);
  assert.equal(a.permissions.length,1);
  assert.equal(b.permissions.length,2);
  assert.deepEqual(contexts[0],{
    presenter_id:ids.backend,audience:"cloud-access-gateway",
    challenge:"nonce",required_permission:read
  });
  assert.deepEqual(contexts[1],{
    presenter_id:ids.backend,audience:"cloud-access-gateway",
    challenge:"nonce",required_permissions:[read,write]
  });
  assert.ok(!Object.hasOwn(contexts[1],"required_permission"));
});

test("invalid, duplicate and empty authorization requirements reject before native binding",async()=>{
  let count=0;
  const core=new DirectCoreRustVerifier(fakeBinding(()=>{
    count++; return result([read]);
  }),ids);
  for(const request of [
    {...multi,required_permissions:[]},
    {...multi,required_permissions:[read,read]},
    {...multi,required_permissions:[read,{resource:"",operation:"read_file"}]},
    {...multi,signed_vp:""},
    {...multi,audience:""},
    {...multi,challenge:""},
    {...multi,required_permissions:new Array(129).fill(read)}
  ]){
    await assert.rejects(core.verifyMultiple(request),VerificationRejectedError);
  }
  assert.equal(count,0);
});

test("native binding failure denies; inconsistent result never permits execution",async()=>{
  const rejects=new DirectCoreRustVerifier({
    verify_verifiable_presentation(){throw Error("internal trust resolver unavailable");}
  },ids);
  await assert.rejects(rejects.verify(legacy),VerificationRejectedError);
  for(const malformed of [
    result([read],ids.frontend),
    result([read]),
    JSON.stringify({}),
    "not-json"
  ]){
    const core=new DirectCoreRustVerifier(fakeBinding(()=>malformed),ids);
    await assert.rejects(core.verifyMultiple(multi),VerificationUnavailableError);
  }
  const missing=new DirectCoreRustVerifier(fakeBinding(()=>result([read])),ids);
  await assert.rejects(missing.verifyMultiple(multi),VerificationUnavailableError);
});

test("gateway direct-mode startup has no Adapter fallback or fake cryptographic verifier",()=>{
  assert.equal(parseGatewayVerifierMode("adapter"),"adapter");
  assert.equal(parseGatewayVerifierMode("core-rust"),"core-rust");
  assert.throws(()=>parseGatewayVerifierMode("auto"),/must be adapter or core-rust/);
  const cfg={
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{
      audience:"cloud-access-gateway",request_ttl_ms:120_000,
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"}
    },
    verifier_mode:"core-rust" as const,
    opa_url:"http://unused",opa_timeout_ms:2000,
    provider_mode:"mock" as const,gitea_timeout_ms:3000
  };
  assert.throws(
    ()=>new GatewayRuntime(cfg),
    /native addon not built|does not expose the required verifier ABI|sources are not ready/
  );
  // No accidental fallback to Adapter if verifier_mode is explicitly native.
});

test("gateway-level integration still requires OPA after direct-mode verifier output",async()=>{
  const events:string[]=[];
  const fake=new DirectCoreRustVerifier(fakeBinding(ctx=>{
    events.push("rust_core");
    return result([ctx.required_permission as Permission]);
  }),ids);
  const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
  const config={
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{
      audience:"cloud-access-gateway",request_ttl_ms:120_000,
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"}
    },
    verifier_mode:"core-rust" as const,
    opa_url:"http://unused",opa_timeout_ms:2000,
    provider_mode:"mock" as const,gitea_timeout_ms:3000
  };
  const runtime=new GatewayRuntime(config,{
    verifier:fake,store,audit,
    policy:{
      async evaluate(){events.push("opa");return {allow:false,policy_version:"policy-test"};}
    },
    executor:{
      provider:"mock",
      async execute(){events.push("provider");throw Error("must not execute");}
    }
  });
  const prepared=runtime.prepare({
    task_id:"backend-task",agent_role:"backend",
    tool:"read_file",arguments:{branch:"main",path:"app.ts"}
  });
  await assert.rejects(runtime.execute({
    request_id:prepared.request_id,signed_vp:"signed.jwt.payload"
  }));
  assert.deepEqual(events,["rust_core","opa"]);
  assert.ok(!events.includes("provider"));
});
