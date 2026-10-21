/**
 * Model-independent completion reconciliation.
 * A2A task state and artifacts are observations, NOT independent proof.
 * A trusted Coordinator submits them through owner-only HMAC IPC.
 * The Gateway separately requires real provider results recorded after
 * Rust/DC/VP and OPA checks. Never expose this class to MCP/agent tools.
 */
import type {AgentRole} from "./types.ts";
import type {
  TrustedCompletionEvidence,TrustedProviderEffect,TrustedTaskCompletionAttestor
} from "./approved-execution-plans.ts";

const SHA=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export interface TrustedCompletionObservation {
  readonly source:"trusted_orchestrator"|"trusted_a2a_poll";
  readonly runtime_task_id:string;
  readonly state:"completed";
  readonly role:AgentRole;
  readonly artifact?:{
    readonly branch:string;
    readonly revision:string;
    readonly commit_sha:string;
    readonly files_modified:readonly string[];
    readonly files_created:readonly string[];
    readonly test_outcome:"not_run"|"pass";
    readonly tested_commit_sha?:string;
    readonly runner_profile?:string;
    readonly project_tests?:string;
    readonly researcher_acceptance?:string;
  };
}
function paths(v:unknown):v is string[]{
  return Array.isArray(v)&&v.every(x=>typeof x==="string"&&x.length>0&&
    !x.startsWith("/")&&!x.includes(".."))&&new Set(v).size===v.length;
}
function matchingPath(effect:TrustedProviderEffect,
  a:NonNullable<TrustedCompletionObservation["artifact"]>):boolean{
  const r=effect.execution;
  if(r.provider!=="gitea"||!r.performed||!("branch" in r)||
     r.branch!==a.branch||!("path" in r))return false;
  return effect.tool==="update_file"?a.files_modified.includes(r.path):
    effect.tool==="create_file"?a.files_created.includes(r.path):false;
}
export class GatewayCorroboratedTaskAttestor implements TrustedTaskCompletionAttestor{
  async confirmCompleted(e:Readonly<TrustedCompletionEvidence>):Promise<boolean>{
    const o=e.observation;
    if(!o||typeof o!=="object"||!ID.test(o.runtime_task_id)||
       o.runtime_task_id!==e.runtime_task_id||o.state!=="completed"||
       o.role!==e.role||!e.successful_gateway_request_ids.length||
       !e.provider_effects.length)return false;
    const ids=new Set(e.successful_gateway_request_ids);
    if(ids.size!==e.successful_gateway_request_ids.length||
       e.provider_effects.length!==ids.size||
       e.provider_effects.some(x=>!ids.has(x.request_id)||
         !x.execution.performed||x.execution.provider==="mock"||
         x.tool!==x.execution.tool))return false;
    // No A2A is involved when the trusted Orchestrator creates the work
    // branch. A verified Gateway create_branch/PR effect is required.
    if(e.role==="orchestrator"){
      return o.source==="trusted_orchestrator"&&o.artifact===undefined&&
        e.provider_effects.some(x=>x.tool==="create_branch"||
          x.tool==="create_pull_request");
    }
    if(o.source!=="trusted_a2a_poll"||
       !["backend","frontend","test"].includes(e.role))return false;
    const a=o.artifact;
    if(!a||typeof a.branch!=="string"||!a.branch.length||
       typeof a.revision!=="string"||!SHA.test(a.revision)||
       a.commit_sha!==a.revision||
       !paths(a.files_created)||!paths(a.files_modified))return false;
    const files=e.provider_effects.filter(x=>
      x.tool==="update_file"||x.tool==="create_file");
    const claims=[...a.files_modified.map(path=>({path,tool:"update_file"})),
      ...a.files_created.map(path=>({path,tool:"create_file"}))];
    if(claims.some(c=>!files.some(x=>
      x.tool===c.tool&&"path" in x.execution&&
      x.execution.path===c.path&&matchingPath(x,a))))return false;
    if(e.role==="test"){
      if(a.test_outcome!=="pass"||a.tested_commit_sha!==a.commit_sha||
         a.runner_profile!=="poc-default"||a.project_tests!=="pass"||
         a.researcher_acceptance!=="pass")return false;
      return e.provider_effects.some(x=>{
        const r=x.execution;
        return r.provider==="runner"&&r.tool==="run_tests"&&
          r.status==="pass"&&r.runner_profile==="poc-default"&&
          r.tested_commit_sha===a.tested_commit_sha&&
          r.project_tests?.status==="pass"&&
          r.researcher_acceptance?.status==="pass"&&r.branch===a.branch;
      });
    }
    return a.test_outcome==="not_run"&&
      a.tested_commit_sha===undefined&&a.runner_profile===undefined&&
      a.project_tests===undefined&&a.researcher_acceptance===undefined&&
      claims.length>0&&files.length>0&&files.some(x=>
        matchingPath(x,a)&&x.execution.provider==="gitea"&&
        "commit_sha" in x.execution&&x.execution.commit_sha===a.commit_sha);
  }
}
