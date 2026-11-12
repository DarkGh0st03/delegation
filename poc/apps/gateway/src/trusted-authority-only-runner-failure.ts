/**
 * R335 — owner-side, authenticated controlled Runner FAIL classification.
 *
 * Unlike a model/A2A Test FAIL, the input is the ORIGINAL immutable
 * RunnerClient.run() response object branded to one authenticated POST.
 * This check is read-only: no D1 epoch, Child, permission or Task completion.
 */
import {RunnerClient,assertTrustedRunnerClientResult,
 type RunnerClientRequest,type RunnerClientResult}
 from "./runner-client.ts";
import {DurableAuthorityOnlyRunnerIntentJournal,
 type TrustedAuthorityOnlyRunnerIntent}
 from "./trusted-authority-only-runner-intent-journal.ts";
const LOG=/^runner-log:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function deny(reason:string):never{
 throw Error("Authority-only verified Runner FAIL NO-GO: "+reason);
}
export interface TrustedRunnerFailStage{
 readonly status:"owner_authenticated_runner_fail_not_recovery_authorized";
 readonly task_id:string;readonly runtime_task_id:string;
 readonly credential_id:string;readonly request_id:string;
 readonly request_fingerprint:string;readonly tested_commit_sha:string;
 readonly first_failed_phase:string;
 /** First phase of the approved profile: prepares the environment. */
 readonly environment_phase:string;
 readonly repair_candidate:boolean;
 readonly gateway_task_completed:false;
 readonly recovery_authorized:false;
 readonly child_credential_issued:false;
}
export function validateTrustedRunnerFailure(
 client:RunnerClient,request:RunnerClientRequest,result:RunnerClientResult,
 intent:TrustedAuthorityOnlyRunnerIntent
):TrustedRunnerFailStage{
 if(!(client instanceof RunnerClient))deny("owner-bound Runner client required");
 DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
 // Reject copied/tampered results, caller-substituted request IDs and SHA.
 assertTrustedRunnerClientResult(client,request,result);
 if(intent.request_id!==request.request_id||
    intent.branch!==request.branch||
    request.repository!=="gitea://gitea.local/"+intent.repository||
    intent.expected_head_sha!==request.commit_sha||
    request.profile!=="poc-default"||
    result.runner_profile!=="poc-default"||
    result.project_profile_sha256!==client.projectProfileSha256||
    result.status!=="fail"||
    !LOG.test(result.log_reference??""))
   deny("Runner FAIL differs from original immutable Test intent");
 // The approved profile's phases, then the researcher slot. The FIRST
 // profile phase prepares the environment (e.g. dependency installation):
 // its failure is not a code defect the agents could repair.
 const PHASES=[...client.projectProfile.phases.map(x=>x.name),"researcher_acceptance"];
 const last=PHASES.length-1;
 const p=result.phases;
 const project=result.project_tests;
 if(!Array.isArray(p)||p.length!==PHASES.length||
    !project||!Array.isArray(project.phases)||
    project.phases.length!==PHASES.length-1||
    p.some((v,i)=>v.phase!==PHASES[i])||
    project.phases.some((v,i)=>v.phase!==PHASES[i]||
      v.status!==p[i].status)||
    !result.researcher_acceptance||
    result.researcher_acceptance.phase!=="researcher_acceptance"||
    result.researcher_acceptance.status!==p[last].status)
   deny("Runner FAIL has incomplete or reordered controlled phases");
 const first=p.findIndex(v=>v.status==="fail");
 if(first<0||p.some((v,i)=>v.status!==(i<first?"pass":
     i===first?"fail":"skipped"))||
    (first===last?(project.status!=="pass"):(project.status!=="fail"))||
    (p[first].failed!==undefined&&
     (!Number.isSafeInteger(p[first].failed)||p[first]!.failed!<1))||
    p.some(v=>v.failed!==undefined&&
     (!Number.isSafeInteger(v.failed)||v.failed!<0)))
   deny("Runner FAIL is inconsistent with first terminal failing phase");
 return Object.freeze({
  status:"owner_authenticated_runner_fail_not_recovery_authorized" as const,
  task_id:intent.task_id,
  runtime_task_id:intent.runtime_task_id,
  credential_id:intent.credential_id,
  request_id:intent.request_id,
  request_fingerprint:intent.request_fingerprint,
  tested_commit_sha:intent.expected_head_sha,
  first_failed_phase:PHASES[first]!,
  environment_phase:PHASES[0]!,
  repair_candidate:first>0,
  gateway_task_completed:false as const,
  recovery_authorized:false as const,
  child_credential_issued:false as const
 });
}
