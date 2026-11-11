import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryAuditSink,
  InMemoryRequestStore,
  prepareAuthorization
} from "../src/prepare.ts";
import {validatePrepareAuthorizationRequest} from "../src/validation.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../src/trusted-authority-only-admissions.ts";

const config = {
  audience: "cloud-access-gateway",
  request_ttl_ms: 120_000,
  repository: {
    authority: "gitea.local",
    owner: "thesis",
    repository: "iam-console-poc"
  }
};

test("prepare binds task, role, tool arguments, permission, audience and challenge", () => {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();

  const response = prepareAuthorization(
    {
      task_id: "task-backend-1",
      agent_role: "backend",
      tool: "update_file",
      arguments: {
        branch: "feature/account-suspension",
        path: "apps/backend/src/users/user.service.ts",
        content: "updated source"
      }
    },
    config,
    {
      store,
      audit,
      nowMs: () => 1_800_000_000_000,
      durationNowMs: (() => {
        const values = [10, 12.5];
        return () => values.shift() ?? 12.5;
      })(),
      requestId: () => "req-fixed",
      challenge: () => "challenge-fixed"
    }
  );

  assert.deepEqual(response, {
    request_id: "req-fixed",
    audience: "cloud-access-gateway",
    challenge: "challenge-fixed",
    required_permission: {
      resource:
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
      operation: "update_file"
    },
    expires_at: new Date(1_800_000_120_000).toISOString()
  });

  const record = store.get("req-fixed");
  assert.ok(record);
  assert.equal(record.task_id, "task-backend-1");
  assert.equal(record.agent_role, "backend");
  assert.equal(record.request.tool, "update_file");
  assert.equal(record.consumed, false);
  assert.match(record.request_fingerprint, /^[0-9a-f]{64}$/);

  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].event, "authorization_prepared");
  assert.equal(audit.events[0].prepare_ms, 2.5);
  assert.equal(audit.events[0].resource_uri, response.required_permission.resource);
});

test("prepare generates independent one-time bindings for repeated tool requests", () => {
  const store = new InMemoryRequestStore();
  const audit = new InMemoryAuditSink();
  let counter = 0;

  const deps = {
    store,
    audit,
    nowMs: () => 1_800_000_000_000,
    durationNowMs: () => 1,
    requestId: () => `req-${++counter}`,
    challenge: () => `challenge-${counter}`
  };

  const input = {
    task_id: "task-test-1",
    agent_role: "test",
    tool: "run_tests",
    arguments: { branch: "feature/account-suspension" }
  };

  const first = prepareAuthorization(input, config, deps);
  const second = prepareAuthorization(input, config, deps);

  assert.notEqual(first.request_id, second.request_id);
  assert.notEqual(first.challenge, second.challenge);
  assert.equal(store.size(), 2);
  assert.equal(
    store.get(first.request_id)?.request_fingerprint,
    store.get(second.request_id)?.request_fingerprint
  );
});

// R360: native operational HEAD is an authenticated Gateway projection,
// never an untrusted model-supplied field.
test("R360 owner-authenticated operational Prepare inherits its exact Gitea HEAD",()=>{
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 const sha="a".repeat(40),path="apps/backend/users/account.ts";
 const task={task_id:"r360-runtime",agent_role:"backend",tool:"read_file",
  arguments:{branch:"feature/account-suspension",path}};
 const permission={resource:
  "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/"+path,
  operation:"read_file"};
 const trustedOwner={preflightCanonicalRequest:()=>({
  status:"gateway_permission_preflight_only",
  authority_digest:"b".repeat(64),runtime_task_id:task.task_id,
  required_permission:permission,agent_did:"did:thesis:backend",
  plan_task_id:"r360-backend",gateway_execution_authorized:false,
  pinned_revision:sha
 })};
 const deps={store,audit,authorityOnlyAdmissions:trustedOwner as never,
  requestId:()=>"r360-owned-read",challenge:()=>"r360-challenge",
  nowMs:()=>1800000000000};
 prepareAuthorization(task,config,deps);
 assert.equal(store.get("r360-owned-read")?.pinned_revision,sha);
 assert.equal(audit.events[0]?.pinned_revision,sha);
 assert.throws(()=>prepareAuthorization({...task,pinned_revision:"c".repeat(40)},
  config,{...deps,requestId:()=>"r360-forged-read"}));
 assert.equal(store.get("r360-forged-read"),undefined);
});

test("R454 additional specialist cannot prepare outside a native Owner read-only binding",()=>{
 const path="apps/backend/src/users/user.service.ts";
 const task={task_id:"runtime-reviewer",agent_role:"reviewer",tool:"read_file",
  arguments:{branch:"feature/account-suspension",path}};
 const expected={
  resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/"+path,
  operation:"read_file"
 };
 assert.throws(()=>validatePrepareAuthorizationRequest(task),
  /agent_role is not supported/u);
 assert.equal(validatePrepareAuthorizationRequest(task,{
  allowOwnerAdditionalReadOnlyRole:true
 }).agent_role,"reviewer");
 const store=new InMemoryRequestStore();
 const audit=new InMemoryAuditSink();
 const base={
  store,audit,requestId:()=>"r454-owner-read",challenge:()=>"fixed",
  nowMs:()=>1_800_000_000_000
 };
 assert.throws(()=>prepareAuthorization(task,config,base),
  /agent_role is not supported/u);
 assert.equal(store.size(),0);
 // A serialized object with a matching method is NOT a trusted native owner.
 assert.throws(()=>prepareAuthorization(task,config,{
  ...base,authorityOnlyAdmissions:{preflightCanonicalRequest:()=>({
   required_permission:expected
  })} as never
 }),/agent_role is not supported/u);
 assert.equal(store.size(),0);
 // This prototype-scoped offline fixture exercises only parsing/projection;
 // real authority-only admission and Rust/OPA are verified separately.
 const owner=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   preflightCanonicalRequest:(raw:unknown)=>{
    assert.deepEqual(raw,task);
    return {status:"gateway_permission_preflight_only",
     authority_digest:"b".repeat(64),runtime_task_id:task.task_id,
     required_permission:expected,agent_did:"did:thesis:reviewer-agent",
     plan_task_id:"reviewer-task",gateway_execution_authorized:false,
     pinned_revision:"c".repeat(40)};
   }
 });
 const issued=prepareAuthorization(task,config,{
  ...base,authorityOnlyAdmissions:owner
 });
 assert.deepEqual(issued.required_permission,expected);
 assert.equal(store.get("r454-owner-read")?.agent_role,"reviewer");
 assert.equal(store.get("r454-owner-read")?.pinned_revision,"c".repeat(40));
 for(const bad of [
  {...task,tool:"update_file",arguments:{...task.arguments,content:"forbidden"}},
  {...task,tool:"create_file",arguments:{...task.arguments,content:"forbidden"}},
  {...task,tool:"run_tests",arguments:{branch:"feature/account-suspension",profile:"poc-default"}},
  {...task,agent_role:"orchestrator.hidden"},
  {...task,agent_role:"__proto__"}
 ]){
  assert.throws(()=>prepareAuthorization(bad,config,{
   ...base,authorityOnlyAdmissions:owner,
   requestId:()=>"r454-forbidden"
  }),/agent_role is not supported/u);
 }
 assert.equal(store.get("r454-forbidden"),undefined);
});
