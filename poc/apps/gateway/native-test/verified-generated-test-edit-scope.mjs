/**
 * Owner-private Test-edit candidates, not a causal diagnosis or permission.
 * Intersect independent Runner FAIL evidence, provider-observed Test creation,
 * and the ORIGINAL signed Engineer grants plus the issued Rust root.
 * The resulting candidates must still pass the signed D1 preflight,
 * Gateway VP verification and OPA before execution.
 */
import {verifiedFailedCreatedTestPaths} from "./verified-failed-generated-test-selection.mjs";
import {canonicalFileUri} from "../src/canonical.ts";

const deny=()=>{throw Error("Generated Test repair candidate scope NO-GO");};
const PHASES=["backend_tests","frontend_tests"];

export function collectSignedGeneratedTestEditScope({
 runnerOutcome,originalCreatedPaths,branch,failedSha,repo,
 approvedRows,rootPermissions
}={}){
 if(!repo||typeof repo.authority!=="string"||
    typeof repo.owner!=="string"||typeof repo.repository!=="string"||
    !Array.isArray(approvedRows)||!Array.isArray(rootPermissions))
  deny();
 const failed=verifiedFailedCreatedTestPaths({
  runnerOutcome,originalCreatedPaths,branch,failedSha
 });
 const phase=runnerOutcome.phases.find(p=>p.status==="fail")?.phase;
 if(!PHASES.includes(phase))deny();
 const branchResource="gitea://"+repo.authority+"/"+repo.owner+"/"+
  repo.repository+"/branches/"+encodeURIComponent(branch);
 const hasRoot=(operation,resource)=>rootPermissions.some(g=>
  g.operation===operation&&g.resource===resource);
 // No implied test-run authority from a project-test failure.
 if(!hasRoot("run_tests",branchResource)||
    !approvedRows.some(g=>g.agent_id==="test"&&g.operation==="run_tests"&&
      g.resource===branchResource))
  deny();
 const candidates=[];
 for(const path of failed){
  const resource=canonicalFileUri(repo,branch,path);
  const pairs=approvedRows.filter(g=>g.agent_id==="test"&&
   g.resource===resource&&["read_file","update_file"].includes(g.operation));
  const taskIds=new Set(pairs.map(p=>p.task_id));
  if(taskIds.size!==1||
     !["read_file","update_file"].every(operation=>
       pairs.some(p=>p.operation===operation)&&hasRoot(operation,resource)))
   continue;
  candidates.push(Object.freeze({role:"test",resource}));
 }
 if(candidates.length<1||candidates.length>8)deny();
 return Object.freeze({
  status:"verified_original_generated_test_edit_scope",
  tested_commit_sha:failedSha,
  project_test_failure:Object.freeze({
   phase,failed_test_file_count:runnerOutcome.failing_test_files.length
  }),
  causal_attribution:"not_established",
  candidates:Object.freeze(candidates)
 });
}
