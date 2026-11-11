/** Zero-billing fault fixture only. Never selects or patches paid Gemini code. */
import {safeAcceptanceFailureSummary} from "../../../runner/acceptance/failure-catalog.mjs";
import {canonicalFileUri} from "../src/canonical.ts";

export const ACCEPTANCE_ORIGINAL = 'return this.repository.save({ ...user, status: nextStatus });';
export const ACCEPTANCE_FAULT = 'return this.repository.save({ ...user, status: nextStatus, email: "acceptance-fault@example.test" });';
const PHASES=["dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"];
const deny=why=>{throw Error("Offline acceptance fixture NO-GO: "+why);};
function replaceOnce(source,from,to){
 if(typeof source!=="string"||source.split(from).length!==2||source.includes(to))
  deny("missing, duplicated or ambiguous lifecycle source");
 return source.replace(from,to);
}
export const injectAcceptanceFault=source=>replaceOnce(source,ACCEPTANCE_ORIGINAL,ACCEPTANCE_FAULT);
export const repairAcceptanceFault=source=>replaceOnce(source,ACCEPTANCE_FAULT,ACCEPTANCE_ORIGINAL);

/** The seeded fixture chooses its original file, not a causal inference from a
 * requirement label. Actual failed phase, same SHA, original signed writer and
 * root read/update pairs are independently required. No authority is created. */
export function nominateOfflineAcceptanceRepair({effect,testedSha,path,repo,branch,
 approvedRows,rootPermissions,observedWrites}){
 const summary=safeAcceptanceFailureSummary(effect?.acceptance_failure);
 if(!/^[a-f0-9]{40}$/u.test(testedSha??"")||effect?.status!=="fail"||
    effect.tested_commit_sha!==testedSha||effect.branch!==branch||
    effect.project_tests?.status!=="pass"||effect.researcher_acceptance?.status!=="fail"||
    !Array.isArray(effect.phases)||effect.phases.length!==PHASES.length||
    effect.phases.some((p,i)=>p.phase!==PHASES[i]||p.status!==(i===6?"fail":"pass"))||
    !summary||summary.timed_out||summary.unclassified_failure||
    summary.failed_checks.join(",")!=="service_persistence")
  deny("expected classified acceptance-only failure on exact current SHA");
 const resource=canonicalFileUri(repo,branch,path);
 const writers=["backend","frontend","test"].filter(role=>observedWrites?.[role]?.has(path));
 const rows=approvedRows.filter(g=>g.resource===resource&&
  ["read_file","update_file"].includes(g.operation)&&g.agent_id==="backend");
 const taskIds=new Set(rows.map(g=>g.task_id));
 if(writers.join(",")!=="backend"||taskIds.size!==1||
    !["read_file","update_file"].every(operation=>
      rows.some(g=>g.operation===operation)&&
      rootPermissions.some(g=>g.operation===operation&&g.resource===resource)))
  deny("original single Backend writer and exact root read/update required");
 return Object.freeze({status:"verified_acceptance_single_file_repair_candidate",
  tested_commit_sha:testedSha,role:"backend",resource,
  failed_checks:Object.freeze([...summary.failed_checks])});
}
