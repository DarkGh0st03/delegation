/**
 * Independent crash-durable sequential effect ledger.
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
/** Phase W: one signed write of a write-set Task, in canonical order. */
export type TrustedWritePlanItem={
 readonly sequence:number;
 readonly operation:"update_file"|"create_file";
 readonly resource:string;
};
export type TrustedSequentialManifest=TrustedTaskFenceBase&{
 readonly total_effects:number;
 /** Opt-in typed plan: N >= 1 authenticated reads (each signed file once)
  * followed by ONE write: a CAS update of a file read in the Task, or the
  * create of a new file. Derived only from the signed Task grant, never
  * from A2A/model arguments. Phase W: N >= 0 reads followed by a write-set
  * of 2..8 writes (see write_plan). */
 readonly effect_plan?:readonly ("read_file"|"update_file"|"create_file")[];
 /** Phase W only: the exact signed writes (operation + resource) of the
  * write-set, in canonical order, with their sequence numbers. */
 readonly write_plan?:readonly TrustedWritePlanItem[];
};
/** Phase W: ONE durable flight for the whole write-set of a Task. */
export type TrustedWriteSetItem={
 readonly sequence:number;
 readonly operation:"update_file"|"create_file";
 readonly resource:string;
 readonly request_id:string;
 readonly request_fingerprint:string;
};
export type TrustedWriteSetFlight=TrustedTaskFenceBase&{
 readonly total_effects:number;
 readonly first_sequence:number;
 readonly previous_evidence_sha256:string|null;
 readonly write_set_digest:string;
 readonly items:readonly TrustedWriteSetItem[];
};
export type TrustedSequentialFlight=TrustedTaskFlight&{
 readonly sequence:number;readonly total_effects:number;
 readonly previous_evidence_sha256:string|null;
 readonly operation?:"read_file"|"update_file"|"create_file";
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
/** N reads then exactly one final write (update or create), matching the
 * declared total. */
export function isReadUpdatePlan(plan:unknown,total:number):boolean{
 return Array.isArray(plan)&&plan.length===total&&total>=2&&total<=16&&
  (plan.at(-1)==="update_file"||plan.at(-1)==="create_file")&&
  plan.slice(0,-1).every(op=>op==="read_file");
}
/** Phase W: R >= 0 reads then 2..8 writes (update/create), total <= 16. */
export function isReadWriteSetPlan(plan:unknown,total:number):boolean{
 if(!Array.isArray(plan)||plan.length!==total||total<2||total>16)return false;
 const reads=plan.findIndex(op=>op!=="read_file");
 if(reads<0)return false;
 const writes=plan.slice(reads);
 return writes.length>=2&&writes.length<=8&&
  writes.every(op=>op==="update_file"||op==="create_file");
}
const RESOURCE=/^gitea:\/\/[^\s]{1,1016}$/u;
/** The write plan must be the exact, canonical (sorted, distinct) suffix of
 * the typed effect plan. */
function writePlanValid(m:TrustedSequentialManifest):boolean{
 const plan=m.effect_plan,wp=m.write_plan;
 if(!Array.isArray(plan)||!Array.isArray(wp)||!isReadWriteSetPlan(plan,m.total_effects))return false;
 const first=m.total_effects-wp.length+1;
 if(wp.length<2||plan.slice(0,first-1).some(op=>op!=="read_file"))return false;
 return wp.every((w,i)=>exact(w,["sequence","operation","resource"])&&
   w.sequence===first+i&&w.operation===plan[first-1+i]&&
   typeof w.resource==="string"&&RESOURCE.test(w.resource)&&
   (i===0||wp[i-1]!.resource<w.resource));
}
function ensureManifest(m:TrustedSequentialManifest,withFinal=false){
 const typed=Object.hasOwn(m??{},"effect_plan");
 const writeSet=Object.hasOwn(m??{},"write_plan");
 if(!exact(m,[...BASE,"total_effects",
      ...(typed?["effect_plan"]:[]),
      ...(writeSet?["write_plan"]:[]),
      ...(withFinal?["latest_evidence_sha256"]:[])])||!baseValid(m)||
    !Number.isSafeInteger(m.total_effects)||m.total_effects<2||
    m.total_effects>32||
    (writeSet&&(!typed||!writePlanValid(m)))||
    (typed&&!writeSet&&!isReadUpdatePlan(m.effect_plan,m.total_effects)))
   deny("invalid pinned Task manifest or effect count");
}
function ensureWriteSet(w:TrustedWriteSetFlight){
 if(!exact(w,[...BASE,"total_effects","first_sequence","previous_evidence_sha256",
     "write_set_digest","items"])||!baseValid(w)||
    !Number.isSafeInteger(w.total_effects)||w.total_effects<2||w.total_effects>16||
    !Number.isSafeInteger(w.first_sequence)||w.first_sequence<1||
    !SHA.test(w.write_set_digest)||!Array.isArray(w.items)||
    w.items.length<2||w.items.length>8||
    w.first_sequence+w.items.length-1!==w.total_effects||
    (w.first_sequence===1?w.previous_evidence_sha256!==null:
     !w.previous_evidence_sha256||!SHA.test(w.previous_evidence_sha256))||
    new Set(w.items.map(i=>i.request_id)).size!==w.items.length||
    !w.items.every((it,i)=>exact(it,["sequence","operation","resource","request_id","request_fingerprint"])&&
      it.sequence===w.first_sequence+i&&
      (it.operation==="update_file"||it.operation==="create_file")&&
      typeof it.resource==="string"&&RESOURCE.test(it.resource)&&
      ID.test(it.request_id)&&SHA.test(it.request_fingerprint)))
  deny("invalid immutable write-set flight");
}
function ensureFlight(f:TrustedSequentialFlight,withEvidence=false){
 if(!exact(f,[...BASE,"total_effects","sequence",
     "previous_evidence_sha256","request_id","request_fingerprint",
     ...(Object.hasOwn(f??{},"operation")?["operation"]:[]),
     ...(withEvidence?["evidence_sha256","completed_at_ms"]:[])])||
    (f.operation!==undefined&&f.operation!=="read_file"&&
     f.operation!=="update_file"&&f.operation!=="create_file")||
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
  a.previous_evidence_sha256===b.previous_evidence_sha256&&
  a.operation===b.operation;
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
 async #read(name:string,maxBytes=8192):Promise<Record<string,unknown>>{
  const fd=await open(join(this.#directory,name),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const s=await fd.stat();
   if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&s.uid!==process.getuid())||
      s.size<40||s.size>maxBytes)
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
 async #manifest(m:TrustedTaskFenceBase&{total_effects:number;effect_plan?:unknown;write_plan?:unknown},checkPlan=false){
  const item=await this.#read(this.#stem(m.session_id,m.task_id)+".manifest.json",32768);
  if(item.schema!==1||item.kind!=="manifest"||
     !sameBase(item as unknown as TrustedTaskFenceBase,m)||
     item.total_effects!==m.total_effects||
     (checkPlan&&(JSON.stringify(item.effect_plan??null)!==
       JSON.stringify(m.effect_plan??null)||
       JSON.stringify(item.write_plan??null)!==JSON.stringify(m.write_plan??null))))
   deny("recorded Task manifest does not match signed root and Child");
  return item;
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
  const manifest=await this.#manifest(f);
  const expectedPlan=manifest.effect_plan;
  // Phase W: the writes of a write-set Task are reserved ONLY together, by
  // reserveWriteSet; never as individual flights.
  if(Array.isArray(manifest.write_plan)&&
     (manifest.write_plan as TrustedWritePlanItem[]).some(w=>w.sequence===f.sequence))
   deny("a write-set write cannot be reserved as an individual flight");
  // An immutable typed manifest cannot accept an untyped flight, or a
  // second read in place of the originally pinned update operation.
  if(expectedPlan!==undefined){
   if(!Array.isArray(expectedPlan)||
      f.operation!==expectedPlan[f.sequence-1])
    deny("effect operation differs from immutable read-then-update manifest");
  }else if(f.operation!==undefined){
   deny("legacy read-only manifest cannot accept typed mutation flights");
  }
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
 /**
  * Phase W: ONE crash-durable flight for ALL writes of a write-set Task
  * (O_EXCL: at most once per Task). The exact signed writes and their order
  * must equal the manifest write plan; every planned read must already be
  * independently attested and chained.
  */
 async reserveWriteSet(w:TrustedWriteSetFlight):Promise<void>{
  ensureWriteSet(w);
  await this.#dir();
  const manifest=await this.#manifest(w);
  const plan=manifest.write_plan as TrustedWritePlanItem[]|undefined;
  if(!Array.isArray(plan)||plan.length!==w.items.length||
     !plan.every((p,i)=>p.sequence===w.items[i]!.sequence&&
       p.operation===w.items[i]!.operation&&p.resource===w.items[i]!.resource))
   deny("write-set differs from the immutable signed write plan");
  const stem=this.#stem(w.session_id,w.task_id);
  if(w.first_sequence>1){
   const previous=await this.#read(stem+"."+(w.first_sequence-1)+".evidence.json");
   if(previous.schema!==1||previous.kind!=="evidence"||
      previous.sequence!==w.first_sequence-1||
      previous.evidence_sha256!==w.previous_evidence_sha256||
      !sameBase(previous as unknown as TrustedTaskFenceBase,w)||
      previous.total_effects!==w.total_effects)
    deny("write-set requires every signed read independently attested");
  }
  await this.#write(stem+".writeset.json","writeset",w);
 }
 async reserveEvidence(e:TrustedSequentialEvidence):Promise<void>{
  ensureFlight(e,true);
  if(!SHA.test(e.evidence_sha256)||
     !Number.isSafeInteger(e.completed_at_ms)||e.completed_at_ms<=0)
   deny("invalid immutable provider evidence");
  await this.#dir();
  const manifest=await this.#manifest(e);
  if(manifest.effect_plan!==undefined&&
     (!Array.isArray(manifest.effect_plan)||
      manifest.effect_plan[e.sequence-1]!==e.operation))
   deny("typed evidence operation differs from manifest");
  if(manifest.effect_plan===undefined&&e.operation!==undefined)
   deny("untyped read-only evidence cannot claim mutation");
  const stem=this.#stem(e.session_id,e.task_id);
  const writePlan=manifest.write_plan as TrustedWritePlanItem[]|undefined;
  if(Array.isArray(writePlan)&&writePlan.some(w=>w.sequence===e.sequence)){
   // Phase W: evidence of one write of the durable write-set, strictly in
   // order: the previous effect's evidence must exist and be chained.
   const ws=await this.#read(stem+".writeset.json",32768);
   const items=ws.items as TrustedWriteSetItem[]|undefined;
   const item=Array.isArray(items)?items.find(i=>i.sequence===e.sequence):undefined;
   if(ws.schema!==1||ws.kind!=="writeset"||!item||
      !sameBase(ws as unknown as TrustedTaskFenceBase,e)||
      ws.total_effects!==e.total_effects||
      item.request_id!==e.request_id||item.request_fingerprint!==e.request_fingerprint||
      item.operation!==e.operation)
    deny("evidence does not match the durable write-set");
   const expectedPrevious=e.sequence===ws.first_sequence?ws.previous_evidence_sha256:
    (await this.#read(stem+"."+(e.sequence-1)+".evidence.json")).evidence_sha256;
   if(e.previous_evidence_sha256!==expectedPrevious)
    deny("write evidence out of order or not chained to the previous effect");
  }else{
   const original=await this.#read(stem+"."+e.sequence+".flight.json");
   if(original.schema!==1||original.kind!=="flight"||
      !sameFlight(original as unknown as TrustedSequentialFlight,e))
    deny("evidence does not match original crash-durable flight");
  }
  await this.#write(stem+"."+e.sequence+".evidence.json","evidence",e);
 }
 async reserveTaskFinal(f:TrustedSequentialFinal):Promise<void>{
  ensureManifest(f,true);
  if(!exact(f,[...BASE,"total_effects","latest_evidence_sha256",
       ...(Object.hasOwn(f??{},"effect_plan")?["effect_plan"]:[]),
       ...(Object.hasOwn(f??{},"write_plan")?["write_plan"]:[])])||
     !SHA.test(f.latest_evidence_sha256))
   deny("invalid final effect evidence digest");
  await this.#dir();
  await this.#manifest(f,true);
  const stem=this.#stem(f.session_id,f.task_id);
  const last=await this.#read(stem+"."+f.total_effects+".evidence.json");
  if(f.effect_plan!==undefined&&last.operation!==f.effect_plan.at(-1))
   deny("typed Task cannot finalize without its final verified write");
  if(last.schema!==1||last.kind!=="evidence"||
     last.sequence!==f.total_effects||
     last.total_effects!==f.total_effects||
     last.evidence_sha256!==f.latest_evidence_sha256||
     !sameBase(last as unknown as TrustedTaskFenceBase,f))
   deny("cannot finalize Task with unverified or foreign last effect");
  await this.#write(stem+".final.json","final",f);
 }
}
