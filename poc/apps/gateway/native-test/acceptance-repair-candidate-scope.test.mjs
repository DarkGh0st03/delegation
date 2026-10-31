import test from "node:test";
import assert from "node:assert/strict";
import {collectAcceptanceRepairCandidateScope as collect} from "./acceptance-repair-candidate-scope.mjs";
const repo={authority:"gitea.local",owner:"tenant",repository:"payments"},branch="feature/maintenance";
const sha="a".repeat(40),base="gitea://gitea.local/tenant/payments/branches/feature%2Fmaintenance/files/";
const paths={backend:"src/service.ts",frontend:"ui/actions.tsx",other:"src/without-read.ts"};
const perms=(path,role)=>["read_file","update_file"].map(operation=>({task_id:role,
 agent_id:role,operation,resource:base+path}));
const rows=[...perms(paths.backend,"backend"),...perms(paths.frontend,"frontend")];
const effect={provider:"runner",performed:true,tool:"run_tests",status:"fail",branch,
 tested_commit_sha:sha,revision:sha,project_tests:{status:"pass"},researcher_acceptance:{status:"fail"},
 phases:["dependency_install","typecheck","backend_tests","frontend_tests","build",
  "playwright_e2e","researcher_acceptance"].map((phase,i)=>({phase,status:i===6?"fail":"pass"})),
 acceptance_failure:{failed_checks:["ui_pending_actions"],timed_out:false,unclassified_failure:false}};
const config={effect,testedSha:sha,repo,branch,approvedRows:rows,rootPermissions:rows,
 observedWrites:{backend:new Set([paths.backend,paths.other]),frontend:new Set([paths.frontend]),test:new Set()}};

test("Actual original writes/root pairs yield candidates without fixture knowledge or causal attribution",()=>{
 const result=collect(config);
 assert.equal(result.status,"verified_original_acceptance_repair_scope");
 assert.equal(result.causal_attribution,"not_established");
 assert.deepEqual(result.failed_checks,["ui_pending_actions"]);
 assert.deepEqual(new Set(result.candidates.map(c=>c.resource)),new Set([base+paths.backend,base+paths.frontend]));
 assert.equal(result.candidates.length,2);
 assert.ok(Object.isFrozen(result.candidates));
 assert.equal(JSON.stringify(result).includes("without-read"),false);
 // Check IDs do not hardcode a source path or automatically force a writer.
 const other=collect({...config,effect:{...effect,acceptance_failure:{...effect.acceptance_failure,
  failed_checks:["service_persistence"]}}});
 assert.deepEqual(other.candidates,result.candidates);
});

test("Unobserved, ambiguous or incompletely signed writes cannot enter candidate scope",()=>{
 const result=collect({...config,observedWrites:{...config.observedWrites,
  test:new Set([paths.backend])}});
 assert.deepEqual(result.candidates,[{role:"frontend",resource:base+paths.frontend}]);
 for(const bad of [
  {...config,rootPermissions:[]},
  {...config,observedWrites:{backend:new Set(),frontend:new Set(),test:new Set()}},
  {...config,approvedRows:rows.map(g=>({...g,task_id:g.operation}))},
  {...config,observedWrites:{...config.observedWrites,backend:new Set(["../outside.ts"])}},
  {...config,testedSha:"b".repeat(40)},
  {...config,effect:{...effect,performed:false}},
  {...config,effect:{...effect,revision:"b".repeat(40)}},
  {...config,effect:{...effect,project_tests:{status:"fail"}}},
  {...config,effect:{...effect,acceptance_failure:{...effect.acceptance_failure,timed_out:true}}},
  {...config,effect:{...effect,acceptance_failure:{...effect.acceptance_failure,unclassified_failure:true}}},
  {...config,effect:{...effect,phases:effect.phases.slice(1)}}
 ])assert.throws(()=>collect(bad),/NO-GO/u);
});


test("Project test files stay outside acceptance source repair even with an original Backend write",()=>{
 const path="tests/backend/contracts.test.ts";
 const granted=perms(path,"backend");
 const result=collect({...config,approvedRows:[...rows,...granted],rootPermissions:[...rows,...granted],
  observedWrites:{...config.observedWrites,backend:new Set([...config.observedWrites.backend,path])}});
 assert.equal(result.candidates.some(candidate=>candidate.resource===base+path),false);
});
