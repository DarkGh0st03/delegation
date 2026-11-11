/**
 * R303.2 — strict authenticated Runner PASS classification for future
 * authority-only Test Task completion. This code is not a Docker executor
 * and does not authenticate signed Rust DCs or create an HMAC receipt.
 *
 * RunnerClient itself binds an authenticated HTTPS/owner-only bearer request
 * to the exact returned object. A PASS claim alone (even from the service)
 * is insufficient without all fixed phases and researcher acceptance.
 */
import {RunnerClient,assertTrustedRunnerClientResult,
 type RunnerClientRequest,type RunnerClientResult}
 from "./runner-client.ts";
export interface VerifiedRunnerPass{
 readonly status:"owner_verified_runner_pass_staged";
 readonly request_id:string;readonly repository:string;
 readonly branch:string;readonly tested_commit_sha:string;
 readonly runner_profile:"poc-default";
 readonly all_project_tests_passed:true;
 readonly researcher_acceptance_passed:true;
 readonly completed_phases:readonly string[];
 readonly log_reference:string;
 readonly runner_execution_authorized:false;
}
const PROJECT=[
 "dependency_install","typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e"
] as const;
function deny(s:string):never{
 throw Error("Authority-only Runner PASS evidence NO-GO: "+s);
}
export function validateTrustedRunnerPass(
 client:RunnerClient,request:RunnerClientRequest,result:RunnerClientResult
):VerifiedRunnerPass{
 if(!(client instanceof RunnerClient)||
    !request||typeof request!=="object"||
    !result||typeof result!=="object")
  deny("independent authenticated RunnerClient result required");
 // The exact same original JS object must come from the owner-injected
 // RunnerClient.run() call. Copies and altered responses are rejected.
 assertTrustedRunnerClientResult(client,request,result);
 if(request.profile!=="poc-default"||
    !/^[a-f0-9]{40}$/u.test(request.commit_sha)||
    result.runner_profile!=="poc-default"||
    result.status!=="pass"||
    !result.project_tests||
    result.project_tests.status!=="pass"||
    result.researcher_acceptance?.phase!=="researcher_acceptance"||
    result.researcher_acceptance.status!=="pass"||
    !/^runner-log:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
       .test(result.log_reference??"")||
    result.acceptance_failure!==undefined||
    result.project_e2e_failure!==undefined||
    result.failing_test_files!==undefined||
    result.typecheck_diagnostics!==undefined||
    result.typecheck_error_codes!==undefined)
  deny("Runner PASS claim is incomplete or contains failure evidence");
 if(!Array.isArray(result.phases)||
    result.phases.length!==PROJECT.length+1||
    !Array.isArray(result.project_tests.phases)||
    result.project_tests.phases.length!==PROJECT.length)
  deny("all pinned Runner phases and acceptance must be present");
 for(let i=0;i<PROJECT.length;i++){
  const p=result.phases[i],q=result.project_tests.phases[i];
  if(p.phase!==PROJECT[i]||q.phase!==PROJECT[i]||
     p.status!=="pass"||q.status!=="pass"||
     (p.failed??0)!==0||(q.failed??0)!==0)
   deny("fixed Runner project phase skipped, duplicated, reordered or failed");
 }
 const researcher=result.phases[PROJECT.length];
 if(researcher.phase!=="researcher_acceptance"||
    researcher.status!=="pass"||
    (researcher.failed??0)!==0)
  deny("researcher acceptance not independently reported PASS");
 return Object.freeze({
  status:"owner_verified_runner_pass_staged",
  request_id:request.request_id,repository:request.repository,
  branch:request.branch,tested_commit_sha:request.commit_sha,
  runner_profile:"poc-default",
  all_project_tests_passed:true,
  researcher_acceptance_passed:true,
  completed_phases:Object.freeze([...PROJECT,"researcher_acceptance"]),
  log_reference:result.log_reference!,
  runner_execution_authorized:false
 });
}
