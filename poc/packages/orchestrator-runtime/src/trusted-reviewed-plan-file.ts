/**
 * Owner-only materialization of the EXACT backend-signed, read-only Planning
 * result into the Engineer UI's immutable input plan.json.
 *
 * A raw draft, GUI upload, GitHub event or LLM response cannot write this
 * plan. The checkpoint's independent Ed25519 signature and pinned Gitea
 * origin are verified again by its trusted store BEFORE filesystem effects.
 * One session = one exclusive file; a stale/partial file is fail-closed.
 *
 * This does not authenticate an Engineer or transfer an operational root.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,resolve} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {SignedPlanningCheckpointFileStore}
  from "./trusted-planning-checkpoint-store.ts";
import type {PlanningReviewPacket}
  from "./trusted-planning-review-gate.ts";

const MAX_PLAN_BYTES=256*1024;
function refuse(message:string):never{
  throw Error("Trusted Engineer plan materialization: "+message);
}
function owner(meta:{mode:number;uid:number}):boolean{
  return (meta.mode&0o077)===0&&
    (typeof process.getuid!=="function"||meta.uid===process.getuid());
}
export class TrustedReviewedPlanFile {
  readonly #path:string;
  readonly #store:SignedPlanningCheckpointFileStore;
  #attempted=false;
  constructor(config:{
    filePath:string;checkpointStore:SignedPlanningCheckpointFileStore;
  }){
    if(typeof config.filePath!=="string"||!isAbsolute(config.filePath)||
       resolve(config.filePath)!==config.filePath||
       !(config.checkpointStore instanceof SignedPlanningCheckpointFileStore))
      refuse("absolute owner-controlled destination and pinned checkpoint required");
    this.#path=config.filePath;
    this.#store=config.checkpointStore;
  }

  assertCheckpointStore(store:SignedPlanningCheckpointFileStore):void{
    if(this.#store!==store)
      refuse("Planning checkpoint store identity differs from Engineer input");
  }

  /** Materialize only once from the already staged, independently verified
   * checkpoint. Never overwrite any preexisting raw or partial plan. */
  async persist(packet:PlanningReviewPacket):Promise<void>{
    if(this.#attempted)
      refuse("reviewable plan file already attempted");
    this.#attempted=true;
    const ticket=await this.#store.load();
    if(packet?.status!=="awaiting_engineer_signature"||
       ticket.proposal.status!=="unapproved_proposal"||
       ticket.proposal.digest!==packet.plan_digest||
       planDigest(ticket.proposal.plan)!==packet.plan_digest||
       !isDeepStrictEqual(ticket.proposal.plan,packet.plan)||
       ticket.snapshot.session_id!==packet.session_id||
       ticket.snapshot.base_revision!==packet.base_revision)
      refuse("unsigned or mismatched reviewed Planning proposal");

    const directory=dirname(this.#path);
    const meta=await lstat(directory);
    if(!meta.isDirectory()||meta.isSymbolicLink()||!owner(meta))
      refuse("Engineer plan directory must be owner-only");
    const bytes=Buffer.from(JSON.stringify(ticket.proposal.plan)+"\n","utf8");
    if(!bytes.length||bytes.length>MAX_PLAN_BYTES)
      refuse("signed Planning plan exceeds bounded Engineer input");
    const file=await open(this.#path,constants.O_WRONLY|constants.O_CREAT|
      constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{
      await file.writeFile(bytes);
      await file.sync();
    }finally{await file.close();}
    const dir=await open(directory,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dir.sync();}finally{await dir.close();}
    // Verify the signed checkpoint remains valid after disk effects.
    const after=await this.#store.load();
    if(after.proposal.digest!==packet.plan_digest||
       !isDeepStrictEqual(after.proposal.plan,ticket.proposal.plan))
      refuse("Planning provenance changed after Engineer file materialization");
  }
}
