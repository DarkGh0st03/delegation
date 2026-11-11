/** Authenticated read-only Gitea comparison for old, RETIRED feature work.
 * No source, patch, diff body, tokens or model output is returned. The
 * trusted owner supplies repository and SHA pins; no A2A/LLM input does. */
import type {TrustedPriorBranchDiffReader,PriorChangedFile}
  from "./trusted-fresh-work-audit.ts";

type FetchLike=typeof fetch;
const SHA=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9_.-]{1,100}$/u;
const BRANCH=/^feature\/[a-z0-9][a-z0-9./_-]*$/u;
function deny(msg:string):never{throw Error("Trusted Gitea prior-work diff: "+msg);}
function obj(x:unknown):Record<string,unknown>{
  if(!x||typeof x!=="object"||Array.isArray(x))deny("invalid provider response");
  return x as Record<string,unknown>;
}
export class TrustedGiteaPriorDiffReader implements TrustedPriorBranchDiffReader {
  readonly #base:string;
  readonly #token:string;
  readonly #repository:{authority:string;owner:string;repository:string};
  readonly #fetch:FetchLike;
  readonly #timeoutMs:number;
  constructor(config:{
    baseUrl:string;token:string;
    repository:{authority:string;owner:string;repository:string};
    fetchFn?:FetchLike;timeoutMs?:number;
  }){
    const match=/^http:\/\/127\.0\.0\.1:(\d{1,5})$/u.exec(config?.baseUrl);
    const port=Number(match?.[1]);
    if(!match||port<1||port>65535||
       !config.token||typeof config.token!=="string"||
       !config.repository||!ID.test(config.repository.owner)||
       !ID.test(config.repository.repository)||
       !/^[A-Za-z0-9.-]{1,128}$/u.test(config.repository.authority)||
       (config.timeoutMs!==undefined&&
         (!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<100||
          config.timeoutMs>30_000))||
       (config.fetchFn!==undefined&&typeof config.fetchFn!=="function"))
      deny("private loopback Gitea, immutable repository and owner credentials required");
    this.#base=config.baseUrl;
    this.#token=config.token;
    this.#repository=Object.freeze({...config.repository});
    this.#fetch=config.fetchFn??fetch;
    this.#timeoutMs=config.timeoutMs??5000;
  }
  async #get(suffix:string):Promise<Record<string,unknown>>{
    const url=this.#base+"/api/v1/repos/"+
      encodeURIComponent(this.#repository.owner)+"/"+
      encodeURIComponent(this.#repository.repository)+suffix;
    const response=await this.#fetch(url,{
      method:"GET",redirect:"error",
      headers:{authorization:"token "+this.#token,accept:"application/json"},
      signal:AbortSignal.timeout(this.#timeoutMs)
    });
    if(!response.ok||response.redirected)
      deny("Gitea HTTP read failed or redirected");
    const size=Number(response.headers.get("content-length"));
    if(Number.isFinite(size)&&size>512_000)
      deny("Gitea comparison metadata exceeds bound");
    const raw=await response.text();
    if(raw.length>512_000)deny("Gitea comparison response exceeds bound");
    try{return obj(JSON.parse(raw));}
    catch{deny("Gitea comparison JSON malformed");}
  }
  async #assertHead(branch:string,sha:string){
    const r=await this.#get("/branches/"+encodeURIComponent(branch));
    const c=obj(r.commit);
    if(r.name!==branch||c.id!==sha)
      deny("old feature branch changed during pinned audit");
  }
  async readPinnedFeatureDiff(input:Readonly<{
    repository:{authority:string;owner:string;repository:string};
    branch:string;base_revision:string;head_revision:string;
  }>):Promise<{
    branch:string;base_revision:string;head_revision:string;
    changes:PriorChangedFile[];
  }>{
    if(!input||!SHA.test(input.base_revision)||!SHA.test(input.head_revision)||
       !BRANCH.test(input.branch)||input.branch.length>120||
       input.branch.includes("..")||
       JSON.stringify(input.repository)!==JSON.stringify(this.#repository))
      deny("independent repository/branch/revision pins required");
    await this.#assertHead(input.branch,input.head_revision);
    const data=await this.#get("/compare/"+
      input.base_revision+"..."+input.head_revision+"?files=true&verification=false");
    if(!Array.isArray(data.commits)||
       !Number.isSafeInteger(data.total_commits)||
       (data.total_commits as number)<0||
       (data.total_commits as number)>64||
       data.commits.length!==data.total_commits)
      deny("comparison is truncated or commit metadata missing");
    const files:PriorChangedFile[]=[],seen=new Set<string>();
    const commits=data.commits as unknown[];
    if(commits.length===0&&input.base_revision!==input.head_revision)
      deny("no verifiable commits in different branch revisions");
    for(const [index,raw] of commits.entries()){
      const commit=obj(raw);
      if(!SHA.test(commit.sha as string)||
         (index===commits.length-1&&commit.sha!==input.head_revision)||
         !Array.isArray(commit.files)||
         commit.files.length>64)
        deny("unverifiable comparison commit or changed files");
      for(const element of commit.files){
        const item=obj(element);
        if(typeof item.filename!=="string"||
           !/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u.test(item.filename)||
           item.filename.length>240||
           item.filename.split("/").some(p=>p==="."||p==="..")||
           !["added","modified","deleted"].includes(item.status as string)||
           seen.has(item.filename)||files.length>=64)
          deny("conflicting, unsafe or oversized old-branch metadata");
        seen.add(item.filename);
        files.push(Object.freeze({path:item.filename,
          change:item.status as PriorChangedFile["change"]}));
      }
    }
    await this.#assertHead(input.branch,input.head_revision);
    return Object.freeze({
      branch:input.branch,base_revision:input.base_revision,
      head_revision:input.head_revision,changes:files
    });
  }
}
