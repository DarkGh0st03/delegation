import assert from "node:assert/strict";
import test from "node:test";
import { GatewayRuntime } from "../src/runtime.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "../src/trusted-authority-only-admissions.ts";
import {MockExecutor} from "../src/mock-executor.ts";
import { InMemoryAuditSink } from "../src/prepare.ts";
import type { PolicyInput, PolicyPort, VerificationRequest, VerifierPort } from "../src/types.ts";

const baseConfig = {
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
  gitea_timeout_ms: 3_000
};

const verifier: VerifierPort = {
  async verify(request: VerificationRequest) {
    return {
      presenter_id: "did:thesis:backend-agent",
      credential_id: "urn:credential:backend",
      issuer_id: "did:thesis:orchestrator",
      permissions: [request.required_permission],
      hierarchy_depth: 1,
      expiration: "999999999999"
    };
  }
};

const policy: PolicyPort = {
  async evaluate(_input: PolicyInput) {
    return { allow: true, policy_version: "phase4a-v1" };
  }
};

test("runtime preserves explicit mock mode without requiring Gitea secrets", () => {
  const runtime = new GatewayRuntime(
    { ...baseConfig, provider_mode: "mock" as const },
    { verifier, policy, audit: new InMemoryAuditSink() }
  );
  assert.equal(runtime.providerLabel, "mock");
});

test("runtime rejects gitea-readonly mode when provider credentials are absent", () => {
  assert.throws(
    () =>
      new GatewayRuntime(
        { ...baseConfig, provider_mode: "gitea-readonly" as const },
        { verifier, policy, audit: new InMemoryAuditSink() }
      ),
    /requires Gitea URL and Gateway token/u
  );
});

test("runtime rejects mutable gitea mode when provider credentials are absent", () => {
  assert.throws(
    () =>
      new GatewayRuntime(
        { ...baseConfig, provider_mode: "gitea" as const },
        { verifier, policy, audit: new InMemoryAuditSink() }
      ),
    /requires Gitea URL and Gateway token/u
  );
});

test("runtime wires mutable gitea mode without contacting the provider at startup", () => {
  const runtime = new GatewayRuntime(
    {
      ...baseConfig,
      provider_mode: "gitea" as const,
      gitea_base_url: "http://gitea:3000",
      gitea_gateway_token: "gateway-secret"
    },
    { verifier, policy, audit: new InMemoryAuditSink() }
  );
  assert.equal(runtime.providerLabel, "gitea");
});

test("canonical runtime refuses authority-only effects with no enrolled owner", () => {
  for(const name of ["authorityOnlyReadEnabled","authorityOnlyMutationEnabled","authorityOnlyRunnerEnabled","authorityOnlyBranchEnabled","authorityOnlyPullRequestEnabled"] as const){
    assert.throws(() => new GatewayRuntime(
      {...baseConfig, provider_mode:"mock" as const},
      {verifier,policy,[name]:true}
    ),/matching explicit enablement and owner executor/u);
  }
  assert.throws(() => new GatewayRuntime(
    {...baseConfig, provider_mode:"mock" as const},
    {verifier,policy,authorityOnlyMutationEnabled:true,
     authorityOnlyMutationExecutor:{isForAdmissions:()=>true} as never}
  ),/require enrolled native authority/u);
  assert.throws(() => new GatewayRuntime(
    {...baseConfig, provider_mode:"mock" as const},
    {verifier,policy,authorityOnlyRunnerEnabled:true,
     authorityOnlyRunnerExecutor:{isForAdmissions:()=>true} as never}
  ),/require enrolled native authority/u);
});

/**
 * These intentionally forged gate objects only exercise constructor NO-GO
 * paths, before any Gitea, native Rust, OPA or authorization state is used.
 * Positive E2E tests must use a genuinely activated owner admission.
 */
test("canonical authority-only runtime fails closed without explicit native verifier mode",()=>{
  const gate=Object.create(
    TrustedAuthorityOnlyGatewayAdmissions.prototype
  ) as TrustedAuthorityOnlyGatewayAdmissions;
  const config={
    ...baseConfig,provider_mode:"gitea" as const,
    gitea_base_url:"http://gitea:3000",
    gitea_gateway_token:"test-only"
  };
  assert.throws(()=>new GatewayRuntime(config,{
    authorityOnlyAdmissions:gate,verifier,policy
  }),/explicit independent Core Rust verification/u);
  assert.throws(()=>new GatewayRuntime({
    ...config,verifier_mode:"adapter" as const
  },{authorityOnlyAdmissions:gate,verifier,policy}),
  /explicit independent Core Rust verification/u);
  assert.throws(()=>new GatewayRuntime({
    ...config,provider_mode:"mock" as const,verifier_mode:"core-rust" as const
  },{authorityOnlyAdmissions:gate,verifier,policy}),
  /requires mutable Gitea/u);
});

test("R357.3 native read receipt cannot be enabled without matching original Gateway publisher",()=>{
 const gate=Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype
 ) as TrustedAuthorityOnlyGatewayAdmissions;
 const config={
  ...baseConfig,provider_mode:"gitea" as const,
  verifier_mode:"core-rust" as const,
  gitea_base_url:"http://gitea:3000",
  gitea_gateway_token:"test-only"
 };
 assert.throws(()=>new GatewayRuntime(config,{
  authorityOnlyAdmissions:gate,policy,
  authorityOnlyReadEnabled:true
 }),/matching explicit enablement and owner executor/u);
 assert.throws(()=>new GatewayRuntime(config,{
  authorityOnlyAdmissions:gate,policy,
  authorityOnlyReceiptWriter:{isForAdmissions:()=>true} as never
 }),/matching explicit enablement and owner executor/u);
 assert.throws(()=>new GatewayRuntime(config,{
  authorityOnlyAdmissions:gate,policy,
  authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:{isForAdmissions:()=>true} as never
 }),/read publisher differs from enrolled owner/u);
 assert.throws(()=>new GatewayRuntime({
  ...config,provider_mode:"mock" as const
 },{
  policy,authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:{isForAdmissions:()=>true} as never
 }),/require enrolled native authority/u);
});

test("canonical authority-only runtime rejects simulated native verifier or provider",()=>{
  const gate=Object.create(
    TrustedAuthorityOnlyGatewayAdmissions.prototype
  ) as TrustedAuthorityOnlyGatewayAdmissions;
  const config={
    ...baseConfig,provider_mode:"gitea" as const,
    verifier_mode:"core-rust" as const,
    gitea_base_url:"http://gitea:3000",
    gitea_gateway_token:"test-only"
  };
  assert.throws(()=>new GatewayRuntime(config,{
    authorityOnlyAdmissions:gate,verifier,policy
  }),/rejects non-native verifier injection/u);
  assert.throws(()=>new GatewayRuntime(config,{
    authorityOnlyAdmissions:gate,policy,
    executor:new MockExecutor()
  }),/rejects non-Gitea executor injection/u);
});
