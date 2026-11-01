import test from "node:test";
import assert from "node:assert/strict";
import {collectProjectTestRepairCandidateScope as collect} from "./project-test-repair-candidate-scope.mjs";
import {injectProjectTestFault,repairProjectTestFault,PROJECT_TEST_FAULT} from "./offline-project-test-repair-fixture.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES as reference} from "../../test-runner-controller/fixtures/account-suspension-reference.mjs";
const repo={authority:"gitea.local",owner:"tenant",repository:"billing"},branch="feature/behavior";
const sha="a".repeat(40),base="gitea://gitea.local/tenant/billing/branches/feature%2Fbehavior/files/";
const file="src/service.ts",testFile="tests/backend/behavior.test.ts",ui="ui/actions.tsx";
const perms=(path,role)=>["read_file","update_file"].map(operation=>({task_id:role,
 agent_id:role,operation,resource:base+path}));
const rows=[...perms(file,"backend"),...perms(testFile,"backend"),...perms(ui,"frontend")];
const effect={provider:"runner",performed:true,tool:"run_tests",status:"fail",branch,
 tested_commit_sha:sha,revision:sha,project_tests:{status:"fail"},researcher_acceptance:{status:"skipped"},
 phases:["dependency_install","typecheck","backend_tests","frontend_tests","build",
  "playwright_e2e","researcher_acceptance"].map((phase,i)=>({phase,status:i<2?"pass":i===2?"fail":"skipped"})),
 failing_test_files:[testFile]};
const config={effect,testedSha:sha,repo,branch,approvedRows:rows,rootPermissions:rows,
 observedWrites:{backend:new Set([file,testFile]),frontend:new Set([ui]),test:new Set()}};

test("Backend Runner failure yields original source candidates, without exposing or granting test paths",()=>{
 const result=collect(config);
 assert.deepEqual(result,{status:"verified_original_project_test_repair_scope",tested_commit_sha:sha,
  project_test_failure:{phase:"backend_tests",failed_test_file_count:1},
  causal_attribution:"not_established",candidates:[{role:"backend",resource:base+file}]});
 assert.ok(Object.isFrozen(result.candidates));
 assert.equal(JSON.stringify(result).includes(testFile),false);
});
test("Wrong phase, missing locations and ambiguous writers cannot authorize project repair",()=>{
 for(const bad of [
  {...config,effect:{...effect,failing_test_files:[]}},
  {...config,effect:{...effect,failing_test_files:["tests/backend/../outside.test.ts"]}},
  {...config,effect:{...effect,typecheck_error_codes:["TS2339"]}},
  {...config,effect:{...effect,revision:"b".repeat(40)}},
  {...config,effect:{...effect,project_tests:{status:"pass"}}},
  {...config,effect:{...effect,phases:effect.phases.map(p=>p.phase==="typecheck"?{...p,status:"fail"}:p)}},
  {...config,effect:{...effect,phases:effect.phases.map(p=>p.phase==="build"?{...p,status:"pass"}:p)}},
  {...config,rootPermissions:rows.filter(g=>g.resource!==base+file)},
  {...config,observedWrites:{...config.observedWrites,frontend:new Set([ui,file])}},
  {...config,approvedRows:rows.map(g=>({...g,task_id:g.operation}))}
 ])assert.throws(()=>collect(bad),/NO-GO/);
});
test("Backend fixture changes only the actual lifecycle save and restores source bytes exactly",()=>{
 const source=reference["apps/backend/src/users/user.service.ts"];
 const faulty=injectProjectTestFault(source);
 assert.ok(faulty.includes(PROJECT_TEST_FAULT));
 assert.equal(repairProjectTestFault(faulty),source);
 assert.throws(()=>injectProjectTestFault(faulty),/NO-GO/);
 assert.throws(()=>repairProjectTestFault(source),/NO-GO/);
 assert.throws(()=>repairProjectTestFault(faulty+faulty),/NO-GO/);
});

test("Frontend test failures select only original Frontend source writers and keep Backend excluded",()=>{
 const frontTest="tests/frontend/controls.test.tsx";
 const frontRows=[...rows,...perms(frontTest,"frontend")];
 const frontEffect={...effect,failing_test_files:[frontTest],phases:effect.phases.map((p,i)=>({
  phase:p.phase,status:i<3?"pass":i===3?"fail":"skipped"}))};
 const frontConfig={...config,effect:frontEffect,approvedRows:frontRows,rootPermissions:frontRows,
  observedWrites:{...config.observedWrites,frontend:new Set([ui,frontTest])}};
 const collected=collect(frontConfig);
 assert.deepEqual(collected.candidates,[{role:"frontend",resource:base+ui}]);
 assert.deepEqual(collected.project_test_failure,{phase:"frontend_tests",failed_test_file_count:1});
 assert.equal(JSON.stringify(collected).includes(frontTest),false);
 for(const bad of [
  {...frontConfig,effect:{...frontEffect,failing_test_files:[testFile]}},
  {...frontConfig,effect:{...frontEffect,phases:frontEffect.phases.map(p=>p.phase==="backend_tests"?{...p,status:"fail"}:p)}},
  {...frontConfig,observedWrites:{...frontConfig.observedWrites,backend:new Set([file,ui])}},
  {...frontConfig,approvedRows:frontRows.map(g=>g.resource===base+ui?{...g,agent_id:"backend"}:g)},
  {...frontConfig,effect:{...frontEffect,phases:"PRIVATE"}}
 ])assert.throws(()=>collect(bad),/NO-GO/);
});
test("Frontend fixture inverts only the observed lifecycle UI condition and repairs exact source",async()=>{
 const {injectFrontendTestFault,repairFrontendTestFault,FRONTEND_TEST_FAULT}=await import("./offline-project-test-repair-fixture.mjs");
 const source=reference["apps/frontend/src/pages/UserDetailPage.tsx"],fault=injectFrontendTestFault(source);
 assert.ok(fault.includes(FRONTEND_TEST_FAULT));
 assert.equal(repairFrontendTestFault(fault),source);
 assert.throws(()=>injectFrontendTestFault(fault),/NO-GO/);
 assert.throws(()=>repairFrontendTestFault(source),/NO-GO/);
 assert.throws(()=>repairFrontendTestFault(fault+fault),/NO-GO/);
});

 test("Two failed generated tests without read grants remain evidence, never permissions",()=>{
  const generated=["tests/backend/generated-a.test.ts","tests/backend/generated-b.test.ts"];
  const createGrants=generated.map(path=>({task_id:"tests",agent_id:"test",
   resource:base+path,operation:"create_file"}));
  const sourceRows=perms(file,"backend");
  const result=collect({...config,effect:{...effect,failing_test_files:generated},
   approvedRows:[...sourceRows,...createGrants],rootPermissions:[...sourceRows,...createGrants],
   observedWrites:{backend:new Set([file]),frontend:new Set(),test:new Set(generated)}});
  assert.deepEqual(result.candidates,[{role:"backend",resource:base+file}]);
  assert.equal(result.project_test_failure.failed_test_file_count,2);
  assert.equal(result.causal_attribution,"not_established");
  for(const path of generated)assert.equal(JSON.stringify(result).includes(path),false);
  // Diagnostics cannot add a source read or write grant to either ledger.
  for(const operation of ["read_file","update_file"]){
   for(const ledger of ["approvedRows","rootPermissions"]){
    assert.throws(()=>collect({...config,effect:{...effect,failing_test_files:generated},
     [ledger]:rows.filter(g=>!(g.resource===base+file&&g.operation===operation))}),/NO-GO/);
   }
  }
 });


test("Generated failing tests get provenance-only counts, not edit grants or causal attribution",()=>{
 const generated=["tests/backend/fresh-first.test.ts","tests/backend/fresh-second.test.ts"];
 const creation=generated.map(path=>({task_id:"create-tests",agent_id:"test",
  resource:base+path,operation:"create_file"}));
 const signedSource=perms(file,"backend");
 const input={...config,effect:{...effect,failing_test_files:generated},
  approvedRows:[...signedSource,...creation],
  rootPermissions:[...signedSource,...creation],
  observedWrites:{backend:new Set([file]),frontend:new Set(),test:new Set(generated)},
  observedTestCreates:new Set(generated)};
 const result=collect(input);
 assert.deepEqual(result.test_failure_provenance,{
  failed_test_written_by_test_count:2,failed_test_created_by_test_count:2,
  created_test_without_approved_rewrite_count:2,causal_attribution:"not_established"
 });
 assert.deepEqual(result.candidates,[{role:"backend",resource:base+file}]);
 for(const path of generated)assert.equal(JSON.stringify(result).includes(path),false);
 // The original Engineer may have approved explicit test editing in addition
 // to create_file; that reduces approval needs, but does not prove causality.
 const granted=[...creation,...["read_file","update_file"].map(operation=>({
  task_id:"edit-tests",agent_id:"test",resource:base+generated[0],operation
 }))];
 const permitted=collect({...input,approvedRows:[...signedSource,...granted],
  rootPermissions:[...signedSource,...granted]});
 assert.equal(permitted.test_failure_provenance.created_test_without_approved_rewrite_count,1);
 assert.equal(permitted.test_failure_provenance.causal_attribution,"not_established");
 assert.throws(()=>collect({...input,observedTestCreates:new Set(["foreign.test.ts"])}),
  /creation provenance/);
});
