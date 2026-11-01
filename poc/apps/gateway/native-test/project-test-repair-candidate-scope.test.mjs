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
test("Wrong phase, missing locations, unsupported test scope and ambiguous writers cannot authorize project repair",()=>{
 for(const bad of [
  {...config,effect:{...effect,failing_test_files:[]}},
  {...config,effect:{...effect,failing_test_files:["tests/backend/outside.test.ts"]}},
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
