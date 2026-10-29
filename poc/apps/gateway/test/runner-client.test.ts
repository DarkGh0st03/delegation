import assert from "node:assert/strict";
import test from "node:test";
import { RunnerClient } from "../src/runner-client.ts";

const request = {
  request_id: "req-runner-client",
  repository: "gitea://gitea.local/thesis/iam-console-poc",
  branch: "feature/account-suspension",
  commit_sha: "a".repeat(40),
  profile: "poc-default" as const
};

test("RunnerClient sends the exact authorized SHA and validates the response binding", async () => {
  let observedBody: unknown;
  let observedAuthorization = "";

  const client = new RunnerClient({
    baseUrl: "http://runner.internal:8095/",
    gatewayToken: "gateway-runner-secret",
    fetchFn: async (_url, init) => {
      observedAuthorization = String((init?.headers as Record<string, string>)?.authorization);
      observedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          request_id: request.request_id,
          repository: request.repository,
          branch: request.branch,
          tested_commit_sha: request.commit_sha,
          runner_profile: "poc-default",
          status: "pass",
          phases: [
            { phase: "dependency_install", status: "pass" },
            { phase: "researcher_acceptance", status: "pass", passed: 1, failed: 0 }
          ],
          project_tests: {
            status: "pass",
            phases: [{ phase: "dependency_install", status: "pass" }]
          },
          researcher_acceptance: {
            phase: "researcher_acceptance",
            status: "pass",
            passed: 1,
            failed: 0
          },
          log_reference: "runner-log://abc"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await client.run(request);

  assert.equal(observedAuthorization, "Bearer gateway-runner-secret");
  assert.deepEqual(observedBody, request);
  assert.equal(result.tested_commit_sha, request.commit_sha);
  assert.equal(result.status, "pass");
  assert.equal(result.project_tests?.status, "pass");
  assert.equal(result.researcher_acceptance?.status, "pass");
});

test("RunnerClient fails closed on a mismatched tested SHA", async () => {
  const client = new RunnerClient({
    baseUrl: "http://runner.internal:8095",
    gatewayToken: "gateway-runner-secret",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          request_id: request.request_id,
          repository: request.repository,
          branch: request.branch,
          tested_commit_sha: "b".repeat(40),
          runner_profile: "poc-default",
          status: "pass",
          phases: []
        }),
        { status: 200 }
      )
  });

  await assert.rejects(
    () => client.run(request),
    /does not match the authorized request/u
  );
});

test("RunnerClient maps Runner failures to provider unavailability", async () => {
  const client = new RunnerClient({
    baseUrl: "http://runner.internal:8095",
    gatewayToken: "gateway-runner-secret",
    fetchFn: async () =>
      new Response(JSON.stringify({ error: "runner_execution_failed" }), {
        status: 503
      })
  });

  await assert.rejects(
    () => client.run(request),
    /Controlled Test Runner returned HTTP 503/u
  );
});


test("AUD-010: Gateway caller abort reaches outgoing authenticated Runner HTTP request",async()=>{
  const aborter=new AbortController();
  let requestStarted!:()=>void;
  const started=new Promise<void>(resolve=>{requestStarted=resolve;});
  let receivedSignal:AbortSignal|undefined;
  const client=new RunnerClient({
    baseUrl:"http://runner.internal:8095",
    gatewayToken:"gateway-runner-secret",
    fetchFn:async(_url,init)=>{
      receivedSignal=init?.signal as AbortSignal|undefined;
      assert.ok(receivedSignal);
      assert.equal((init?.headers as Record<string,string>).authorization,
        "Bearer gateway-runner-secret");
      requestStarted();
      return await new Promise<Response>((_resolve,reject)=>{
        receivedSignal!.addEventListener("abort",()=>reject(new Error("runner request canceled")),{once:true});
      });
    }
  });
  const promise=client.run(request,aborter.signal);
  await started;
  aborter.abort();
  await assert.rejects(promise,/Controlled Test Runner request failed/);
  assert.equal(receivedSignal?.aborted,true);
});

test("AUD-010: already aborted Gateway signal prevents a Runner HTTP call",async()=>{
  const aborter=new AbortController();
  aborter.abort();
  let calls=0;
  const client=new RunnerClient({
    baseUrl:"http://runner.internal:8095",
    gatewayToken:"gateway-runner-secret",
    fetchFn:async()=>{calls++;return new Response("{}");}
  });
  await assert.rejects(client.run(request,aborter.signal),/request failed/);
  assert.equal(calls,0);
});

test("RunnerClient accepts only bounded Vitest paths in a genuine failure",async()=>{
  const client=new RunnerClient({
    baseUrl:"http://runner.internal:8095",
    gatewayToken:"private-runner-token",
    fetchFn:async()=>new Response(JSON.stringify({
      request_id:request.request_id,
      repository:request.repository,
      branch:request.branch,
      tested_commit_sha:request.commit_sha,
      runner_profile:"poc-default",status:"fail",
      phases:[{phase:"frontend_tests",status:"fail"}],
      project_tests:{status:"fail",
        phases:[{phase:"frontend_tests",status:"fail"}]},
      researcher_acceptance:{phase:"researcher_acceptance",status:"skipped"},
      failing_test_files:[
        "tests/frontend/access.test.tsx",
        "tests/frontend/../private.test.ts",
        "tests/backend/internal.test.ts"
      ],
      secret:"DO_NOT_DISCLOSE"
    }),{status:200})
  });
  const result=await client.run(request);
  assert.deepEqual(result.failing_test_files,["tests/frontend/access.test.tsx"]);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_DISCLOSE"));
});
