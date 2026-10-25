/**
 * Separate durable intent ledger for provisional read-only Planning roots.
 * Save BEFORE Gateway registration / Rust issuance. A crashed or ambiguous
 * issue attempt remains potentially live until confirmed revocation.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open,readdir,rename} from "node:fs/promises";
import {isAbsolute,resolve,join} from "node:path";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,SHA=/^[a-f0-9]{40}$/u;
type Intent=Readonly<{schema_version:1;purpose:"planning";
  session_id:string;base_revision:string;credential_id:string}>;
function fail(reason:string):never{throw Error("Trusted Planning recovery: "+reason);}
function validated(x:unknown):Intent{
  if(!x||typeof x!=="object"||Array.isArray(x))fail("invalid root intent");
  const r=x as Record<string,unknown>;
  if(Object.keys(r).length!==5||r.schema_version!==1||r.purpose!=="planning"||
     typeof r.session_id!=="string"||!ID.test(r.session_id)||
     typeof r.credential_id!=="string"||!ID.test(r.credential_id)||
     typeof r.base_revision!=="string"||!SHA.test(r.base_revision))
    fail("malformed provisional root intent");
  return Object.freeze(r as Intent);
}
function hash(id:string):string{
  if(!ID.test(id))fail("invalid session ID");
  return createHash("sha256").update(id).digest("hex");
}
function owner(m:{uid:number;mode:number}){
  return (m.mode&0o077)===0&&
    (typeof process.getuid!=="function"||process.getuid()===m.uid);
}
export class TrustedPlanningRecoveryStore{
  readonly #dir:string;
  constructor(directory:string){
    if(typeof directory!=="string"||!isAbsolute(directory)||
       resolve(directory)!==directory)
      fail("absolute owner-only journal directory required");
    this.#dir=directory;
  }
  #path(id:string,part:"pending"|"retired"){return join(this.#dir,hash(id)+"."+part+".json");}
  /** Bind in-memory trusted Coordinator to the same owner-private durable
   * journal configured for the Engineer host. No separate lookalike file. */
  assertDirectory(directory:string):void{
    if(typeof directory!=="string"||resolve(directory)!==this.#dir)
      fail("active Planning journal differs from configured host directory");
  }
  async #check(){
    const m=await lstat(this.#dir);
    if(!m.isDirectory()||m.isSymbolicLink()||!owner(m))
      fail("Planning journal directory must be owner-only");
  }
  async #sync(){
    const dir=await open(this.#dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dir.sync();}finally{await dir.close();}
  }
  async #read(path:string):Promise<Intent>{
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const m=await fd.stat();
      if(!m.isFile()||!owner(m)||m.size<40||m.size>2048)
        fail("unsafe or incomplete Planning journal");
      let json:unknown;
      try{json=JSON.parse(await fd.readFile("utf8"));}
      catch{fail("invalid persistent Planning JSON");}
      return validated(json);
    }finally{await fd.close();}
  }
  async pending():Promise<readonly Intent[]>{
    await this.#check();
    const names=(await readdir(this.#dir)).sort();
    const pending:Intent[]=[],seen=new Set<string>();
    for(const name of names){
      if(!/^[a-f0-9]{64}\.(?:pending|retired)\.json$/u.test(name))
        fail("unexpected journal file; manual reconciliation required");
      const r=await this.#read(join(this.#dir,name));
      const k=hash(r.session_id);
      if(!name.startsWith(k+".")||seen.has(k))
        fail("journal ID mismatch or duplicate session");
      seen.add(k);
      if(name.endsWith(".pending.json"))pending.push(r);
    }
    return Object.freeze(pending);
  }
  async assertClean(){
    if((await this.pending()).length)fail("orphaned Planning root intent");
  }
  async assertFreshSession(sessionId:string){
    await this.assertClean();
    try{await lstat(this.#path(sessionId,"retired"));fail("retired session cannot be reused");}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
  async recordIntent(input:{sessionId:string;baseRevision:string;credentialId:string}){
    const row=validated({schema_version:1,purpose:"planning",
      session_id:input.sessionId,base_revision:input.baseRevision,
      credential_id:input.credentialId});
    await this.assertFreshSession(row.session_id);
    const fd=await open(this.#path(row.session_id,"pending"),
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await fd.writeFile(JSON.stringify(row)+"\n","utf8");await fd.sync();}
    finally{await fd.close();}
    await this.#sync();
  }
  /** Caller must have independently confirmed Gateway retirement and
   * native Rust/Adapter revocation. Never overwrite a retired tombstone. */
  async markReconciled(input:{sessionId:string;baseRevision:string;credentialId:string}){
    await this.#check();
    const row=await this.#read(this.#path(input.sessionId,"pending"));
    if(row.session_id!==input.sessionId||
       row.base_revision!==input.baseRevision||
       row.credential_id!==input.credentialId)
      fail("reconciliation does not match immutable Planning intent");
    try{await lstat(this.#path(input.sessionId,"retired"));fail("retired intent already exists");}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    await rename(this.#path(input.sessionId,"pending"),
      this.#path(input.sessionId,"retired"));
    await this.#sync();
  }
}
export async function reconcileOrphanedPlanningRoots(input:{
  store:TrustedPlanningRecoveryStore;
  gateway:{retirePlanning(sessionId:string):void|Promise<void>};
  credentials:{revokeRoot(credentialId:string):Promise<void>};
}):Promise<number>{
  if(!(input.store instanceof TrustedPlanningRecoveryStore)||
     typeof input.gateway?.retirePlanning!=="function"||
     typeof input.credentials?.revokeRoot!=="function")
    fail("trusted Gateway Planning retirement and Rust revocation required");
  let done=0;
  for(const r of await input.store.pending()){
    let gateway=false,rust=false;
    try{await input.gateway.retirePlanning(r.session_id);gateway=true;}catch{}
    try{await input.credentials.revokeRoot(r.credential_id);rust=true;}catch{}
    if(!gateway||!rust)
      fail("provisional root cancellation not confirmed; manual reconciliation required");
    await input.store.markReconciled({sessionId:r.session_id,
      baseRevision:r.base_revision,credentialId:r.credential_id});
    done++;
  }
  return done;
}
