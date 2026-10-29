/**
 * R101 trusted operational-epoch reservation journal.
 *
 * NOT a source of permission authority: the only parent is the actually
 * issued operational Rust DC, supplied by the trusted Coordinator.
 * The immutable signed original plan is reloaded separately by the
 * trusted owner and remains bound to that root.
 *
 * Persist each Task plan BEFORE child-DC issuance, A2A or provider effects.
 * Any incomplete/tampered record is a hard stop; never retry ambiguously.
 */
import {constants} from "node:fs";
import {lstat,open,readdir} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {planDigest,validatePlan} from "../../plan-contracts/src/plan.mjs";
import {preflightNextOperationalEpoch} from "../../plan-contracts/src/operational-epoch-scope.mjs";
import {approvedWorkBranch} from "../../plan-contracts/src/approved-work-branch.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u,DIGEST=/^[a-f0-9]{64}$/u;
const MAX_FILE=128*1024,MAX_EPOCHS=12;
const deny=s=>{throw Error("Trusted operational epoch journal NO-GO: "+s);};
const filename=n=>"epoch-"+String(n).padStart(3,"0")+".json";
function safeId(x){return typeof x==="string"&&ID.test(x);}
function plain(x){return !!x&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function checkMeta(meta,type){
 return (type==="dir"?meta.isDirectory():meta.isFile())&&
  !meta.isSymbolicLink()&&
  (meta.mode&0o777)===(type==="dir"?0o700:0o600)&&
  (typeof process.getuid!=="function"||meta.uid===process.getuid())&&
  (type==="dir"||meta.nlink===1);
}
export class TrustedOperationalEpochJournal {
 #dir;#session;#sha;#rootId;#originalDigest;#ops;
 constructor({directory,sessionId,baseRevision,rootCredentialId,
  originalPlanDigest,allowedOperations}={}){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||!safeId(sessionId)||
     !SHA.test(baseRevision??"")||!safeId(rootCredentialId)||
     !DIGEST.test(originalPlanDigest??"")||
     !(allowedOperations instanceof Set)||!allowedOperations.size)
    deny("invalid trusted private directory / root pins / operation catalog");
  this.#dir=directory;this.#session=sessionId;this.#sha=baseRevision;
  this.#rootId=rootCredentialId;this.#originalDigest=originalPlanDigest;
  this.#ops=new Set(allowedOperations);
 }
 assertBound({sessionId,baseRevision,rootCredentialId,originalPlanDigest}={}){
  if(sessionId!==this.#session||baseRevision!==this.#sha||
     rootCredentialId!==this.#rootId||
     originalPlanDigest!==this.#originalDigest)
   deny("Coordinator/root not bound to this journal");
 }
 async #directory(){
  let m;
  try{m=await lstat(this.#dir);}catch{deny("protected directory missing");}
  if(!checkMeta(m,"dir"))deny("directory is not owner-only");
 }
 async #syncDir(){
  const fd=await open(this.#dir,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await fd.sync();}finally{await fd.close();}
 }
 async #write(n,record){
  const value=JSON.stringify(record)+"\n";
  if(Buffer.byteLength(value,"utf8")>MAX_FILE)deny("epoch record too large");
  let fd;
  try{
   fd=await open(join(this.#dir,filename(n)),
     constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   await fd.writeFile(value,"utf8");await fd.sync();
   await fd.close();fd=undefined;await this.#syncDir();
  }catch{deny("epoch reservation uncertain, duplicated or unsafe");}
  finally{if(fd)await fd.close();}
 }
 async #read(name){
  let fd;
  try{
   fd=await open(join(this.#dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);
   const m=await fd.stat();
   if(!checkMeta(m,"file")||m.size<30||m.size>MAX_FILE)
    deny("unsafe or incomplete record");
   return JSON.parse(await fd.readFile("utf8"));
  }catch{deny("unreadable, forged or incomplete epoch record");}
  finally{if(fd)await fd.close();}
 }
 /** Every record is verified, not just the last epoch. No silent skipping. */
 async records(){
  await this.#directory();
  const names=(await readdir(this.#dir)).sort();
  if(names.length>MAX_EPOCHS)deny("epoch limit reached");
  const seenPlans=new Set(),seenTasks=new Set();
  const result=[];
  for(let i=0;i<names.length;i++){
   const n=i+1;
   if(names[i]!==filename(n))deny("missing, unexpected or out-of-order epoch record");
   const row=await this.#read(names[i]);
   if(!plain(row)||Object.keys(row).sort().join(",")!==
      "base_revision,epoch,original_plan_digest,plan,plan_digest,root_credential_id,schema,session_id"||
      row.schema!=="trusted-operational-epoch-v1"||row.epoch!==n||
      row.session_id!==this.#session||row.base_revision!==this.#sha||
      row.original_plan_digest!==this.#originalDigest||
      row.root_credential_id!==this.#rootId||!DIGEST.test(row.plan_digest??""))
     deny("invalid epoch record or root mismatch");
   validatePlan(row.plan,{allowedOperations:this.#ops});
   if(row.plan.version!==n||row.plan.session_id!==this.#session||
      row.plan.base_revision!==this.#sha||
      planDigest(row.plan)!==row.plan_digest||
      seenPlans.has(row.plan.plan_id))
     deny("epoch plan digest, version or identifier mismatch");
   seenPlans.add(row.plan.plan_id);
   for(const task of row.plan.tasks){
    if(seenTasks.has(task.id))deny("replayed Task ID in durable epoch ledger");
    seenTasks.add(task.id);
   }
   if(n===1&&row.plan_digest!==this.#originalDigest)
    deny("initial plan does not match original Engineer receipt");
   result.push({epoch:n,plan:structuredClone(row.plan),
     plan_digest:row.plan_digest,root_credential_id:this.#rootId});
  }
  return result;
 }
 async reserveInitial(plan){
  await this.#directory();
  validatePlan(plan,{allowedOperations:this.#ops});
  if(planDigest(plan)!==this.#originalDigest||
     plan.version!==1||plan.session_id!==this.#session||
     plan.base_revision!==this.#sha)deny("initial signed plan differs from root");
  if((await this.records()).length!==0)deny("original epoch already reserved");
  await this.#write(1,this.#row(1,plan));
  return Object.freeze({status:"original_epoch_reserved_no_execution_authority",
   plan_digest:this.#originalDigest,epoch:1});
 }
 #row(epoch,plan){
  return {schema:"trusted-operational-epoch-v1",session_id:this.#session,
   base_revision:this.#sha,root_credential_id:this.#rootId,
   original_plan_digest:this.#originalDigest,epoch,
   plan_digest:planDigest(plan),plan:structuredClone(plan)};
 }
 async reserveNext(candidatePlan,operationalRoot,pinnedAgentRegistry){
  // Read persisted original and historical plans, not an LLM-supplied
  // "previous plan" or replay ledger.
  const history=await this.records();
  if(!history.length)deny("initial signed epoch not durably reserved");
  if(history.length>=MAX_EPOCHS)deny("epoch limit reached");
  const first=history[0].plan,previous=history.at(-1).plan;
  if(operationalRoot?.credential_id!==this.#rootId||
     operationalRoot?.plan_digest!==this.#originalDigest)
   deny("operational parent changed since original root issuance");
  const proof=preflightNextOperationalEpoch({
   originalSignedPlan:first,previousEpochPlan:previous,candidatePlan,
   operationalRoot,pinnedAgentRegistry,
   priorTaskIds:history.flatMap(x=>x.plan.tasks.map(y=>y.id)),
   priorPlanIds:history.map(x=>x.plan.plan_id)
  },{allowedOperations:this.#ops});
  if(proof.execution_authorized!==false)
   deny("unexpected authorization result from pure preflight");
  // Cross-check original branch before irrevocably reserving the next epoch.
  if(approvedWorkBranch(first)!==approvedWorkBranch(candidatePlan))
   deny("working branch changed");
  const n=history.length+1;
  await this.#write(n,this.#row(n,candidatePlan));
  return Object.freeze({status:"next_epoch_reserved_no_execution_authority",
   epoch:n,plan_digest:proof.candidate_plan_digest,
   parent_credential_id:this.#rootId,execution_authorized:false});
 }
}
