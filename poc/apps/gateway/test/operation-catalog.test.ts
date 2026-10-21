import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { GatewayError } from "../src/errors.ts";
import {
  RUST_OPERATIONS, isRustOperation
} from "../src/operation-catalog.ts";
import {
  classifyGatewayOperation, gatewaySupportsOperation
} from "../src/operation-support.ts";
import { TOOL_NAMES } from "../src/types.ts";
import { InMemoryAuditSink, InMemoryRequestStore, prepareAuthorization } from "../src/prepare.ts";
import { validatePrepareAuthorizationRequest } from "../src/validation.ts";
import { createGatewayHttpServer } from "../src/http.ts";
import { GatewayRuntime } from "../src/runtime.ts";

const rustPath = new URL("../../../../src/delegation/authorization/operation.rs", import.meta.url);
const syncPath = new URL("../../../scripts/sync-rust-operation-catalog.mjs", import.meta.url);
const rust = readFileSync(rustPath, "utf8");
const rustNames = [...rust.matchAll(/Self::[A-Za-z][A-Za-z0-9_]*\s*=>\s*"([a-z][a-z0-9_]*)"/gu)].map((m) => m[1]);
const config = {
  audience: "cloud-access-gateway",
  request_ttl_ms: 120_000,
  repository: { authority: "gitea.local", owner: "thesis", repository: "iam-console-poc" }
};
const body = (tool: string): Record<string, unknown> => ({
  task_id: "task-catalog",
  agent_role: "backend",
  tool,
  arguments: { branch:"feature/demo", path:"src/main.ts" }
});
function resultOf(input: unknown) {
  try {
    validatePrepareAuthorizationRequest(input);
    return { status: 0, code:"accepted" };
  } catch (error) {
    assert.ok(error instanceof GatewayError);
    return {status: error.statusCode, code:error.code};
  }
}

test("generated TypeScript catalog has one-to-one equality with authoritative Rust names", () => {
  assert.equal(RUST_OPERATIONS.length, rustNames.length);
  assert.ok(RUST_OPERATIONS.length >= 31);
  assert.deepEqual([...RUST_OPERATIONS], rustNames);
  assert.equal(new Set(RUST_OPERATIONS).size, RUST_OPERATIONS.length);
  assert.match(
    execFileSync(process.execPath,[syncPath.pathname,"--check"],{encoding:"utf8"}),
    /catalog matches Rust/
  );
});

test("every Rust operation is recognized, but unimplemented operations stay unavailable", () => {
  for (const operation of RUST_OPERATIONS) {
    assert.equal(isRustOperation(operation), true);
    const supported = (TOOL_NAMES as readonly string[]).includes(operation);
    assert.equal(classifyGatewayOperation(operation), supported ? "supported" : "unavailable");
    assert.equal(gatewaySupportsOperation(operation), supported);
  }
  assert.equal(classifyGatewayOperation("totally_fake_operation"),"unknown");
  assert.equal(classifyGatewayOperation({tool:"read_file"}),"unknown");
  assert.equal(classifyGatewayOperation(null),"unknown");
  assert.equal(TOOL_NAMES.length, 6, "do not accidentally activate new provider tools");
  for (const tool of TOOL_NAMES) assert.ok(isRustOperation(tool));
});

test("recognized-but-unimplemented operations fail closed without preparing a DC/VP request", () => {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();
  const deps = {store,audit};
  for (const operation of RUST_OPERATIONS) {
    if ((TOOL_NAMES as readonly string[]).includes(operation)) continue;
    assert.deepEqual(resultOf(body(operation)),{
      status:501,code:"provider_operation_unavailable"
    },operation);
    assert.throws(
      ()=>prepareAuthorization(body(operation),config,deps),
      (error: unknown) => error instanceof GatewayError &&
        error.statusCode===501 && error.code==="provider_operation_unavailable"
    );
  }
  assert.equal(store.size(),0);
  assert.equal(audit.events.length,0);
});

test("unknown names are invalid, while supported operations keep their original normalization", () => {
  assert.deepEqual(resultOf(body("a_random_operation")),{
    status:400,code:"unknown_operation"
  });
  const valid=validatePrepareAuthorizationRequest({
    ...body("read_file"),
    arguments:{branch:"feature/demo",path:"src/main.ts"}
  });
  assert.deepEqual(valid.request,{
    tool:"read_file",arguments:{branch:"feature/demo",path:"src/main.ts"}
  });
});

test("HTTP prepare distinguishes 400 unknown and 501 recognized/unavailable, without token issuance", async () => {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();
  const runtime = new GatewayRuntime({
    bind_host:"127.0.0.1",
    bind_port:0,
    prepare:config,
    adapter_url:"http://unused",
    adapter_gateway_token:"unused",
    opa_url:"http://unused",
    opa_timeout_ms:1000,
    provider_mode:"mock",
    gitea_timeout_ms:1000
  }, {store,audit});
  const server = createGatewayHttpServer(runtime);
  await new Promise<void>((resolve)=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address==="object");
    for (const [tool,status,code] of [
      ["totally_fake_operation",400,"unknown_operation"],
      ["merge_pull_request",501,"provider_operation_unavailable"],
      ["delete_file",501,"provider_operation_unavailable"],
      ["list_directory",501,"provider_operation_unavailable"]
    ] as const) {
      const response=await fetch("http://127.0.0.1:"+address.port+"/v1/authorization/prepare",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(body(tool))
      });
      assert.equal(response.status,status,tool);
      const json=await response.json();
      assert.equal(json.error,code);
      assert.ok(!("request_id" in json), "unavailable tools must never have a prepare token");
    }
    assert.equal(store.size(),0);
    assert.equal(audit.events.length,0);
  } finally {
    await new Promise<void>((resolve,reject)=>
      server.close((error)=>(error ? reject(error) : resolve())));
  }
});
