import assert from "node:assert/strict";
import test from "node:test";
import {OrchestratorGatewayClientError} from "../src/index.ts";
import {OrchestratorProtectedGatewayClient}
  from "../src/legacy-orchestrator-gateway-client.ts";
import * as canonicalApi from "../src/index.ts";
import {OrchestratorPlanningGatewayReadClient}
  from "../src/orchestrator-gateway-client.ts";

const baseline = "a".repeat(40);
const feature = "b".repeat(40);

function createFetch() {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(
      new Headers(init?.headers).entries()
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, headers, body });

    if (url.endsWith("/v1/authorization/prepare")) {
      const tool = body.tool;
      return new Response(
        JSON.stringify({
          request_id:
            tool === "create_branch" ? "request-branch" : "request-pr",
          audience: "cloud-access-gateway",
          challenge:
            tool === "create_branch" ? "challenge-1" : "challenge-2",
          required_permission: {
            resource: "gitea://gitea.local/thesis/iam-console-poc",
            operation: tool
          },
          expires_at: "2026-10-05T18:00:00Z"
        }),
        { status: 201 }
      );
    }

    if (url.endsWith("/v1/presentations")) {
      return new Response(
        JSON.stringify({
          signed_vp: `signed-vp-${body.challenge}`
        }),
        { status: 201 }
      );
    }

    if (url.endsWith("/v1/authorization/execute")) {
      if (body.request_id === "request-branch") {
        return new Response(
          JSON.stringify({
            decision: "allow",
            execution: {
              provider: "gitea",
              performed: true,
              tool: "create_branch",
              branch: "feature/account-suspension",
              base_branch: "main",
              revision: baseline,
              commit_sha: baseline
            }
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          decision: "allow",
          execution: {
            provider: "gitea",
            performed: true,
            tool: "create_pull_request",
            pull_request_id: 7,
            pull_request_number: 3,
            url: "http://gitea.local/thesis/iam-console-poc/pulls/3",
            head_branch: "feature/account-suspension",
            base_branch: "main",
            revision: feature
          }
        }),
        { status: 200 }
      );
    }

    throw new Error(`Unexpected request ${url}`);
  };

  return { calls, fetchFn };
}

test("Orchestrator client creates only the frozen feature branch through prepare -> VP -> execute", async () => {
  const { calls, fetchFn } = createFetch();
  const client = new OrchestratorProtectedGatewayClient({
    gatewayBaseUrl: "http://gateway.local",
    adapterBaseUrl: "http://adapter.local",
    adapterToken: "orchestrator-secret",
    rootCredentialId: "urn:thesis:dc:orchestrator-root",
    fetchFn
  });

  const result = await client.createFeatureBranch(
    "phase9b-create-branch"
  );

  assert.equal(result.branch, "feature/account-suspension");
  assert.equal(result.base_branch, "main");
  assert.equal(result.revision, baseline);
  assert.equal(calls.length, 3);

  assert.deepEqual(calls[0]!.body, {
    task_id: "phase9b-create-branch",
    agent_role: "orchestrator",
    tool: "create_branch",
    arguments: {
      base_branch: "main",
      branch: "feature/account-suspension"
    }
  });
  assert.equal(calls[0]!.headers.authorization, undefined);

  assert.deepEqual(calls[1]!.body, {
    credential_id: "urn:thesis:dc:orchestrator-root",
    disclosed_permissions: [
      {
        resource: "gitea://gitea.local/thesis/iam-console-poc",
        operation: "create_branch"
      }
    ],
    audience: "cloud-access-gateway",
    challenge: "challenge-1"
  });
  assert.equal(
    calls[1]!.headers.authorization,
    "Bearer orchestrator-secret"
  );

  assert.deepEqual(calls[2]!.body, {
    request_id: "request-branch",
    signed_vp: "signed-vp-challenge-1"
  });
  assert.equal("signed_vp" in result, false);
});

test("Orchestrator client creates only feature -> main Pull Requests", async () => {
  const { calls, fetchFn } = createFetch();
  const client = new OrchestratorProtectedGatewayClient({
    gatewayBaseUrl: "http://gateway.local/",
    adapterBaseUrl: "http://adapter.local/",
    adapterToken: "orchestrator-secret",
    rootCredentialId: "urn:thesis:dc:orchestrator-root",
    fetchFn
  });

  const result =
    await client.createAccountSuspensionPullRequest(
      "phase9b-create-pr"
    );

  assert.equal(result.head_branch, "feature/account-suspension");
  assert.equal(result.base_branch, "main");
  assert.equal(result.pull_request_number, 3);
  assert.deepEqual(calls[0]!.body, {
    task_id: "phase9b-create-pr",
    agent_role: "orchestrator",
    tool: "create_pull_request",
    arguments: {
      head_branch: "feature/account-suspension",
      base_branch: "main",
      title: "Account Suspension Feature",
      body:
        "PoC changes produced under delegated authorization. Final merge requires Software Engineer review."
    }
  });
});

test("Orchestrator client fails closed on malformed provider results", async () => {
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<
      string,
      unknown
    >;

    if (url.endsWith("/v1/authorization/prepare")) {
      return new Response(
        JSON.stringify({
          request_id: "request-branch",
          audience: "cloud-access-gateway",
          challenge: "challenge",
          required_permission: {
            resource: "gitea://gitea.local/thesis/iam-console-poc",
            operation: "create_branch"
          }
        }),
        { status: 201 }
      );
    }
    if (url.endsWith("/v1/presentations")) {
      return new Response(
        JSON.stringify({ signed_vp: "vp" }),
        { status: 201 }
      );
    }
    if (body.request_id === "request-branch") {
      return new Response(
        JSON.stringify({
          execution: {
            provider: "gitea",
            performed: true,
            tool: "create_branch",
            branch: "feature/not-allowed",
            base_branch: "main",
            revision: baseline,
            commit_sha: baseline
          }
        }),
        { status: 200 }
      );
    }
    throw new Error("Unexpected request");
  };

  const client = new OrchestratorProtectedGatewayClient({
    gatewayBaseUrl: "http://gateway.local",
    adapterBaseUrl: "http://adapter.local",
    adapterToken: "orchestrator-secret",
    rootCredentialId: "urn:thesis:dc:orchestrator-root",
    fetchFn
  });

  await assert.rejects(
    () => client.createFeatureBranch("phase9b-malformed"),
    OrchestratorGatewayClientError
  );
});

test("R6 canonical public API excludes historical fixed branch and PR writer",()=>{
  assert.equal(
    Object.hasOwn(canonicalApi,"OrchestratorProtectedGatewayClient"),false
  );
  assert.equal(typeof OrchestratorProtectedGatewayClient,"function");
  assert.equal(typeof OrchestratorGatewayClientError,"function");
  assert.equal(
    typeof OrchestratorProtectedGatewayClient.prototype.createFeatureBranch,
    "function"
  );
  assert.equal(
    typeof OrchestratorProtectedGatewayClient.prototype.createAccountSuspensionPullRequest,
    "function"
  );
});

test("R6 Planning read-only client has no branch or Pull Request shortcuts",()=>{
  const planning=OrchestratorPlanningGatewayReadClient.prototype;
  const archived=OrchestratorProtectedGatewayClient.prototype;
  assert.equal(Object.hasOwn(planning,"readPlanningResource"),true);
  assert.equal(Object.hasOwn(planning,"createFeatureBranch"),false);
  assert.equal(Object.hasOwn(planning,"createAccountSuspensionPullRequest"),false);
  assert.equal(Object.hasOwn(archived,"readPlanningResource"),false);
  assert.equal(Object.hasOwn(archived,"createFeatureBranch"),true);
  assert.equal(Object.hasOwn(archived,"createAccountSuspensionPullRequest"),true);
  assert.equal(typeof canonicalApi.OrchestratorPlanningGatewayReadClient,"function");
  assert.equal(Object.hasOwn(canonicalApi,"OrchestratorProtectedGatewayClient"),false);
});


test("R5 session cancellation between prepare and VP prevents Adapter and execute",async()=>{
  const controller=new AbortController();
  const calls:string[]=[];
  const fetchFn:typeof fetch=async(url,init)=>{
    calls.push(String(url));
    assert.equal(init?.signal?.aborted,false);
    // A simulated slow/uncooperative Gateway can still return a response
    // after the controller cancels. No VP may be signed afterward.
    controller.abort();
    return new Response(JSON.stringify({
      request_id:"once",audience:"gateway",challenge:"nonce",
      required_permission:{operation:"read_repository",
        resource:"gitea://gitea.local/thesis/invoices"}
    }),{status:201});
  };
  const client=new OrchestratorPlanningGatewayReadClient({
    gatewayBaseUrl:"http://gateway",adapterBaseUrl:"http://adapter",
    adapterToken:"private",rootCredentialId:"planning-root",fetchFn
  });
  await assert.rejects(()=>client.readPlanningResource(
    "planning-session","read_repository",{},
    {authority:"gitea.local",owner:"thesis",repository:"invoices"},
    controller.signal
  ),/cancelled/);
  assert.equal(calls.length,1);
  assert.ok(calls[0].endsWith("/prepare"));
});

test("R5 pre-cancelled Planning call cannot contact Gateway",async()=>{
  let calls=0;
  const controller=new AbortController();controller.abort();
  const client=new OrchestratorPlanningGatewayReadClient({
    gatewayBaseUrl:"http://gateway",adapterBaseUrl:"http://adapter",
    adapterToken:"private",rootCredentialId:"planning-root",
    fetchFn:async()=>{calls++;throw Error("must not run");}
  });
  await assert.rejects(()=>client.readPlanningResource(
    "planning-session","read_repository",{},
    {authority:"gitea.local",owner:"thesis",repository:"invoices"},
    controller.signal
  ),/cancelled/);
  assert.equal(calls,0);
});
