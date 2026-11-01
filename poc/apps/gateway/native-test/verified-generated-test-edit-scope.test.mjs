import test from "node:test";
import assert from "node:assert/strict";
import {collectSignedGeneratedTestEditScope as collect}
 from "./verified-generated-test-edit-scope.mjs";
import {canonicalFileUri} from "../src/canonical.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/dynamic",sha="a".repeat(40);
const first="tests/backend/first.test.ts",second="tests/backend/second.test.ts";
const branchResource="gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fdynamic";
const resource=path=>canonicalFileUri(repo,branch,path);
const phases=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"]
 .map((phase,i)=>({phase,status:i<2?"pass":i===2?"fail":"skipped"}));
const outcome={provider:"runner",performed:true,tool:"run_tests",status:"fail",
 project_tests:{status:"fail"},researcher_acceptance:{status:"skipped"},
 tested_commit_sha:sha,revision:sha,branch,phases,failing_test_files:[first,second]};
const grant=(operation,path,task_id="original-test")=>({
 task_id,agent_id:"test",operation,resource:path
});
function fixture(){
 const rows=[
  grant("create_file",resource(first)),
  grant("read_file",resource(first)),
  grant("update_file",resource(first)),
  grant("create_file",resource(second)),
  grant("run_tests",branchResource)
 ];
 return {runnerOutcome:structuredClone(outcome),
  originalCreatedPaths:new Set([first,second]),branch,failedSha:sha,repo,
  approvedRows:rows,rootPermissions:structuredClone(rows)};
}
test("Only failed generated tests with original signed read/update grants are candidates",()=>{
 const scope=collect(fixture());
 assert.deepEqual(scope,{
  status:"verified_original_generated_test_edit_scope",
  tested_commit_sha:sha,project_test_failure:{phase:"backend_tests",failed_test_file_count:2},
  causal_attribution:"not_established",
  candidates:[{role:"test",resource:resource(first)}]
 });
 assert.ok(Object.isFrozen(scope.candidates));
 assert.ok(!JSON.stringify(scope).includes(resource(second)));
});
test("A create_file-only Test grant cannot authorize future update_file",()=>{
 for(const ledger of ["approvedRows","rootPermissions"]){
  const f=fixture();f[ledger]=f[ledger].filter(g=>
   g.operation!=="update_file"||g.resource!==resource(first));
  assert.throws(()=>collect(f),/candidate scope NO-GO/);
 }
 const f=fixture();
 f.approvedRows=f.approvedRows.map(g=>g.operation==="update_file"
  ?{...g,agent_id:"backend"}:g);
 assert.throws(()=>collect(f),/candidate scope NO-GO/);
});
test("A failed test does not itself grant run_tests or overcome wrong revision",()=>{
 const cases=[
  x=>{x.originalCreatedPaths=new Set(["tests/backend/unrelated.test.ts"]);},
  x=>{x.failedSha="b".repeat(40);},
  x=>{x.runnerOutcome.provider="agent";},
  x=>{x.approvedRows=x.approvedRows.filter(p=>p.operation!=="run_tests");},
  x=>{x.rootPermissions=x.rootPermissions.filter(p=>p.operation!=="run_tests");},
  x=>{x.runnerOutcome.failing_test_files.push("tests/backend/../external.test.ts");}
 ];
 for(const mutate of cases){
  const x=fixture();mutate(x);
  assert.throws(()=>collect(x),/NO-GO/);
 }
});
test("Two preapproved Test files are distinct candidates, never a fault diagnosis",()=>{
 const x=fixture();
 for(const operation of ["read_file","update_file"]){
  const g=grant(operation,resource(second));
  x.approvedRows.push(g);x.rootPermissions.push(g);
 }
 const scope=collect(x);
 assert.deepEqual(scope.candidates.map(c=>c.resource),[resource(first),resource(second)]);
 assert.equal(scope.causal_attribution,"not_established");
});
