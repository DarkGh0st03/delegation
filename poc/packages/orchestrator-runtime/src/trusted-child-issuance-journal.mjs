/**
 * R5 durable child-credential pre-issuance journal.
 * Every original protected Adapter issuance attempt MUST durably record its
 * intended identity BEFORE the network side effect. A lost reply stays
 * "issuance_uncertain", NOT "never issued". The ACK records only that the
 * original trusted issuer verified one Adapter response.
 *
 * This is an owner-local audit ledger, not Rust/EVM attestation; no bearer,
 * VC/VP, plan permissions or private keys are persisted.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open,lstat,readdir} from "node:fs/promises";
import {join,resolve,isAbsolute} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROLE=new Set(["backend","frontend","test"]);
const SHA=/^[a-f0-9]{40}$/u,DIGEST=/^[a-f0-9]{64}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const MAX_BYTES=4096;
const KEYS=[
 "schema","session_id","base_revision","plan_digest","parent_credential_id",
 "task_id","role","credential_id","status_list_credential","status_list_index"
].sort().join(",");
function deny(reason){throw Error("R5 child issuance journal NO-GO: "+reason);}
function regularRecord(obj){
  return obj&&typeof obj==="object"&&!Array.isArray(obj)&&
    Object.getPrototypeOf(obj)===Object.prototype;
}
function canonicalRecord(row){
  if(!regularRecord(row)||Object.keys(row).sort().join(",")!==KEYS||
     row.schema!=="r5-child-issuance-intent-v1"||
     !ID.test(row.session_id??"")||!SHA.test(row.base_revision??"")||
     !DIGEST.test(row.plan_digest??"")||
     !ID.test(row.parent_credential_id??"")||
     !ID.test(row.task_id??"")||!ROLE.has(row.role)||
     !ID.test(row.credential_id??"")||
     typeof row.status_list_credential!=="string"||
     !/^https:\/\//u.test(row.status_list_credential)||
     row.status_list_credential.length>512||
     typeof row.status_list_index!=="string"||
     !/^\d{1,12}$/u.test(row.status_list_index))
    deny("noncanonical child issuance intent");
  return Object.freeze({...row});
}
function hash(value){return createHash("sha256").update(value).digest("hex");}
function stem(sessionId,taskId){return hash(sessionId+"\n"+taskId);}
function protectedMeta(meta,kind){
  return meta&&!(meta.isSymbolicLink?.())&&
    (kind==="directory"?meta.isDirectory():meta.isFile())&&
    (meta.mode&0o777)===(kind==="directory"?0o700:0o600)&&
    (typeof process.getuid!=="function"||meta.uid===process.getuid());
}
export class TrustedChildIssuanceJournal {
  #directory;#sessionId;#baseRevision;#planDigest;#parentId;
  constructor({directory,sessionId,baseRevision,planDigest,parentCredentialId}={}){
    if(typeof directory!=="string"||!isAbsolute(directory)||
       resolve(directory)!==directory||!ID.test(sessionId??"")||
       !SHA.test(baseRevision??"")||!DIGEST.test(planDigest??"")||
       !ID.test(parentCredentialId??""))
      deny("independent owner directory and verified root pins required");
    this.#directory=directory;this.#sessionId=sessionId;
    this.#baseRevision=baseRevision;this.#planDigest=planDigest;
    this.#parentId=parentCredentialId;
  }
  assertBound({sessionId,baseRevision,planDigest,parentCredentialId}={}){
    if(sessionId!==this.#sessionId||baseRevision!==this.#baseRevision||
       planDigest!==this.#planDigest||parentCredentialId!==this.#parentId)
      deny("active signed root differs from journal pins");
  }
  async #checkDirectory(){
    let stat;
    try{stat=await lstat(this.#directory);}
    catch{deny("owner issuance directory unavailable");}
    if(!protectedMeta(stat,"directory"))deny("owner directory not private");
  }
  #filename(taskId,kind){
    if(!ID.test(taskId??""))deny("invalid task ID");
    return join(this.#directory,stem(this.#sessionId,taskId)+"."+kind+".json");
  }
  async #syncDirectory(){
    const d=await open(this.#directory,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await d.sync();}finally{await d.close();}
  }
  async #writeNew(filename,obj){
    const content=JSON.stringify(obj)+"\n";
    if(Buffer.byteLength(content)>MAX_BYTES)deny("oversize issuance record");
    let fd;
    try{
      fd=await open(filename,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      await fd.writeFile(content,"utf8");
      await fd.sync();
      await fd.close();fd=undefined;
      await this.#syncDirectory();
    }catch{deny("incomplete, duplicate or unsafe issuance record");}
    finally{if(fd)await fd.close();}
  }
  async #readFile(path){
    let fd;
    try{
      fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const s=await fd.stat();
      if(!protectedMeta(s,"file")||s.nlink!==1||
         s.size<20||s.size>MAX_BYTES)
        deny("unsafe, linked or partial issuance file");
      return JSON.parse(await fd.readFile("utf8"));
    }catch{deny("missing, malformed or unsafe issuance file");}
    finally{if(fd)await fd.close();}
  }
  async records(){
    await this.#checkDirectory();
    const names=(await readdir(this.#directory)).sort();
    const grouped=new Map();
    for(const name of names){
      const match=/^([a-f0-9]{64})\.(intent|ack)\.json$/u.exec(name);
      if(!match)deny("unexpected issuance journal entry");
      const data=await this.#readFile(join(this.#directory,name));
      const bucket=grouped.get(match[1])??{};
      if(bucket[match[2]])deny("duplicate issuance record");
      bucket[match[2]]=data;
      grouped.set(match[1],bucket);
    }
    const output=[];
    const ids=new Set();
    for(const [key,pair] of grouped){
      if(!pair.intent)deny("orphan issuance ACK");
      const intent=canonicalRecord(pair.intent);
      if(intent.session_id!==this.#sessionId||
         intent.base_revision!==this.#baseRevision||
         intent.plan_digest!==this.#planDigest||
         intent.parent_credential_id!==this.#parentId||
         stem(intent.session_id,intent.task_id)!==key||
         ids.has(intent.credential_id))
        deny("foreign session, duplicate credential or mismatched intent");
      ids.add(intent.credential_id);
      if(pair.ack && (!regularRecord(pair.ack)||
         Object.keys(pair.ack).sort().join(",")!==
           "credential_id,intent_sha256,schema,task_id"||
         pair.ack.schema!=="r5-child-issuance-response-v1"||
         pair.ack.task_id!==intent.task_id||
         pair.ack.credential_id!==intent.credential_id||
         pair.ack.intent_sha256!==hash(JSON.stringify(intent))))
        deny("orphan or forged child ACK");
      output.push(Object.freeze({
        ...intent,observation:pair.ack?
          "adapter_response_verified":"issuance_uncertain"
      }));
    }
    return Object.freeze(output);
  }
  /** Durable BEFORE an external Adapter HTTP issuance. No automatic retry. */
  async recordIntent({taskId,role,credentialId,
    statusListCredential,statusListIndex}={}){
    await this.#checkDirectory();
    const row=canonicalRecord({
      schema:"r5-child-issuance-intent-v1",
      session_id:this.#sessionId,base_revision:this.#baseRevision,
      plan_digest:this.#planDigest,parent_credential_id:this.#parentId,
      task_id:taskId,role,credential_id:credentialId,
      status_list_credential:statusListCredential,
      status_list_index:statusListIndex
    });
    const existing=await this.records();
    if(existing.some(x=>x.task_id===row.task_id||
       x.credential_id===row.credential_id))
      deny("task or credential was already reserved");
    await this.#writeNew(this.#filename(row.task_id,"intent"),row);
    return Object.freeze({status:"pre_issuance_intent_durable",task_id:row.task_id});
  }
  /** Called ONLY after exact trusted Adapter credential verification. */
  async recordVerifiedResponse({taskId,credentialId}={}){
    if(!ID.test(credentialId??""))deny("invalid verified credential");
    const records=await this.records();
    const row=records.find(x=>x.task_id===taskId);
    if(!row||row.credential_id!==credentialId||
       row.observation!=="issuance_uncertain")
      deny("no matching one-use uncertain issuance intent");
    const {observation,...intent}=row;
    await this.#writeNew(this.#filename(taskId,"ack"),{
      schema:"r5-child-issuance-response-v1",
      task_id:taskId,credential_id:credentialId,
      intent_sha256:hash(JSON.stringify(intent))
    });
    return Object.freeze({status:"adapter_response_verified_not_evm_attested",
      task_id:taskId,credential_id:credentialId});
  }
}
