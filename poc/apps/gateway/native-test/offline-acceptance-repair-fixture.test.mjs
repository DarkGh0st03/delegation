import test from "node:test";
import assert from "node:assert/strict";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES as files} from "../../test-runner-controller/fixtures/account-suspension-reference.mjs";
import {injectAcceptanceFault,repairAcceptanceFault,ACCEPTANCE_ORIGINAL,ACCEPTANCE_FAULT,
 nominateOfflineAcceptanceRepair} from "./offline-acceptance-repair-fixture.mjs";

const path="apps/backend/src/users/user.service.ts",branch="feature/acceptance",testedSha="a".repeat(40);
const repo={authority:"gitea.local",owner:"thesis",repository:"iam"};
const resource="gitea://gitea.local/thesis/iam/branches/feature%2Facceptance/files/"+path;
const summary={failed_checks:["service_persistence"],timed_out:false,unclassified_failure:false};
const phases=["dependency_install","typecheck","backend_tests","frontend_tests","build",
 "playwright_e2e","researcher_acceptance"].map((phase,i)=>({phase,status:i===6?"fail":"pass"}));
const effect={status:"fail",branch,tested_commit_sha:testedSha,phases,
 project_tests:{status:"pass"},researcher_acceptance:{status:"fail"},acceptance_failure:summary};
const rows=["read_file","update_file"].map(operation=>({agent_id:"backend",task_id:"backend",
 resource,operation}));
const config={effect,testedSha,path,repo,branch,approvedRows:rows,rootPermissions:rows,
 observedWrites:{backend:new Set([path]),frontend:new Set(),test:new Set()}};

test("Semantic fixture alters only lifecycle email persistence and repairs observed source exactly",()=>{
 const source=files[path],fault=injectAcceptanceFault(source);
 assert.ok(source.includes(ACCEPTANCE_ORIGINAL));
 assert.equal(fault.includes(ACCEPTANCE_ORIGINAL),false);
 assert.ok(fault.includes(ACCEPTANCE_FAULT));
 assert.equal(repairAcceptanceFault(fault),source);
 assert.throws(()=>injectAcceptanceFault(fault),/NO-GO/u);
 assert.throws(()=>repairAcceptanceFault(source),/NO-GO/u);
 assert.throws(()=>repairAcceptanceFault(fault+fault),/NO-GO/u);
});

test("Only exact acceptance FAIL and an observed original root-scoped writer nominate a fixture candidate",()=>{
 assert.deepEqual(nominateOfflineAcceptanceRepair(config),{
  status:"verified_acceptance_single_file_repair_candidate",tested_commit_sha:testedSha,
  role:"backend",resource,failed_checks:["service_persistence"]});
 for(const bad of [
  {...config,testedSha:"b".repeat(40)},
  {...config,effect:{...effect,project_tests:{status:"fail"}}},
  {...config,effect:{...effect,acceptance_failure:{...summary,timed_out:true}}},
  {...config,effect:{...effect,acceptance_failure:{...summary,failed_checks:["ui_state_actions"]}}},
  {...config,effect:{...effect,phases:phases.slice(1)}},
  {...config,rootPermissions:rows.filter(g=>g.operation!=="update_file")},
  {...config,approvedRows:rows.map(g=>({...g,task_id:g.operation}))},
  {...config,observedWrites:{...config.observedWrites,frontend:new Set([path])}},
  {...config,observedWrites:{backend:new Set(),frontend:new Set(),test:new Set()}}
 ])assert.throws(()=>nominateOfflineAcceptanceRepair(bad),/NO-GO/u);
});
