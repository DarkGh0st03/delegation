import test from "node:test";
import assert from "node:assert/strict";
import {PILOT_PHASES,verifyPilotRunnerOutcome as verify}
  from "../native-test/verified-pilot-runner-outcome.mjs";
const SHA="a".repeat(40);
function receipt(failed:string|null=null){
  let stopped=false;
  return {
    provider:"runner",performed:true,tool:"run_tests",tested_commit_sha:SHA,
    status:failed?"fail":"pass",
    project_tests:{status:failed?"fail":"pass"},
    researcher_acceptance:{status:failed?"skipped":"pass"},
    phases:PILOT_PHASES.map(phase=>{
      const status=stopped?"skipped":phase===failed?"fail":"pass";
      if(status==="fail")stopped=true;
      return {phase,status};
    })
  };
}
test("Every Docker failure is verified provider evidence, not an authorization denial",()=>{
  for(const phase of PILOT_PHASES)
    assert.equal(verify(receipt(phase),SHA).passed,false);
});
test("Fully passing pinned Docker receipt succeeds",()=>{
  assert.deepEqual(verify(receipt(),SHA),{passed:true});
});
test("Corrupt Runner evidence never upgrades to PASS",()=>{
  const good=receipt(),bad=receipt("typecheck");
  for(const [value,sha] of [
    [{...good,provider:"mock"},SHA],
    [{...good,performed:false},SHA],
    [{...good,tool:"update_file"},SHA],
    [good,"f".repeat(40)],
    [{...good,status:"fail"},SHA],
    [{...bad,status:"pass"},SHA],
    [{...good,project_tests:{status:"fail"}},SHA],
    [{...good,researcher_acceptance:{status:"skipped"}},SHA],
    [{...good,phases:[]},SHA],
    [{...good,phases:good.phases.map(p=>({...p,phase:"unknown"}))},SHA],
    [{...bad,phases:bad.phases.map(p=>({...p,status:"pass"}))},SHA]
  ] as const) assert.throws(()=>verify(value,sha));
});
