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
      typeof error.details === "object"
  );
});
