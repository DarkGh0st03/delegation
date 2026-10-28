import test from "node:test";
import assert from "node:assert/strict";
import {normalizeMcpRunTestsOutcome} from "../src/mcp-run-tests-result.ts";
const args={branch:"feature/account-suspension",profile:"poc-default"};
const sha="c".repeat(40);
const result={
  provider:"runner",performed:true,tool:"run_tests",
  branch:args.branch,revision:sha,tested_commit_sha:sha,
  runner_profile:"poc-default",status:"pass",
  phases:[{phase:"backend_tests",status:"pass",passed:2,failed:0}],
  project_tests:{status:"pass",phases:[{phase:"backend_tests",status:"pass"}]},
  researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}
};
function success(v:unknown){
  return normalizeMcpRunTestsOutcome({structuredContent:{ok:true,result:v}},args);
}
test("MCP run_tests accepts exact passing controlled Runner SHA and mandatory gates",()=>{
  assert.deepEqual(success(result),{ok:true,result});
  const invalid=[
    {...result,provider:"mock"}, {...result,tool:"read_file"},
    {...result,branch:"main"}, {...result,revision:"d".repeat(40)},
    {...result,tested_commit_sha:"malformed"}, {...result,runner_profile:"bash"},
    {...result,phases:undefined}, {...result,project_tests:undefined},
    {...result,researcher_acceptance:undefined},
    {...result,researcher_acceptance:{phase:"bogus",status:"pass"}}
  ];
  for(const candidate of invalid){
    const outcome=success(candidate);
    assert.equal(outcome.ok,false);
    if(!outcome.ok)assert.equal(outcome.error.kind,"tool_unavailable");
  }
  assert.equal(normalizeMcpRunTestsOutcome({ok:true,result},args).ok,false);
});
test("MCP run_tests rejects failed project tests and failed researcher acceptance",()=>{
  for(const failure of [
    {...result,status:"fail"},
    {...result,project_tests:{status:"fail",phases:[]}},
    {...result,researcher_acceptance:{phase:"researcher_acceptance",status:"fail"}},
    {...result,researcher_acceptance:{phase:"researcher_acceptance",status:"skipped"}}
  ]){
    const outcome=success(failure);
    assert.equal(outcome.ok,false);
    if(!outcome.ok)assert.equal(outcome.error.kind,"tests_failed");
  }
  for(const kind of ["tests_failed","authorization_denied","invalid_tool_call"] as const){
    const outcome=normalizeMcpRunTestsOutcome({
      isError:true,structuredContent:{ok:false,error:{kind}}
    },args);
    assert.equal(outcome.ok,false);
    if(!outcome.ok)assert.equal(outcome.error.kind,kind);
  }
  const unknown=normalizeMcpRunTestsOutcome({
    isError:true,structuredContent:{ok:false,error:{kind:"secret_internal_error"}}
  },args);
  assert.equal(unknown.ok,false);
  if(!unknown.ok)assert.equal(unknown.error.kind,"tool_unavailable");
});

test("MCP reports only whitelisted failing phase and never private Runner diagnostics",()=>{
  const raw={...result,status:"fail",phases:[
    {phase:"backend_tests",status:"fail",raw_error:"PRIVATE_TEST_LOG",
      source:"NEVER_EXPOSE_SOURCE"}
  ],project_tests:{status:"fail",phases:[]}};
  const outcome=success(raw);
  assert.equal(outcome.ok,false);
  if(outcome.ok)return;
  assert.equal(outcome.error.kind,"tests_failed");
  assert.deepEqual(outcome.error.details,{first_failed_phase:"backend_tests"});
  assert.doesNotMatch(JSON.stringify(outcome),/PRIVATE_TEST_LOG|NEVER_EXPOSE_SOURCE/u);
  const wrong={...raw,phases:[{phase:"/etc/secrets",status:"fail"}]};
  const unknown=success(wrong);
  assert.equal(unknown.ok,false);
  if(!unknown.ok)assert.equal(unknown.error.details,undefined);
});

test("MCP preserves only a whitelisted failure hint from a prior controlled Gateway error",()=>{
  const call=(details:unknown)=>normalizeMcpRunTestsOutcome({
    isError:true,
    structuredContent:{ok:false,error:{kind:"tests_failed",details}}
  },args);
  const safe=call({first_failed_phase:"playwright_e2e",
    tokens:"FORBIDDEN_SIGNED_DELEGATION_DATA",log:"PRIVATE_RUNNER_OUTPUT"});
  assert.equal(safe.ok,false);
  if(!safe.ok){
    assert.deepEqual(safe.error.details,{first_failed_phase:"playwright_e2e"});
    assert.doesNotMatch(JSON.stringify(safe),/FORBIDDEN_SIGNED_DELEGATION_DATA|PRIVATE_RUNNER_OUTPUT/u);
  }
  for(const bogus of [
    {first_failed_phase:"../../private/keys"},
    {first_failed_phase:"typecheck",extra:"ignored"},
    {first_failed_phase:17}
  ]){
    const outcome=call(bogus);
    assert.equal(outcome.ok,false);
    if(!outcome.ok){
      if(bogus.first_failed_phase==="typecheck")
        assert.deepEqual(outcome.error.details,{first_failed_phase:"typecheck"});
      else assert.equal(outcome.error.details,undefined);
    }
  }
});

test("TypeScript failures show only signed read grants, never other paths",()=>{
  const allowed="tests/backend/repair.test.ts";
  const privateContent="PRIVATE_SOURCE_CODE";
  const data={isError:true,structuredContent:{ok:false,error:{
    kind:"tests_failed",details:{first_failed_phase:"typecheck",
      typecheck_diagnostics:[
        {path:allowed,line:42,column:3,code:"TS2304"},
        {path:"apps/backend/src/private.ts",line:20,column:4,code:"TS2322"},
        {path:allowed,line:1,column:1,code:"TS7006",raw:privateContent}
      ]}
  }}};
  const scoped=normalizeMcpRunTestsOutcome(data,args,[allowed]);
  assert.equal(scoped.ok,false);
  if(!scoped.ok)assert.deepEqual(scoped.error.details,{
    first_failed_phase:"typecheck",
    typecheck_diagnostics:[{path:allowed,line:42,column:3,code:"TS2304"}]
  });
  assert.ok(!JSON.stringify(scoped).includes(privateContent));
  const noGrant=normalizeMcpRunTestsOutcome(data,args);
  if(!noGrant.ok)assert.deepEqual(noGrant.error.details,{
    first_failed_phase:"typecheck"
  });
});
