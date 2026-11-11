/** Owner-private planning scope from real Runner evidence and original writes.
 * No fault marker, reference implementation, asserted causal file or new grant. */
import {safeAcceptanceFailureSummary} from "../../../runner/acceptance/failure-catalog.mjs";
import {canonicalFileUri} from "../src/canonical.ts";
const PHASES=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const deny=why=>{throw Error("Acceptance repair scope NO-GO: "+why);};
export function collectAcceptanceRepairCandidateScope({effect,testedSha,repo,branch,
 approvedRows,rootPermissions,observedWrites}){
 const summary=safeAcceptanceFailureSummary(effect?.acceptance_failure);
 if(!/^[a-f0-9]{40}$/u.test(testedSha??"")||effect?.provider!=="runner"||
    effect.performed!==true||effect.tool!=="run_tests"||effect.status!=="fail"||
    effect.tested_commit_sha!==testedSha||effect.revision!==testedSha||effect.branch!==branch||
    effect.project_tests?.status!=="pass"||effect.researcher_acceptance?.status!=="fail"||
    !Array.isArray(effect.phases)||effect.phases.length!==PHASES.length||
    effect.phases.some((p,i)=>p?.phase!==PHASES[i]||p.status!==(i===6?"fail":"pass"))||
    !summary||summary.failed_checks.length<1||summary.timed_out||summary.unclassified_failure||
    !Array.isArray(approvedRows)||!Array.isArray(rootPermissions)||
    !["backend","frontend","test"].every(role=>observedWrites?.[role] instanceof Set))
  deny("classified acceptance-only Runner failure and original write ledger required");
 const candidates=[];
 for(const role of ["backend","frontend"]){
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
 return Object.freeze({status:"verified_original_acceptance_repair_scope",
  tested_commit_sha:testedSha,failed_checks:Object.freeze([...summary.failed_checks]),
  causal_attribution:"not_established",candidates:Object.freeze(candidates)});
}
