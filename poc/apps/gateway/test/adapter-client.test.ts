import assert from "node:assert/strict";
import test from "node:test";
import { AdapterVerifierClient } from "../src/adapter-client.ts";
import {
  VerificationRejectedError,
  VerificationUnavailableError
} from "../src/errors.ts";

const request = {
  presenter: "backend" as const,
  audience: "cloud-access-gateway",
  challenge: "challenge-1",
  required_permission: {
    resource:
      "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/app.ts",
    operation: "read_file" as const
  },
  signed_vp: "signed.jwt"
};

test("Adapter client authenticates as Gateway and parses VerifiedDelegation", async () => {
  let observedAuthorization = "";
  let observedBody = "";
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    observedBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        presenter_id: "did:thesis:backend-agent",
        credential_id: "urn:credential:backend",
        issuer_id: "did:thesis:orchestrator",
        permissions: [request.required_permission],
        hierarchy_depth: 1,
        expiration: "999999999999999999999"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const client = new AdapterVerifierClient({
    baseUrl: "http://delegation-adapter:8090/",
    gatewayToken: "gateway-secret",
    fetchFn
  });

  const result = await client.verify(request);
  assert.equal(observedAuthorization, "Bearer gateway-secret");
  assert.deepEqual(JSON.parse(observedBody), request);
  assert.equal(result.presenter_id, "did:thesis:backend-agent");
  assert.equal(result.hierarchy_depth, 1);
});

test("Adapter 4xx is a verification rejection while 5xx is unavailable", async () => {
  const rejecting = new AdapterVerifierClient({
    baseUrl: "http://adapter",
    gatewayToken: "token",
    fetchFn: (async () =>
      new Response(JSON.stringify({ error: "invalid proof" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })) as typeof fetch
  });
  await assert.rejects(rejecting.verify(request), VerificationRejectedError);

  const unavailable = new AdapterVerifierClient({
    baseUrl: "http://adapter",
    gatewayToken: "token",
    fetchFn: (async () =>
      new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      })) as typeof fetch
  });
  await assert.rejects(unavailable.verify(request), VerificationUnavailableError);
});
