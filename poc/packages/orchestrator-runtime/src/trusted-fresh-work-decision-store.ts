/** Owner-only append-only durable decision ledger for retired DAG changes.
 * A record is not an Engineer signature and never grants authority. */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,resolve,join} from "node:path";
import type {TrustedPriorWorkAudit} from "./trusted-fresh-work-audit.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[0-9a-f]{40}$/u,DIGEST=/^[0-9a-f]{64}$/u;
function deny(msg:string):never{throw Error("Fresh work decision: "+msg);}
export type FreshWorkDisposition="quarantine_prior_branch"|"start_from_pinned_main";
export type FreshWorkDecision=Readonly<{
  version:1;previous_session_id:string;next_session_id:string;
  previous_plan_digest:string;previous_base_revision:string;
  previous_feature_head_sha:string;previous_branch:string;
  audit_digest:string;disposition:FreshWorkDisposition;
}>;
function record(audit:TrustedPriorWorkAudit,disposition:FreshWorkDisposition):FreshWorkDecision{
  if(!audit||audit.status!=="prior_work_audited"||
     !ID.test(audit.previous_session_id)||!ID.test(audit.proposed_next_session_id)||
     audit.previous_session_id===audit.proposed_next_session_id||
     !SHA.test(audit.previous_base_revision)||
     !SHA.test(audit.previous_feature_head_sha)||
     !DIGEST.test(audit.previous_plan_digest)||
     typeof audit.previous_branch!=="string"||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(audit.previous_branch)||
     !Array.isArray(audit.changed_files)||audit.changed_files.length>64||
     audit.planning_authorized!==false||audit.prior_changes_imported!==false||
     !["quarantine_prior_branch","start_from_pinned_main"].includes(disposition))
    deny("untrusted audit or disposition");
  return Object.freeze({
    version:1 as const,previous_session_id:audit.previous_session_id,
    next_session_id:audit.proposed_next_session_id,
    previous_plan_digest:audit.previous_plan_digest,
    previous_base_revision:audit.previous_base_revision,
    previous_feature_head_sha:audit.previous_feature_head_sha,
    previous_branch:audit.previous_branch,
    audit_digest:createHash("sha256").update(JSON.stringify(audit)).digest("hex"),
    disposition
  });
}
function owner(m:{mode:number;uid:number}):boolean{
  return (m.mode&0o077)===0&&
    (typeof process.getuid!=="function"||m.uid===process.getuid());
}
export class TrustedFreshWorkDecisionStore{
  readonly #dir:string;
  constructor(directory:string){
    if(typeof directory!=="string"||!isAbsolute(directory)||resolve(directory)!==directory)
      deny("absolute owner-only directory required");
    this.#dir=directory;
  }
  async #check(){
    const m=await lstat(this.#dir);
    if(!m.isDirectory()||m.isSymbolicLink()||!owner(m))
      deny("owner-only non-symlink directory required");
  }
  #path(audit:TrustedPriorWorkAudit){
    const key=createHash("sha256")
      .update(audit.previous_session_id+"\n"+audit.proposed_next_session_id)
      .digest("hex");
    return join(this.#dir,key+".decision.json");
  }
  async #sync(){
    const d=await open(this.#dir,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await d.sync();}finally{await d.close();}
  }
  async recordDecision(input:{audit:TrustedPriorWorkAudit;
    disposition:FreshWorkDisposition}):Promise<FreshWorkDecision>{
    const row=record(input.audit,input.disposition);
    await this.#check();
    const fd=await open(this.#path(input.audit),
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await fd.writeFile(JSON.stringify(row)+"\n");await fd.sync();}
    finally{await fd.close();}
    await this.#sync();
    return row;
  }
  async assertRecorded(input:{audit:TrustedPriorWorkAudit;
    disposition:FreshWorkDisposition}):Promise<FreshWorkDecision>{
    const wanted=record(input.audit,input.disposition);
    await this.#check();
    const fd=await open(this.#path(input.audit),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const m=await fd.stat();
      if(!m.isFile()||!owner(m)||m.size<100||m.size>2048)
        deny("unsafe or incomplete decision");
      let actual:unknown;
      try{actual=JSON.parse(await fd.readFile("utf8"));}
      catch{deny("malformed decision JSON");}
      if(!actual||typeof actual!=="object"||Array.isArray(actual)||
         Object.keys(actual).sort().join(",")!==Object.keys(wanted).sort().join(",")||
         Object.entries(wanted).some(([k,v])=>(actual as Record<string,unknown>)[k]!==v))
        deny("persisted decision does not match audited work");
      return wanted;
    }finally{await fd.close();}
  }
}
