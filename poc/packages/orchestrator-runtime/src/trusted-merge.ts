/**
 * Human-invoked privileged merge boundary.
 *
 * Intentionally NOT registered as an ADK/MCP/Gateway tool and NOT reachable
 * through delegation credentials. The caller must be an independently
 * authenticated, explicit human-action controller. Never run this automatically
 * after a Test Agent/CI success; a real human approval is mandatory.
 *
 * Preconditions are checked twice against live Gitea, and Gitea must enforce
 * its own protected-branch rules and the exact head_commit_id at commit time.
 * Verification alone cannot provide an atomic merge lock.
 */
import {
  GiteaMergeReadinessVerifier,
  type MergeReadinessConfig,
  type MergeReadinessEvidence,
  type TrustedGiteaActor
} from "./merge-readiness.ts";

const SHA=/^[a-f0-9]{40}$/u;
const REPO="/api/v1/repos/thesis/iam-console-poc";
type FetchLike=typeof fetch;

export type TrustedMergeReason=
  |"invalid_input"|"untrusted_merge_identity"|"evidence_changed"
  |"provider_unavailable"|"provider_rejected"|"merge_not_confirmed";

export class TrustedMergeDenied extends Error {
  readonly reason:TrustedMergeReason;
  constructor(reason:TrustedMergeReason){
    super("Protected merge denied: "+reason);
    this.name="TrustedMergeDenied";
    this.reason=reason;
  }
}
function deny(reason:TrustedMergeReason):never{
  throw new TrustedMergeDenied(reason);
}
function object(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)
    ?value as Record<string,unknown>:null;
}
function actor(value:unknown):value is TrustedGiteaActor{
  const v=object(value);
  return typeof v?.id==="number"&&Number.isSafeInteger(v.id)&&v.id>0&&
    typeof v.login==="string"&&/^[a-zA-Z0-9_.-]{1,128}$/u.test(v.login);
}
function validSha(v:unknown):v is string{
  return typeof v==="string"&&SHA.test(v);
}
function sameEvidence(a:MergeReadinessEvidence,b:MergeReadinessEvidence):boolean{
  return a.ready===true&&b.ready===true&&
    a.pull_request_number===b.pull_request_number&&
    a.head_sha===b.head_sha&&a.base_sha===b.base_sha&&
    a.reviewer_id===b.reviewer_id&&
    a.approval_review_id===b.approval_review_id&&
    a.pipeline_actor_id===b.pipeline_actor_id&&
    a.security_status_id===b.security_status_id&&
    a.security_context===b.security_context;
}

export interface TrustedMergeConfig
  extends Omit<MergeReadinessConfig,"fetchFn">{
  /**
   * Separate non-admin merge-operator account. Must not be the reviewer,
   * CI publisher, model, tool service or Gateway service account.
   */
  mergeToken:string;
  mergeActor:TrustedGiteaActor;
  fetchFn?:FetchLike;
}
export interface TrustedMergeOutcome{
  merged:true;
  pull_request_number:number;
  head_sha:string;
  previous_main_sha:string;
  merged_main_sha:string;
  review_id:number;
  security_status_id:number;
  merge_actor_id:number;
}

export class TrustedGiteaMergeExecutor {
  readonly #base:string;
  readonly #mergeToken:string;
  readonly #mergeActor:TrustedGiteaActor;
  readonly #fetch:FetchLike;
  readonly #timeout:number;
  readonly #verifier:GiteaMergeReadinessVerifier;
  constructor(config:TrustedMergeConfig){
    let url:URL;
    try{url=new URL(config.giteaBaseUrl);}catch{return deny("invalid_input");}
    const local=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
    if((url.protocol!=="https:"&&!(url.protocol==="http:"&&local))||
      url.username||url.password||url.search||url.hash||
      (url.pathname!=="/"&&url.pathname!=="")||
      !config.mergeToken||!actor(config.mergeActor)||
      !actor(config.humanReviewer)||!actor(config.securityPipelineActor)||
      config.mergeActor.id===config.humanReviewer.id||
      config.mergeActor.id===config.securityPipelineActor.id||
      config.mergeActor.login===config.humanReviewer.login||
      config.mergeActor.login===config.securityPipelineActor.login){
      deny("invalid_input");
    }
    const timeout=config.timeoutMs??15000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60000){
      deny("invalid_input");
    }
    this.#base=url.origin;
    this.#mergeToken=config.mergeToken;
    this.#mergeActor={id:config.mergeActor.id,login:config.mergeActor.login};
    this.#fetch=config.fetchFn??fetch;
    this.#timeout=timeout;
    this.#verifier=new GiteaMergeReadinessVerifier({
      giteaBaseUrl:config.giteaBaseUrl,
      readToken:config.readToken,
      branchProtectionReadToken:config.branchProtectionReadToken,
      humanReviewer:config.humanReviewer,
      securityPipelineActor:config.securityPipelineActor,
      timeoutMs:timeout,fetchFn:this.#fetch
    });
  }

  async #get(path:string):Promise<Record<string,unknown>>{
    let response:Response;
    try{
      response=await this.#fetch(this.#base+path,{
        method:"GET",
        headers:{authorization:"token "+this.#mergeToken,
          accept:"application/json"},
        redirect:"error",signal:AbortSignal.timeout(this.#timeout)
      });
    }catch{return deny("provider_unavailable");}
    if(!response.ok)deny("provider_unavailable");
    try{
      const value=object(await response.json());
      if(!value)deny("provider_unavailable");
      return value;
    }catch{return deny("provider_unavailable");}
  }

  async #identity():Promise<void>{
    const response=await this.#get("/api/v1/user");
    // Never trust an admin merge credential that could bypass branch protection.
    if(response.id!==this.#mergeActor.id||
      response.login!==this.#mergeActor.login||
      response.is_admin!==false||
      response.is_bot===true||response.type==="Bot"){
      deny("untrusted_merge_identity");
    }
  }

  async execute(input:{pullRequestNumber:number;expectedHeadSha:string}):
    Promise<TrustedMergeOutcome>{
    if(!Number.isSafeInteger(input.pullRequestNumber)||
      input.pullRequestNumber<1||!validSha(input.expectedHeadSha)){
      deny("invalid_input");
    }
    // No write authority is used while checking review and CI provenance.
    const first=await this.#verifier.verify(input);
    await this.#identity();
    // After account verification repeat ALL read-only evidence checks.
    const final=await this.#verifier.verify(input);
    if(!sameEvidence(first,final))deny("evidence_changed");

    // Force, bypass, deferred merges, and branch deletion are explicitly off.
    // head_commit_id makes Gitea reject a stale PR even if it changed
    // between readiness verification and the server-side merge transaction.
    const mergePath=REPO+"/pulls/"+input.pullRequestNumber+"/merge";
    let response:Response;
    try{
      response=await this.#fetch(this.#base+mergePath,{
        method:"POST",redirect:"error",
        headers:{authorization:"token "+this.#mergeToken,
          accept:"application/json","content-type":"application/json"},
        body:JSON.stringify({
          Do:"merge",head_commit_id:final.head_sha,force_merge:false,
          merge_when_checks_succeed:false,delete_branch_after_merge:false
        }),
        signal:AbortSignal.timeout(this.#timeout)
      });
    }catch{return deny("provider_unavailable");}
    // No retry on an ambiguous network error or rejection; fail closed.
    if(!response.ok)deny("provider_rejected");

    let merged:Record<string,unknown>|null=null;
    for(let i=0;i<12;i++){
      merged=await this.#get(REPO+"/pulls/"+input.pullRequestNumber);
      const head=object(merged.head),base=object(merged.base);
      if(merged.state==="closed"&&merged.merged===true&&
        head?.sha===final.head_sha&&head.ref==="feature/account-suspension"&&
        base?.ref==="main")break;
      // A successful HTTP response is not evidence of a completed merge.
      if(i===11)deny("merge_not_confirmed");
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    const main=await this.#get(REPO+"/branches/main");
    const mergedMainSha=object(main.commit)?.id;
    if(!validSha(mergedMainSha)||
      mergedMainSha===final.base_sha){
      deny("merge_not_confirmed");
    }
    return {
      merged:true,pull_request_number:input.pullRequestNumber,
      head_sha:final.head_sha,previous_main_sha:final.base_sha,
      merged_main_sha:mergedMainSha,
      review_id:final.approval_review_id,
      security_status_id:final.security_status_id,
      merge_actor_id:this.#mergeActor.id
    };
  }
}
