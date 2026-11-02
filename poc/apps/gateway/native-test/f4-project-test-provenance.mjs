/** F4, owner-private provenance matrix for one authenticated project-test
 * failure. This is neither fault attribution nor an authorization decision.
 * Paths from Runner/agent data are used ONLY for set intersections; the
 * returned result contains no paths, test messages or source content. */
import {sanitizeVitestFailureFiles}
 from "../../test-runner-controller/src/vitest-failure-files.ts";
const SHA=/^[a-f0-9]{40}$/u;
const PHASES=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const denied=()=>{throw Error("F4 project-test provenance NO-GO");};
const validPath=p=>typeof p==="string"&&p.length>0&&p.length<=300&&
 !p.startsWith("/")&&!p.includes("\\")&&!p.includes("//")&&
 p.split("/").every(s=>s.length>0&&s!=="."&&s!=="..");
const testPath=p=>/(?:^|\\/)(?:tests?|__tests__)(?:\\/|$)|\\.(?:test|spec)\\.[^/]+$/iu.test(p);
export function corroborateF4ProjectTestProvenance({
 runnerOutcome,testedSha,branch,observedWrites,observedTestCreates
}={}){
 const r=runnerOutcome;
 if(!SHA.test(testedSha??"")||typeof branch!=="string"||!branch||
    !r||r.provider!=="runner"||r.performed!==true||
    r.tool!=="run_tests"||r.status!=="fail"||
    r.branch!==branch||r.revision!==testedSha||
    r.tested_commit_sha!==testedSha||
    r.project_tests?.status!=="fail"||
    r.researcher_acceptance?.status!=="skipped"||
    r.acceptance_failure!==undefined||
    !Array.isArray(r.phases)||r.phases.length!==PHASES.length||
    !observedWrites||!["backend","frontend","test"].every(role=>
       observedWrites[role] instanceof Set)||
    !(observedTestCreates instanceof Set)||
    observedTestCreates.size>32)denied();
 const failedPhase=r.phases.find(p=>p?.status==="fail")?.phase;
 const idx=PHASES.indexOf(failedPhase);
 if(!["backend_tests","frontend_tests"].includes(failedPhase)||
    r.phases.some((p,i)=>p?.phase!==PHASES[i]||
      p.status!==(i<idx?"pass":i===idx?"fail":"skipped"))||
    (r.typecheck_error_codes?.length??0)!==0)denied();
 const raw=r.failing_test_files;
 const failed=sanitizeVitestFailureFiles(raw,failedPhase);
 if(!Array.isArray(raw)||!failed.length||failed.length!==raw.length||
    failed.length>8||new Set(failed).size!==failed.length||
    !Object.values(observedWrites).every(set=>
      set.size<=64&&[...set].every(validPath))||
    [...observedTestCreates].some(p=>
      !validPath(p)||!testPath(p)||!observedWrites.test.has(p)))
   denied();
 const role=failedPhase==="backend_tests"?"backend":"frontend";
 const source=[...observedWrites[role]].filter(p=>
    !testPath(p)&&!observedWrites.test.has(p)&&
    !observedWrites[role==="backend"?"frontend":"backend"].has(p));
 const generated=failed.filter(p=>observedTestCreates.has(p));
 const written=failed.filter(p=>observedWrites.test.has(p));
 const counterpart=source.length>0;
 const created=generated.length>0;
 const routes=counterpart&&created?["source_investigation","generated_test_investigation"]:
   counterpart?["source_investigation"]:
   created?["generated_test_investigation"]:[];
 return Object.freeze({
  status:"f4_verified_runner_provenance",
  tested_commit_sha:testedSha,failed_phase:failedPhase,
  failed_test_file_count:failed.length,
  original_source_write_candidate_count:source.length,
  failed_test_written_by_test_count:written.length,
  failed_test_created_by_test_count:generated.length,
  possible_investigations:Object.freeze(routes),
  causal_attribution:"not_established",
  permissions_issued:false,
  repair_task_created:false
 });
}
