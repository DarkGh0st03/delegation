/**
 * READ-ONLY merge readiness verifier.
 *
 * It never creates an approval, posts a commit status, or merges a PR.
 * The Gitea review and security-pipeline status must both be bound to
 * the exact current head revision. A passing ADK/Runner Artifact alone
 * is never sufficient for merge authorization.
 */
type FetchLike=typeof fetch;
type ObjectValue=Record<string,unknown>;
const REPO="thesis/iam-console-poc";
const BRANCH="feature/account-suspension";
const PIPELINE_CONTEXT="thesis/security-pipeline";
const SHA=/^[a-f0-9]{40}$/u;
const PAGE_SIZE=50;
const MAX_PAGES=20;

export type MergeReadinessReason=
  |"invalid_input"|"provider_unavailable"|"malformed_provider_data"
  |"pr_not_open"|"pr_revision_mismatch"|"pr_branch_mismatch"
  |"pr_not_mergeable"|"branch_protection_insufficient"
  |"human_approval_missing"|"security_pipeline_missing";

export class MergeReadinessDenied extends Error{
  readonly reason:MergeReadinessReason;
  constructor(reason:MergeReadinessReason){
    super("Merge readiness denied: "+reason);
    this.name="MergeReadinessDenied";
    this.reason=reason;
  }
}

export interface TrustedGiteaActor{
  /** Use the immutable Gitea numeric account identifier, not display name. */
  id:number;
  login:string;
}
export interface MergeReadinessConfig{
  giteaBaseUrl:string;
  /** Read-only repository credential. No PR merge/approval/status permission. */
  readToken:string;
  /** A separate read-scoped token from a repository admin is required by
   * Gitea deployments that restrict branch-protection inspection.
   * It is NEVER used to approve, publish CI statuses, or merge. */
  branchProtectionReadToken?:string;
  humanReviewer:TrustedGiteaActor;
  /** Must be a separate trusted CI security pipeline service account. */
  securityPipelineActor:TrustedGiteaActor;
  timeoutMs?:number;
  fetchFn?:FetchLike;
}
export interface MergeReadinessEvidence{
  ready:true;
  pull_request_number:number;
  head_sha:string;
  base_sha:string;
  reviewer_id:number;
  approval_review_id:number;
  pipeline_actor_id:number;
  security_status_id:number;
  security_context:typeof PIPELINE_CONTEXT;
}
function obj(v:unknown):ObjectValue|null{
  return v!==null&&typeof v==="object"&&!Array.isArray(v)?v as ObjectValue:null;
}
function id(v:unknown):v is number{
  return typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
}
function validActor(v:TrustedGiteaActor):boolean{
  return Boolean(v&&id(v.id)&&typeof v.login==="string"&&
    /^[a-zA-Z0-9_.-]{1,128}$/u.test(v.login));
}
function actorMatches(value:unknown,actor:TrustedGiteaActor,requireHuman:boolean):boolean{
  const got=obj(value);
  return got?.id===actor.id && got.login===actor.login &&
    (!requireHuman || got.is_bot!==true);
}
function safeSha(value:unknown):value is string{
  return typeof value==="string"&&SHA.test(value);
}
function deny(code:MergeReadinessReason):never{
  throw new MergeReadinessDenied(code);
}

export class GiteaMergeReadinessVerifier{
  readonly #base:string;
  readonly #token:string;
  readonly #protectionReadToken:string;
  readonly #human:TrustedGiteaActor;
  readonly #pipeline:TrustedGiteaActor;
  readonly #timeoutMs:number;
  readonly #fetch:FetchLike;
  constructor(config:MergeReadinessConfig){
    let url:URL;
    try{url=new URL(config.giteaBaseUrl);}catch{return deny("invalid_input");}
    if(!["http:","https:"].includes(url.protocol)||
       !url.hostname||url.username||url.password||url.search||url.hash||
       (url.pathname!=="/"&&url.pathname!=="")){
      deny("invalid_input");
    }
    if(!config.readToken||!validActor(config.humanReviewer)||
       !validActor(config.securityPipelineActor)||
       config.humanReviewer.id===config.securityPipelineActor.id||
       config.humanReviewer.login===config.securityPipelineActor.login){
      deny("invalid_input");
    }
    const timeout=config.timeoutMs??10000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60000){
      deny("invalid_input");
    }
    this.#base=url.origin;
    this.#token=config.readToken;
    this.#protectionReadToken=config.branchProtectionReadToken??config.readToken;
    this.#human=config.humanReviewer;
    this.#pipeline=config.securityPipelineActor;
    this.#timeoutMs=timeout;
    this.#fetch=config.fetchFn??fetch;
  }

  async #get(path:string):Promise<unknown>{
    let response:Response;
    try{
      response=await this.#fetch(this.#base+"/api/v1/repos/"+REPO+path,{
        method:"GET",
        // Keep the privileged-scope identity isolated to a single fixed
        // read-only inspection endpoint; all other evidence uses a distinct
        // low-privilege repository-reader token.
        headers:{authorization:"token "+(
          path==="/branch_protections/main"
            ? this.#protectionReadToken : this.#token
        ),accept:"application/json"},
        redirect:"error",
        signal:AbortSignal.timeout(this.#timeoutMs)
      });
    }catch{
      return deny("provider_unavailable");
    }
    if(!response.ok)deny("provider_unavailable");
    try{return await response.json();}
    catch{return deny("malformed_provider_data");}
  }
  async #collection(path:string):Promise<ObjectValue[]>{
    const result:ObjectValue[]=[];
    for(let page=1;page<=MAX_PAGES;page++){
      const separator=path.includes("?")?"&":"?";
      const raw=await this.#get(path+separator+"limit="+PAGE_SIZE+"&page="+page);
      if(!Array.isArray(raw)||!raw.every(item=>obj(item)!==null)){
        deny("malformed_provider_data");
      }
      result.push(...raw as ObjectValue[]);
      if(raw.length<PAGE_SIZE)return result;
    }
    // Never silently ignore an approval withdrawal or a newer CI failure.
    return deny("malformed_provider_data");
  }

  async verify(input:{pullRequestNumber:number;expectedHeadSha:string}):
    Promise<MergeReadinessEvidence>{
    if(!id(input.pullRequestNumber)||!safeSha(input.expectedHeadSha)){
      deny("invalid_input");
    }
    const prNumber=input.pullRequestNumber,head=input.expectedHeadSha;
    const pr=obj(await this.#get("/pulls/"+prNumber));
    if(!pr)deny("malformed_provider_data");
    if(pr.number!==prNumber||pr.state!=="open"||pr.merged!==false){
      deny("pr_not_open");
    }
    const prHead=obj(pr.head),prBase=obj(pr.base);
    if(!prHead||!prBase||prHead.ref!==BRANCH||prBase.ref!=="main"||
       obj(prHead.repo)?.full_name!==REPO||
       obj(prBase.repo)?.full_name!==REPO){
      deny("pr_branch_mismatch");
    }
    if(prHead.sha!==head)deny("pr_revision_mismatch");
    if(pr.mergeable!==true)deny("pr_not_mergeable");
    const [feature,main,protection]=await Promise.all([
      this.#get("/branches/"+encodeURIComponent(BRANCH)),
      this.#get("/branches/main"),
      this.#get("/branch_protections/main")
    ]);
    const featureSha=obj(obj(feature)?.commit)?.id;
    const mainSha=obj(obj(main)?.commit)?.id;
    if(featureSha!==head || !safeSha(mainSha)||prBase.sha!==mainSha){
      deny("pr_revision_mismatch");
    }
    const rule=obj(protection);
    if(!rule||rule.branch_name!=="main"||rule.enable_push!==false||
       rule.enable_force_push!==false||rule.block_admin_merge_override!==true||
       rule.dismiss_stale_approvals!==true||
       rule.block_on_outdated_branch!==true||
       !id(rule.required_approvals)||rule.required_approvals<1){
      deny("branch_protection_insufficient");
    }

    const reviews=await this.#collection("/pulls/"+prNumber+"/reviews");
    // Use the newest review from the explicitly configured human account.
    // Old APPROVED reviews cannot override a later REQUEST_CHANGES/DISMISSED.
    const humanReviews=reviews.filter(r=>actorMatches(r.user,this.#human,true))
      .sort((a,b)=>Number(b.id)-Number(a.id));
    const latestReview=humanReviews[0];
    if(!latestReview||!id(latestReview.id)||
       latestReview.state!=="APPROVED"||
       latestReview.commit_id!==head){
      deny("human_approval_missing");
    }

    const statuses=await this.#collection(
      "/commits/"+head+"/statuses"
    );
    // The newest status for the fixed security context is authoritative:
    // a stale success is NOT accepted after failure/pending or a new actor.
    const matching=statuses.filter(st=>st.context===PIPELINE_CONTEXT)
      .sort((a,b)=>Number(b.id)-Number(a.id));
    const newestStatus=matching[0];
    if(!newestStatus||!id(newestStatus.id)||
       newestStatus.state!=="success"||
       !actorMatches(newestStatus.creator,this.#pipeline,false)||
       (newestStatus.sha!==undefined&&newestStatus.sha!==head)){
      deny("security_pipeline_missing");
    }

    // Recheck head/base immediately before reporting readiness. This is still
    // NOT an atomic merge lock: the eventual protected merge API must require
    // exact SHA and independently repeat these checks.
    const latestPr=obj(await this.#get("/pulls/"+prNumber));
    const latestHead=obj(latestPr?.head),latestBase=obj(latestPr?.base);
    if(latestPr?.state!=="open"||latestPr.merged!==false||
       latestHead?.sha!==head||latestBase?.sha!==mainSha||
       latestPr.mergeable!==true){
      deny("pr_revision_mismatch");
    }
    return {
      ready:true,pull_request_number:prNumber,head_sha:head,
      base_sha:mainSha,
      reviewer_id:this.#human.id,
      approval_review_id:latestReview.id as number,
      pipeline_actor_id:this.#pipeline.id,
      security_status_id:newestStatus.id as number,
      security_context:PIPELINE_CONTEXT
    };
  }
}
