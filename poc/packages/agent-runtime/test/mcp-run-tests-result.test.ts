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
