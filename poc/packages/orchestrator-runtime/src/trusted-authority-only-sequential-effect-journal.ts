/**
 * R301 — independent crash-durable sequential effect ledger.
 *
 * Gateway-owner only. A signed Task/Child/VP/OPA/real provider result is
 * required by its caller. Neither a journal marker nor a signed HMAC by
 * itself proves a provider effect or authorizes a new operation.
 *
 * A failed fsync, lost ACK or partially written marker remains terminal:
 * no retries, truncation, overwriting or implicit recovery.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import type {TrustedTaskFenceBase,TrustedTaskFlight}
 from "./trusted-authority-only-task-fence-journal.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{64}$/u;
const hash=(x:string)=>createHash("sha256").update(x).digest("hex");
function deny(reason:string):never{
 throw Error("Authority-only sequential effect ledger: "+reason);
}
export type TrustedSequentialManifest=TrustedTaskFenceBase&{
 readonly total_effects:number;
};
export type TrustedSequentialFlight=TrustedTaskFlight&{
 readonly sequence:number;readonly total_effects:number;
 readonly previous_evidence_sha256:string|null;
};
export type TrustedSequentialEvidence=TrustedSequentialFlight&{
 readonly evidence_sha256:string;readonly completed_at_ms:number;
};
export type TrustedSequentialFinal=TrustedSequentialManifest&{
 readonly latest_evidence_sha256:string;
};
const BASE=["session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","credential_id"] as const;
function exact(obj:unknown,keys:readonly string[]):obj is Record<string,unknown>{
 return !!obj&&typeof obj==="object"&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join(",")===Array.from(keys).sort().join(",");
}
function baseValid(x:TrustedTaskFenceBase):boolean{
 return !!x&&BASE.every(k=>Object.hasOwn(x,k))&&
  ID.test(x.session_id)&&ID.test(x.root_credential_id)&&
  ID.test(x.task_id)&&ID.test(x.runtime_task_id)&&
  ID.test(x.credential_id)&&
  x.credential_id!==x.root_credential_id&&
  SHA.test(x.authority_digest)&&Number.isSafeInteger(x.epoch)&&
  x.epoch>=1&&x.epoch<=256;
}
function sameBase(a:TrustedTaskFenceBase,b:TrustedTaskFenceBase){
 return BASE.every(k=>a[k]===b[k]);
}
function ensureManifest(m:TrustedSequentialManifest,withFinal=false){
 if(!exact(m,[...BASE,"total_effects",
      ...(withFinal?["latest_evidence_sha256"]:[])])||!baseValid(m)||
    !Number.isSafeInteger(m.total_effects)||m.total_effects<2||
    m.total_effects>32)deny("invalid pinned Task manifest or effect count");
}
function ensureFlight(f:TrustedSequentialFlight,withEvidence=false){
 if(!exact(f,[...BASE,"total_effects","sequence",
     "previous_evidence_sha256","request_id","request_fingerprint",
     ...(withEvidence?["evidence_sha256","completed_at_ms"]:[])])||
    !baseValid(f)||!ID.test(f.request_id)||!SHA.test(f.request_fingerprint)||
    !Number.isSafeInteger(f.sequence)||f.sequence<1||
    f.sequence>f.total_effects||
    (f.sequence===1?f.previous_evidence_sha256!==null:
     !f.previous_evidence_sha256||!SHA.test(f.previous_evidence_sha256)))
  deny("invalid immutable effect sequence or Prepare");
}
function sameFlight(a:TrustedSequentialFlight,b:TrustedSequentialFlight){
 return sameBase(a,b)&&a.total_effects===b.total_effects&&
  a.sequence===b.sequence&&a.request_id===b.request_id&&
  a.request_fingerprint===b.request_fingerprint&&
  a.previous_evidence_sha256===b.previous_evidence_sha256;
}
export class DurableAuthorityOnlySequentialEffectJournal{
 readonly #directory:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("provisioned absolute owner-private effect directory required");
  this.#directory=directory;
 }
 async #dir(){
  const s=await lstat(this.#directory);
  if(!s.isDirectory()||s.isSymbolicLink()||
     (s.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&s.uid!==process.getuid()))
   deny("unsafe Task effect journal directory");
 }
 #stem(session:string,task:string){
  return hash(session+"\n"+task);
 }
 async #read(name:string):Promise<Record<string,unknown>>{
  const fd=await open(join(this.#directory,name),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const s=await fd.stat();
   if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&s.uid!==process.getuid())||
      s.size<40||s.size>8192)
    deny("unsafe, missing or incomplete historical effect marker");
   const data=JSON.parse(await fd.readFile("utf8")) as unknown;
   if(!data||typeof data!=="object"||Array.isArray(data))
    deny("invalid durable effect evidence");
   return data as Record<string,unknown>;
  }finally{await fd.close();}
 }
 async #write(name:string,kind:string,record:object){
  const fd=await open(join(this.#directory,name),
   constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,
   0o600);
  try{
   const s=await fd.stat();
   if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&s.uid!==process.getuid()))
    deny("unsafe newly created effect marker");
   await fd.writeFile(JSON.stringify({schema:1,kind,...record})+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const d=await open(this.#directory,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await d.sync();}finally{await d.close();}
 }
 async #manifest(m:TrustedSequentialManifest){
  const item=await this.#read(this.#stem(m.session_id,m.task_id)+".manifest.json");
  if(item.schema!==1||item.kind!=="manifest"||
     !sameBase(item as unknown as TrustedTaskFenceBase,m)||
     item.total_effects!==m.total_effects)
   deny("recorded Task manifest does not match signed root and Child");
 }
 async reserveManifest(m:TrustedSequentialManifest):Promise<void>{
  ensureManifest(m);
  await this.#dir();
  await this.#write(this.#stem(m.session_id,m.task_id)+".manifest.json",
   "manifest",m);
 }
 async reserveEffect(f:TrustedSequentialFlight):Promise<void>{
  ensureFlight(f);
  await this.#dir();
  await this.#manifest(f);
  const stem=this.#stem(f.session_id,f.task_id);
  // A later effect requires the precisely matching previous durable
  // verified evidence. A reserved but unconfirmed prior flight is terminal.
  if(f.sequence>1){
   const previous=await this.#read(stem+"."+(f.sequence-1)+".evidence.json");
   if(previous.schema!==1||previous.kind!=="evidence"||
      previous.sequence!==f.sequence-1||
      previous.evidence_sha256!==f.previous_evidence_sha256||
      !sameBase(previous as unknown as TrustedTaskFenceBase,f)||
      previous.total_effects!==f.total_effects)
    deny("previous effect not independently attested and chained");
  }
  await this.#write(stem+"."+f.sequence+".flight.json","flight",f);
 }
 async reserveEvidence(e:TrustedSequentialEvidence):Promise<void>{
  ensureFlight(e,true);
  if(!SHA.test(e.evidence_sha256)||
     !Number.isSafeInteger(e.completed_at_ms)||e.completed_at_ms<=0)
   deny("invalid immutable provider evidence");
  await this.#dir();
  await this.#manifest(e);
  const stem=this.#stem(e.session_id,e.task_id);
  const original=await this.#read(stem+"."+e.sequence+".flight.json");
  if(original.schema!==1||original.kind!=="flight"||
     !sameFlight(original as unknown as TrustedSequentialFlight,e))
   deny("evidence does not match original crash-durable flight");
  await this.#write(stem+"."+e.sequence+".evidence.json","evidence",e);
 }
 async reserveTaskFinal(f:TrustedSequentialFinal):Promise<void>{
  ensureManifest(f,true);
  if(!exact(f,[...BASE,"total_effects","latest_evidence_sha256"])||
     !SHA.test(f.latest_evidence_sha256))
   deny("invalid final effect evidence digest");
  await this.#dir();
  await this.#manifest(f);
  const stem=this.#stem(f.session_id,f.task_id);
  const last=await this.#read(stem+"."+f.total_effects+".evidence.json");
  if(last.schema!==1||last.kind!=="evidence"||
     last.sequence!==f.total_effects||
     last.total_effects!==f.total_effects||
     last.evidence_sha256!==f.latest_evidence_sha256||
     !sameBase(last as unknown as TrustedTaskFenceBase,f))
   deny("cannot finalize Task with unverified or foreign last effect");
  await this.#write(stem+".final.json","final",f);
 }
}
