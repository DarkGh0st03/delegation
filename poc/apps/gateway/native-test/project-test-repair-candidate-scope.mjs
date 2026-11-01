/** Owner-private planning scope from real Runner evidence and original writes.
 * No fault marker, reference implementation, asserted causal file or new grant. */
import {sanitizeVitestFailureFiles} from "../../test-runner-controller/src/vitest-failure-files.ts";
import {canonicalFileUri} from "../src/canonical.ts";
const PHASES=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const deny=why=>{throw Error("Backend test repair scope NO-GO: "+why);};
export function collectProjectTestRepairCandidateScope({effect,testedSha,repo,branch,
 approvedRows,rootPermissions,observedWrites}){
 const files=sanitizeVitestFailureFiles(effect?.failing_test_files,"backend_tests");
 if(!/^[a-f0-9]{40}$/u.test(testedSha??"")||effect?.provider!=="runner"||
    effect.performed!==true||effect.tool!=="run_tests"||effect.status!=="fail"||
    effect.tested_commit_sha!==testedSha||effect.revision!==testedSha||effect.branch!==branch||
    effect.project_tests?.status!=="fail"||effect.researcher_acceptance?.status!=="skipped"||
    !Array.isArray(effect.phases)||effect.phases.length!==PHASES.length||
    effect.phases.some((p,i)=>p?.phase!==PHASES[i]||p.status!==(i<2?"pass":i===2?"fail":"skipped"))||
    files.length<1||effect.acceptance_failure!==undefined||
    (effect.typecheck_error_codes?.length??0)!==0||
    !Array.isArray(approvedRows)||!Array.isArray(rootPermissions)||
    !["backend","frontend","test"].every(role=>observedWrites?.[role] instanceof Set))
  deny("classified Backend test Runner failure and original write ledger required");
 // Every reported failed test must already have an original signed read grant.
 // The new Test still receives run_tests only; no editor gets test rights.
 for(const path of files){
   const resource=canonicalFileUri(repo,branch,path);
   if(!approvedRows.some(g=>["backend","frontend","test"].includes(g.agent_id)&&g.resource===resource&&g.operation==="read_file")||
      !rootPermissions.some(g=>g.resource===resource&&g.operation==="read_file"))
     deny("failed test outside original signed read scope");
 }
 const candidates=[];
 for(const role of ["backend"]){
  for(const path of observedWrites[role]){
   if(typeof path!=="string"||!path||path.length>300||path.includes("\\")||
      path.split("/").some(s=>!s||s==="."||s===".."))
    deny("invalid observed source path");
   // Source investigation must not repair an assertion by rewriting tests.
   if(/(?:^|\/)(?:tests?|__tests__|\.researcher-acceptance)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu.test(path))continue;
   // Ambiguous original writers are not repair candidates. A candidate label
   // cannot move an existing file from one role to another.
   if(["backend","frontend","test"].some(other=>other!==role&&observedWrites[other].has(path)))continue;
   const resource=canonicalFileUri(repo,branch,path);
   const rows=approvedRows.filter(g=>g.agent_id===role&&g.resource===resource&&
     ["read_file","update_file"].includes(g.operation));
   if(new Set(rows.map(g=>g.task_id)).size!==1||
      !["read_file","update_file"].every(operation=>
        rows.some(g=>g.operation===operation)&&
        rootPermissions.some(g=>g.resource===resource&&g.operation===operation)))continue;
   candidates.push(Object.freeze({role,resource}));
  }
 }
 if(candidates.length<1||candidates.length>8)deny("bounded original source candidates unavailable");
 candidates.sort((a,b)=>a.resource.localeCompare(b.resource));
 return Object.freeze({status:"verified_original_project_test_repair_scope",
  tested_commit_sha:testedSha,
  project_test_failure:Object.freeze({phase:"backend_tests",failed_test_file_count:files.length}),
  causal_attribution:"not_established",candidates:Object.freeze(candidates)});
}
