/**
 * Owner-only, durable Gateway operational session fence.
 *
 * Every trusted activation reserves its exact session ID on disk BEFORE
 * loading human consent or exposing a usable plan. A restarted Gateway MUST
 * NOT resurrect an earlier signed approval or operational credential.
 *
 * Terminal retire commands also reserve unknown session IDs on disk, so a
 * late activation after recovery cannot succeed after process restart.
 * No receipt, bearer token or private key is stored in this journal.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open,readdir} from "node:fs/promises";
import {isAbsolute,resolve,join} from "node:path";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ENTRY=/^[a-f0-9]{64}\.json$/u;
type Event="activation_reserved"|"retired";
type RecordV1=Readonly<{
  schema_version:1;purpose:"gateway_operational_session_fence";
  session_id:string;event:Event
}>;
function fail(reason:string):never{
  throw Error("Trusted Gateway operational journal: "+reason);
}
function name(sessionId:string):string{
  if(typeof sessionId!=="string"||!ID.test(sessionId))
    fail("invalid operational session");
  return createHash("sha256").update(sessionId).digest("hex")+".json";
}
function owned(st:{uid:number;mode:number}):boolean{
  return (st.mode&0o077)===0&&
    (typeof process.getuid!=="function"||st.uid===process.getuid());
}
function validate(raw:unknown):RecordV1{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("malformed journal");
  const x=raw as Record<string,unknown>;
  if(Object.keys(x).length!==4||x.schema_version!==1||
     x.purpose!=="gateway_operational_session_fence"||
     typeof x.session_id!=="string"||!ID.test(x.session_id)||
     (x.event!=="activation_reserved"&&x.event!=="retired"))
    fail("invalid operational terminal entry");
  return Object.freeze(x as RecordV1);
}
export class TrustedOperationalSessionStore{
  readonly #dir:string;
  constructor(directory:string){
    if(typeof directory!=="string"||!isAbsolute(directory)||
       resolve(directory)!==directory)
      fail("normalized absolute owner-only directory required");
    this.#dir=directory;
  }
  async #checkDir(){
    const st=await lstat(this.#dir);
    if(!st.isDirectory()||st.isSymbolicLink()||!owned(st))
      fail("operational journal directory must be owner-only");
  }
  async #read(path:string):Promise<RecordV1>{
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const st=await fd.stat();
      if(!st.isFile()||!owned(st)||st.size<55||st.size>512)
        fail("unsafe or incomplete operational journal");
      let data:unknown;
      try{data=JSON.parse(await fd.readFile("utf8"));}
      catch{fail("corrupt operational journal JSON");}
      return validate(data);
    }finally{await fd.close();}
  }
  /** Required before starting any real provider-facing Gateway listener. */
  async assertReady():Promise<void>{
    await this.#checkDir();
    const names=(await readdir(this.#dir)).sort();
    for(const entry of names){
      if(!ENTRY.test(entry))fail("unexpected operational journal entry");
      const row=await this.#read(join(this.#dir,entry));
      if(name(row.session_id)!==entry)
        fail("operational filename and session disagree");
    }
  }
  async #reserve(sessionId:string,event:Event,allowExisting:boolean){
    const filename=name(sessionId);
    await this.assertReady();
    const full=join(this.#dir,filename);
    let fd;
    try{
      fd=await open(full,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
      // Activation is strictly one-shot. Retirement may be repeated.
      if(!allowExisting)fail("operational session already used or retired");
      const old=await this.#read(full);
      if(old.session_id!==sessionId)
        fail("operational journal replay ID mismatch");
      return;
    }
    try{
      await fd.writeFile(JSON.stringify({
        schema_version:1,purpose:"gateway_operational_session_fence",
        session_id:sessionId,event
      })+"\n","utf8");
      await fd.sync();
    }finally{await fd.close();}
    const dir=await open(this.#dir,constants.O_RDONLY|
      constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dir.sync();}finally{await dir.close();}
  }
  /** Durable before external approval lookup, task binding, or provider I/O. */
  async reserveActivation(sessionId:string):Promise<void>{
    await this.#reserve(sessionId,"activation_reserved",false);
  }
  /** Durable before authenticated Gateway control acknowledges retirement. */
  async markRetired(sessionId:string):Promise<void>{
    await this.#reserve(sessionId,"retired",true);
  }
}
