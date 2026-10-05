import assert from "node:assert/strict";
import test from "node:test";
import { PolicyUnavailableError } from "../src/errors.ts";
import { OpaPolicyClient } from "../src/policy-client.ts";
import type { PolicyInput } from "../src/types.ts";

const input: PolicyInput = {
  request_id: "req-1",
  task_id: "task-1",
  agent_role: "backend",
  tool: "read_file",
  arguments: {
    branch: "feature/account-suspension",
    path: "apps/backend/src/users/user.service.ts"
  },
  required_permission: {
    resource:
      "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
    operation: "read_file"
  },
  repository: {
    authority: "gitea.local",
    owner: "thesis",
    repository: "iam-console-poc"
  },
  verified_delegation: {
    presenter_id: "did:thesis:backend-agent",
    credential_id: "urn:credential:backend",
    issuer_id: "did:thesis:orchestrator",
    hierarchy_depth: 1
  }
};

test("OPA client posts server-derived input and parses allow decision", async () => {
  let observedUrl = "";
  let observedBody = "";
  const client = new OpaPolicyClient({
    baseUrl: "http://opa:8181/",
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      observedUrl = String(url);
      observedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          result: { allow: true, policy_version: "phase4a-v1" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch
  });

  const decision = await client.evaluate(input);
  assert.equal(observedUrl, "http://opa:8181/v1/data/thesis/gateway/decision");
  assert.deepEqual(JSON.parse(observedBody), { input });
  assert.deepEqual(decision, {
    allow: true,
    policy_version: "phase4a-v1"
  });
});

test("OPA client preserves a valid deny decision", async () => {
  const client = new OpaPolicyClient({
    baseUrl: "http://opa:8181",
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          result: { allow: false, policy_version: "phase4a-v1" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch
  });

  assert.deepEqual(await client.evaluate(input), {
    allow: false,
    policy_version: "phase4a-v1"
  });
});

test("OPA outage, non-2xx and malformed result fail closed", async () => {
  const network = new OpaPolicyClient({
    baseUrl: "http://opa",
    fetchFn: (async () => {
      throw new Error("connection refused");
    }) as typeof fetch
  });
  await assert.rejects(network.evaluate(input), PolicyUnavailableError);

  const serverError = new OpaPolicyClient({
    baseUrl: "http://opa",
    fetchFn: (async () =>
      new Response("broken", { status: 500 })) as typeof fetch
  });
  await assert.rejects(serverError.evaluate(input), PolicyUnavailableError);

  const malformed = new OpaPolicyClient({
    baseUrl: "http://opa",
    fetchFn: (async () =>
      new Response(JSON.stringify({ result: { allow: "yes" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as typeof fetch
  });
  await assert.rejects(malformed.evaluate(input), PolicyUnavailableError);
});
