import test from "node:test";
import assert from "node:assert/strict";
import {InMemoryRequestStore} from "../src/prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../src/trusted-authority-only-admissions.ts";
import {
  assertLegacyGatewayEntrypoint,
  createTrustedAuthorityOnlyGatewayServer
} from "../src/trusted-authority-only-host.ts";
import type {GatewayRuntimeConfig}
 from "../src/config.ts";

const config:GatewayRuntimeConfig={
  bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,
    repository:{authority:"gitea.local",owner:"thesis",
      repository:"iam-console-poc"}},
  verifier_mode:"core-rust",provider_mode:"gitea",
  opa_url:"http://127.0.0.1:8181",opa_timeout_ms:2000,
  gitea_base_url:"http://127.0.0.1:3000",
  gitea_gateway_token:"disposable-test-token",
  gitea_timeout_ms:3000,runner_timeout_ms:900000
};

test("legacy Gateway main never silently substitutes signed-DAG for authority-only",()=>{
  assert.doesNotThrow(()=>assertLegacyGatewayEntrypoint(undefined));
  assert.doesNotThrow(()=>assertLegacyGatewayEntrypoint("legacy-signed-dag"));
  for(const value of ["authority-only","authority_only","", "mock"]){
    assert.throws(()=>assertLegacyGatewayEntrypoint(value),
      /legacy main.ts cannot launch requested authority-only/u);
  }
});

test("owner HTTP entrypoint denies mock, Adapter and missing OPA before opening a port",()=>{
  const owner={} as never;
  assert.throws(()=>createTrustedAuthorityOnlyGatewayServer({
    ...config,provider_mode:"mock"
  },owner),/mutable Gitea, independent Core Rust and OPA/u);
  assert.throws(()=>createTrustedAuthorityOnlyGatewayServer({
    ...config,verifier_mode:"adapter"
  },owner),/mutable Gitea, independent Core Rust and OPA/u);
  assert.throws(()=>createTrustedAuthorityOnlyGatewayServer({
    ...config,opa_url:""
  },owner),/mutable Gitea, independent Core Rust and OPA/u);
});

test("owner HTTP entrypoint rejects absent or serialized owner capabilities",()=>{
  assert.throws(()=>createTrustedAuthorityOnlyGatewayServer(
    config,undefined as never),/concrete trusted owner/u);
  assert.throws(()=>createTrustedAuthorityOnlyGatewayServer(config,{
    admissions:{phase:"active"},
    mutationExecutor:{isForAdmissions:()=>true},
    runnerExecutor:{isForAdmissions:()=>true},
    store:new InMemoryRequestStore()
  } as never),/concrete trusted owner/u);
});

test("owner HTTP entrypoint refuses an unactivated owner even if class prototype is forged",()=>{
  const fake=Object.create(
    TrustedAuthorityOnlyGatewayAdmissions.prototype
  ) as TrustedAuthorityOnlyGatewayAdmissions;
  // The class's private #phase brand is not supplied by Object.create.
  // A prototype-spoofed instance cannot yield the 'active' gate state.
  assert.throws(()=>createTrustedAuthorityOnlyGatewayServer(config,{
    admissions:fake,store:new InMemoryRequestStore()
  } as never),/concrete trusted owner/u);
});
