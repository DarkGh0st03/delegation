/**
 * Separate owner-only, durable Gateway tombstones for Planning sessions.
 * A retirement ACK is issued ONLY after an exclusive file and directory fsync.
 * In-flight session registration is fenced separately by memory state.
 * Never accessible over Gateway public HTTP, ADK, A2A or MCP.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open,readdir} from "node:fs/promises";
import {isAbsolute,resolve,join} from "node:path";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ENTRY=/^[a-f0-9]{64}\.json$/u;
const MAX_BYTES=512;
type Tombstone=Readonly<{
  schema_version:1;purpose:"gateway_planning_retirement";session_id:string;
}>;
function fail(reason:string):never{
  throw Error("Trusted Gateway Planning retirement: "+reason);
}
function name(sessionId:string):string{
  if(typeof sessionId!=="string"||!SESSION.test(sessionId))
    fail("invalid session identifier");
  return createHash("sha256").update(sessionId).digest("hex")+".json";
}
function privateOwner(stat:{mode:number;uid:number}):boolean{
  return (stat.mode&0o077)===0&&
    (typeof process.getuid!=="function"||stat.uid===process.getuid());
}
function valid(raw:unknown):Tombstone{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    fail("invalid tombstone envelope");
  const x=raw as Record<string,unknown>;
  if(Object.keys(x).length!==3||x.schema_version!==1||
     x.purpose!=="gateway_planning_retirement"||
     typeof x.session_id!=="string"||!SESSION.test(x.session_id))
    fail("malformed tombstone");
  return Object.freeze(x as Tombstone);
}
export class TrustedPlanningRetirementStore{
  readonly #directory:string;
  constructor(directory:string){
    if(typeof directory!=="string"||!isAbsolute(directory)||
       resolve(directory)!==directory)
      fail("normalized absolute journal directory required");
    this.#directory=directory;
  }
  async #checkDir():Promise<void>{
    const m=await lstat(this.#directory);
    if(!m.isDirectory()||m.isSymbolicLink()||!privateOwner(m))
      fail("retirement journal directory must be owner-owned and mode 0700");
  }
  async #read(path:string):Promise<Tombstone>{
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const st=await fd.stat();
      if(!st.isFile()||!privateOwner(st)||st.size<50||st.size>MAX_BYTES)
        fail("incomplete or unsafe durable retirement tombstone");
      let value:unknown;
      try{value=JSON.parse(await fd.readFile("utf8"));}
      catch{fail("invalid retirement JSON");}
      return valid(value);
    }finally{await fd.close();}
  }
  /** Startup audit is required BEFORE the trusted Gateway listens. */
  async assertReady():Promise<void>{
    await this.#checkDir();
    for(const file of await readdir(this.#directory)){
      if(!ENTRY.test(file))fail("unexpected retirement journal entry");
      const record=await this.#read(join(this.#directory,file));
      if(name(record.session_id)!==file)
        fail("tombstone filename/session mismatch");
    }
  }
  async assertNotRetired(sessionId:string):Promise<void>{
    const file=name(sessionId);
    await this.assertReady();
    try{
      await lstat(join(this.#directory,file));
      fail("retired Planning session cannot be registered");
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    }
  }
  /** Write + fsync BEFORE responding to authenticated IPC client. */
  async markRetired(sessionId:string):Promise<void>{
    const file=name(sessionId);
    await this.assertReady();
    const path=join(this.#directory,file);
    const row: Tombstone={
      schema_version:1,purpose:"gateway_planning_retirement",
      session_id:sessionId
    };
    let fd;
    try{
      fd=await open(path,constants.O_WRONLY|constants.O_CREAT|
        constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
      const persisted=await this.#read(path);
      if(persisted.session_id!==sessionId)
        fail("replayed retirement does not match journal entry");
      return;
    }
    try{
      await fd.writeFile(JSON.stringify(row)+"\n","utf8");
      await fd.sync();
    }finally{await fd.close();}
    const dir=await open(this.#directory,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dir.sync();}finally{await dir.close();}
  }
}
