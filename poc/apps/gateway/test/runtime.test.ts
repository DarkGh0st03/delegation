import assert from "node:assert/strict";
import test from "node:test";
import { GatewayRuntime } from "../src/runtime.ts";
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
