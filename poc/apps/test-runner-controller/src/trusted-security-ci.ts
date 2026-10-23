/**
 * Trusted Security CI pipeline. The production runner is constructed by a
 * privileged CI process, never from a model, PR body or agent tool call.
 *
 * Statuses are bound to an exact Git SHA; no review or merge endpoints exist.
 * "success" is possible ONLY after all six real project phases AND the
 * researcher-owned acceptance phase pass. Any failure is fail-closed.
 */
import type {RunnerExecutor,RunnerRunRequest,RunnerRunResult} from "./types.ts";

type Json=Record<string,unknown>;
const SHA=/^[0-9a-f]{40}$/u;
const BRANCH="feature/account-suspension";
const REPOSITORY="gitea://gitea.local/thesis/iam-console-poc";
const API_REPO="/api/v1/repos/thesis/iam-console-poc";
export const SECURITY_STATUS_CONTEXT="thesis/security-pipeline" as const;
export const TRUSTED_PROJECT_PHASES=[
  "dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e"
] as const;
export type SecurityCiStatus="success"|"failure"|"pending"|"error";
type FetchLike=typeof fetch;

function record(value:unknown):Json|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ?value as Json:null;
}
// The CI process owns the permitted branch, not the incoming Runner request.
function requireExactRequest(req:RunnerRunRequest,approvedBranch=BRANCH):void{
  if(req.repository!==REPOSITORY||req.branch!==approvedBranch||
     req.profile!=="poc-default"||!SHA.test(req.commit_sha)||
     typeof req.request_id!=="string"||req.request_id.trim().length===0){
    throw new Error("Invalid fixed-security-pipeline Runner request");
  }
}
function exactPhases(value:unknown,names:readonly string[]):boolean{
  if(!Array.isArray(value)||value.length!==names.length)return false;
  return value.every((item,index)=>{
    const phase=record(item);
    return phase?.phase===names[index]&&
      ["pass","fail","skipped"].includes(String(phase.status));
  });
}
/**
 * This validates Runner evidence; it does not certify its provenance.
 * The invoking trusted CI process MUST use an actual
 * IsolatedDockerRunnerExecutor with researcher acceptance ENABLED.
 */
export function classifyTrustedSecurityRunnerResult(
  result:RunnerRunResult,request:RunnerRunRequest,
  approvedBranch=BRANCH
):"success"|"failure"{
  requireExactRequest(request,approvedBranch);
  if(result.request_id!==request.request_id||
     result.repository!==request.repository||
     result.branch!==approvedBranch||
     result.tested_commit_sha!==request.commit_sha||
     result.runner_profile!=="poc-default"){
    throw new Error("Runner result does not match exact authorized revision");
  }
  if(!exactPhases(result.phases,[
    ...TRUSTED_PROJECT_PHASES,"researcher_acceptance"
  ])||!result.project_tests||
     !exactPhases(result.project_tests.phases,TRUSTED_PROJECT_PHASES)||
     result.researcher_acceptance?.phase!=="researcher_acceptance"){
    throw new Error("Runner result lacks fixed complete pipeline evidence");
  }
  const project=result.project_tests;
  for(let i=0;i<TRUSTED_PROJECT_PHASES.length;i++){
    if(project.phases[i]?.status!==result.phases[i]?.status){
      throw new Error("Runner phase evidence is internally inconsistent");
    }
  }
  if(result.phases[TRUSTED_PROJECT_PHASES.length]?.status!==
     result.researcher_acceptance.status){
    throw new Error("Researcher acceptance evidence differs from pipeline result");
  }
  const projectPassed=project.phases.every(p=>p.status==="pass");
  if(project.status!==(projectPassed?"pass":"fail")){
    throw new Error("Runner project-tests summary contradicts actual phases");
  }
  const allPassed=projectPassed&&result.researcher_acceptance.status==="pass";
  if(result.status!==(allPassed?"pass":"fail")){
    throw new Error("Runner overall status contradicts independent acceptance");
  }
  return allPassed?"success":"failure";
}

export interface TrustedSecurityCiConfig{
  giteaBaseUrl:string;
  giteaReadToken:string;
  /** Protected CI service token, not delegated to an Agent or a model. */
  giteaStatusToken:string;
  trustedStatusActor:{id:number;login:string};
  runner:RunnerExecutor;
  /** Pinned by the trusted CI runner, never accepted from the model. */
  approvedBranch?:string;
  timeoutMs?:number;
  fetchFn?:FetchLike;
}
export interface SecurityCiOutcome{
  status:"success"|"failure";
  tested_commit_sha:string;
  gitea_status_id:number;
  context:typeof SECURITY_STATUS_CONTEXT;
}
export class TrustedGiteaSecurityCi{
  readonly #base:string;
  readonly #reader:string;
  readonly #writer:string;
  readonly #actor:{id:number;login:string};
  readonly #runner:RunnerExecutor;
  readonly #branch:string;
  readonly #fetch:FetchLike;
  readonly #timeout:number;

  constructor(config:TrustedSecurityCiConfig){
    let url:URL;
    try{url=new URL(config.giteaBaseUrl);}
    catch{throw new Error("Invalid trusted CI Gitea URL");}
    const loopback=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
    if((url.protocol!=="https:"&&!(url.protocol==="http:"&&loopback))||
       url.username||url.password||url.search||url.hash||
       (url.pathname!=="/"&&url.pathname!=="")){
      throw new Error("Trusted CI requires an HTTPS or local-loopback Gitea URL");
    }
    const actor=config.trustedStatusActor;
    if(!config.giteaReadToken||!config.giteaStatusToken||
       !actor||!Number.isSafeInteger(actor.id)||actor.id<=0||
       typeof actor.login!=="string"||!actor.login.trim()||
       !config.runner||typeof config.runner.run!=="function"){
      throw new Error("Trusted CI configuration is incomplete");
    }
    const timeout=config.timeoutMs??15000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60000){
      throw new Error("Invalid CI network timeout");
    }
    const branch=config.approvedBranch??BRANCH;
    if(!/^feature\/[a-z0-9][a-z0-9._-]{0,100}$/u.test(branch)||
       branch.includes("..")||branch.endsWith(".")){
      throw new Error("Trusted CI requires one pinned feature branch");
    }
    this.#branch=branch;
    this.#base=url.origin;
    this.#reader=config.giteaReadToken;
    this.#writer=config.giteaStatusToken;
    this.#actor={id:actor.id,login:actor.login};
    this.#runner=config.runner;
    this.#fetch=config.fetchFn??fetch;
    this.#timeout=timeout;
  }
  async #json(path:string,auth:string,method:"GET"|"POST"="GET",body?:unknown):
    Promise<Json>{
    let response:Response;
    try{
      response=await this.#fetch(this.#base+path,{
        method,redirect:"error",
        headers:{
          authorization:"token "+auth,accept:"application/json",
          ...(method==="POST"?{"content-type":"application/json"}:{})
        },
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        signal:AbortSignal.timeout(this.#timeout)
      });
    }catch{throw new Error("Security CI Gitea provider unavailable");}
    if(!response.ok)throw new Error("Security CI Gitea HTTP request failed");
    let value:unknown;
    try{value=await response.json();}
    catch{throw new Error("Security CI Gitea returned non-JSON data");}
    const result=record(value);
    if(!result)throw new Error("Security CI Gitea returned invalid JSON object");
    return result;
  }
  async #branchSha():Promise<string>{
    const metadata=await this.#json(
      API_REPO+"/branches/"+encodeURIComponent(this.#branch),this.#reader
    );
    const sha=record(metadata.commit)?.id;
    if(typeof sha!=="string"||!SHA.test(sha)){
      throw new Error("Security CI cannot establish exact branch head");
    }
    return sha;
  }
  async #verifyActor():Promise<void>{
    const actor=await this.#json("/api/v1/user",this.#writer);
    if(actor.id!==this.#actor.id||actor.login!==this.#actor.login){
      throw new Error("Security CI status credential belongs to the wrong actor");
    }
  }
  async #publish(sha:string,state:SecurityCiStatus):Promise<number>{
    const data=await this.#json(
      API_REPO+"/statuses/"+sha,this.#writer,"POST",{
        state,context:SECURITY_STATUS_CONTEXT,
        description:state==="pending"
          ?"Controlled project tests and researcher acceptance running"
          :state==="success"
            ?"Real project tests and independent researcher acceptance passed"
            :state==="failure"
              ?"Controlled project tests or researcher acceptance failed"
              :"Trusted security pipeline could not verify the run"
      }
    );
    const creator=record(data.creator);
    if(data.context!==SECURITY_STATUS_CONTEXT||
       data.status!==state||
       !creator||creator.id!==this.#actor.id||
       creator.login!==this.#actor.login||
       !Number.isSafeInteger(data.id)||Number(data.id)<=0){
      throw new Error("Gitea returned untrusted CI commit status");
    }
    return data.id as number;
  }
  async run(request:RunnerRunRequest):Promise<SecurityCiOutcome>{
    requireExactRequest(request,this.#branch);
    await this.#verifyActor();
    if(await this.#branchSha()!==request.commit_sha){
      throw new Error("Trusted CI rejected stale branch SHA before execution");
    }
    // Publish pending first: a previous success in this fixed context must not
    // survive a subsequent failed or interrupted pipeline run unnoticed.
    await this.#publish(request.commit_sha,"pending");

    try{
      const result=await this.#runner.run(request);
      const status=classifyTrustedSecurityRunnerResult(
        result,request,this.#branch);
      if(await this.#branchSha()!==request.commit_sha){
        throw new Error("Trusted CI branch changed during execution");
      }
      const statusId=await this.#publish(request.commit_sha,status);
      return {
        status,tested_commit_sha:request.commit_sha,
        gitea_status_id:statusId,context:SECURITY_STATUS_CONTEXT
      };
    }catch(error){
      // Never transform a failure, malformed result, timeout, or stale SHA
      // into 'success'. If even status publishing fails, leave 'pending',
      // which the human merge-readiness verifier also denies.
      await this.#publish(request.commit_sha,"error").catch(()=>undefined);
      throw error;
    }
  }
}
