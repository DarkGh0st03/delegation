/** Owner-private planning scope from real Runner evidence and original writes.
 * No fault marker, reference implementation, asserted causal file or new grant. */
import {sanitizeVitestFailureFiles} from "../../test-runner-controller/src/vitest-failure-files.ts";
import {canonicalFileUri} from "../src/canonical.ts";
const PHASES=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const deny=why=>{throw Error("Project test repair scope NO-GO: "+why);};
export function collectProjectTestRepairCandidateScope({effect,testedSha,repo,branch,
 approvedRows,rootPermissions,observedWrites}){
 const phase=Array.isArray(effect?.phases)?effect.phases.find(p=>p?.status==="fail")?.phase:undefined;
 const supported=phase==="backend_tests"||phase==="frontend_tests";
 const role=phase==="frontend_tests"?"frontend":"backend";
 const failedIndex=PHASES.indexOf(phase);
 const files=supported?sanitizeVitestFailureFiles(effect?.failing_test_files,phase):[];
 if(!supported||!/^[a-f0-9]{40}$/u.test(testedSha??"")||effect?.provider!=="runner"||
    effect.performed!==true||effect.tool!=="run_tests"||effect.status!=="fail"||
    effect.tested_commit_sha!==testedSha||effect.revision!==testedSha||effect.branch!==branch||
    effect.project_tests?.status!=="fail"||effect.researcher_acceptance?.status!=="skipped"||
    !Array.isArray(effect.phases)||effect.phases.length!==PHASES.length||
    effect.phases.some((p,i)=>p?.phase!==PHASES[i]||p.status!==(i<failedIndex?"pass":i===failedIndex?"fail":"skipped"))||
    files.length<1||effect.acceptance_failure!==undefined||
    (effect.typecheck_error_codes?.length??0)!==0||
    !Array.isArray(approvedRows)||!Array.isArray(rootPermissions)||
    !["backend","frontend","test"].every(role=>observedWrites?.[role] instanceof Set))
  deny("classified project test Runner failure and original write ledger required");
 // Every reported failed test must already have an original signed read grant.
 // The new Test still receives run_tests only; no editor gets test rights.
 for(const path of files){
   const resource=canonicalFileUri(repo,branch,path);
   if(!approvedRows.some(g=>["backend","frontend","test"].includes(g.agent_id)&&g.resource===resource&&g.operation==="read_file")||
      !rootPermissions.some(g=>g.resource===resource&&g.operation==="read_file"))
     deny("failed test outside original signed read scope");
 }
 const candidates=[];
 for(const candidateRole of [role]){
  for(const path of observedWrites[candidateRole]){
   if(typeof path!=="string"||!path||path.length>300||path.includes("\\")||
      path.split("/").some(s=>!s||s==="."||s===".."))
    deny("invalid observed source path");
   // Source investigation must not repair an assertion by rewriting tests.
   if(/(?:^|\/)(?:tests?|__tests__|\.researcher-acceptance)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu.test(path))continue;
   // Ambiguous original writers are not repair candidates. A candidate label
   // cannot move an existing file from one role to another.
   if(["backend","frontend","test"].some(other=>other!==candidateRole&&observedWrites[other].has(path)))continue;
   const resource=canonicalFileUri(repo,branch,path);
   const rows=approvedRows.filter(g=>g.agent_id===candidateRole&&g.resource===resource&&
     ["read_file","update_file"].includes(g.operation));
   if(new Set(rows.map(g=>g.task_id)).size!==1||
      !["read_file","update_file"].every(operation=>
        rows.some(g=>g.operation===operation)&&
        rootPermissions.some(g=>g.resource===resource&&g.operation===operation)))continue;
   candidates.push(Object.freeze({role:candidateRole,resource}));
  }
 }
 if(candidates.length<1||candidates.length>8)deny("bounded original source candidates unavailable");
 candidates.sort((a,b)=>a.resource.localeCompare(b.resource));
 return Object.freeze({status:"verified_original_project_test_repair_scope",
  tested_commit_sha:testedSha,
  project_test_failure:Object.freeze({phase,failed_test_file_count:files.length}),
  causal_attribution:"not_established",candidates:Object.freeze(candidates)});
}
