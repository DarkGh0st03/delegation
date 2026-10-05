import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlledToolError,
  DelegationEvidenceHandler
} from "../src/index.ts";

const prepared = {
  request_id: "req_phase8a",
  audience: "cloud-access-gateway",
  challenge: "phase8a-challenge",
  required_permission: {
    resource:
      "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
    operation: "read_file"
  },
  expires_at: "2026-10-05T18:00:00.000Z"
};

test("Delegation Evidence Handler keeps credential material inside the authorization wrapper", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const handler = new DelegationEvidenceHandler({
    adapterBaseUrl: "http://adapter.local",
    adapterToken: "phase8a-adapter-test-token",
    evidence: {
      credential: "phase8a-child-credential-payload",
      credential_id: "urn:phase8a:backend",
      presenter_id: "did:thesis:backend-agent"
    },
    fetchFn: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ signed_vp: "phase8a-signed-vp" }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const signedVp = await handler.createPresentation(prepared);
  assert.equal(signedVp, "phase8a-signed-vp");
  assert.equal(requests.length, 1);

  const request = requests[0]!;
  assert.equal(request.url, "http://adapter.local/v1/presentations");
  assert.equal(
    new Headers(request.init?.headers).get("authorization"),
    "Bearer phase8a-adapter-test-token"
  );

  const body = JSON.parse(String(request.init?.body));
  assert.deepEqual(body, {
    credential_id: "urn:phase8a:backend",
    disclosed_permissions: [prepared.required_permission],
    audience: prepared.audience,
    challenge: prepared.challenge
  });
  assert.equal(
    JSON.stringify(body).includes("phase8a-child-credential-payload"),
    false
  );
});

test("Delegation Evidence Handler maps an Adapter presentation rejection to authorization_denied", async () => {
  const handler = new DelegationEvidenceHandler({
    adapterBaseUrl: "http://adapter.local",
    adapterToken: "phase8a-adapter-test-token",
    evidence: {
      credential: "{}",
      credential_id: "urn:phase8a:backend",
      presenter_id: "did:thesis:backend-agent"
    },
    fetchFn: async () =>
      new Response(JSON.stringify({ error: "Permission is not delegated" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
  });

  await assert.rejects(
    () => handler.createPresentation(prepared),
    (error: unknown) =>
      error instanceof ControlledToolError &&
      error.kind === "authorization_denied" &&
      error.statusCode === 400
  );
});
