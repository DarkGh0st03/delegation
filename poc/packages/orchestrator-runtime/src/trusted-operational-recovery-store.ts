/**
 * Durable pre-issuance intent ledger. An Engineer crash must not lose the
 * operational root ID needed for later independent Rust revocation.
 *
 * No private key, credential body, tool permission, or bearer token is stored.
 * Owner-only records are never caller-supplied or exposed over public HTTP.
 * A crash during an incomplete write leaves an invalid record and FAILS CLOSED.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open,readdir,link,unlink} from "node:fs/promises";
import {join,resolve} from "node:path";

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ROOT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[0-9a-f]{40}$/u;
type Intent=Readonly<{
  schema_version:1;
  session_id:string;
  base_revision:string;
  credential_id:string;
}>;
function fail(message:string):never{
  throw Error("Trusted operational recovery: "+message);
}
function validate(x:unknown):Intent{
  if(!x||typeof x!=="object"||Array.isArray(x))fail("invalid journal record");
  const o=x as Record<string,unknown>;
  if(Object.keys(o).length!==4||o.schema_version!==1||
     !SESSION.test(o.session_id as string)||!ROOT.test(o.credential_id as string)||
     !SHA.test(o.base_revision as string))
    fail("malformed persistent root intent");
  return Object.freeze(o as unknown as Intent);
}
function key(id:string):string{
  if(!SESSION.test(id))fail("invalid session ID");
  return createHash("sha256").update(id).digest("hex");
}

export class TrustedOperationalRecoveryStore{
  readonly #dir:string;
  constructor(directory:string){
    if(typeof directory!=="string"||!directory.startsWith("/"))
      fail("explicit absolute owner-only journal directory required");
    this.#dir=resolve(directory);
  }
  /** The Engineer host must use this exact Coordinator-bound store.
   * A second instance over the same path is not an authority handoff. */
  assertDirectory(directory:string):void{
    if(typeof directory!=="string"||resolve(directory)!==this.#dir)
      fail("operational journal differs from owner-configured host directory");
  }
  async #checkDir(){
    const m=await lstat(this.#dir);
    if(!m.isDirectory()||m.isSymbolicLink()||(m.mode&0o077)!==0||
       (typeof process.getuid==="function"&&m.uid!==process.getuid()))
      fail("journal directory must be real, owner-only, owned by Engineer");
  }
  #name(id:string,suffix:"pending"|"retired"):string{
    return join(this.#dir,key(id)+"."+suffix+".json");
  }
  async #read(path:string):Promise<Intent>{
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const m=await fd.stat();
      if(!m.isFile()||(m.mode&0o077)!==0||
         (typeof process.getuid==="function"&&m.uid!==process.getuid())||
         m.size<20||m.size>2048)
        fail("unsafe or incomplete recovery record");
      return validate(JSON.parse(await fd.readFile("utf8")));
    }finally{await fd.close();}
  }
  async #syncDir(){
    const d=await open(this.#dir,
      constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await d.sync();}finally{await d.close();}
  }
  /** Any outstanding/incomplete record blocks another paid run. */
  async pending():Promise<readonly Intent[]>{
    await this.#checkDir();
    const entries=(await readdir(this.#dir)).sort();
    const result:Intent[]=[];
    const seen=new Set<string>();
    for(const name of entries){
      if(!/^[0-9a-f]{64}\.(?:pending|retired)\.json$/u.test(name))
        fail("unexpected journal file; operator reconciliation required");
      const record=await this.#read(join(this.#dir,name));
      const id=key(record.session_id);
      if(id!==name.slice(0,64))
        fail("journal record does not match immutable session filename");
      if(seen.has(id))
        fail("duplicate retired and pending root for one session; manual reconciliation required");
      seen.add(id);
      if(name.endsWith(".pending.json"))result.push(record);
    }
    return Object.freeze(result);
  }
  async assertClean():Promise<void>{
    if((await this.pending()).length!==0)
      fail("orphaned root intent: reconcile before any new Planning");
  }
  /** Bootstrapping a reconciled/retired session is NOT a fresh approval. */
  async assertFreshSession(sessionId:string):Promise<void>{
    await this.assertClean();
    const retired=this.#name(sessionId,"retired");
    try{
      await lstat(retired);
    }catch(error){
      if((error as NodeJS.ErrnoException).code==="ENOENT")return;
      throw error;
    }
    fail("reconciled session cannot be reused; fresh Engineer approval required");
  }
  /** MUST run before the external Rust issuing request, never after. */
  async recordIntent(input:{
    sessionId:string;baseRevision:string;credentialId:string
  }):Promise<void>{
    const row=validate({
      schema_version:1,session_id:input.sessionId,
      base_revision:input.baseRevision,credential_id:input.credentialId
    });
    await this.assertClean();
    // Never reuse a retired session ID; no replay of an old approval.
    try{
      await lstat(this.#name(row.session_id,"retired"));
      fail("reconciled session cannot be reused");
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    }
    const fd=await open(this.#name(row.session_id,"pending"),
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{
      await fd.writeFile(JSON.stringify(row)+"\n","utf8");
      await fd.sync();
    }finally{await fd.close();}
    await this.#syncDir();
  }
  /** A journal can be retired ONLY after confirmed Gateway tombstone + DC revocation. */
  async markReconciled(input:{
    sessionId:string;baseRevision:string;credentialId:string
  }):Promise<void>{
    await this.#checkDir();
    const path=this.#name(input.sessionId,"pending");
    const row=await this.#read(path);
    if(row.session_id!==input.sessionId||row.base_revision!==input.baseRevision||
       row.credential_id!==input.credentialId)
      fail("reconciliation does not match immutable issued-root intent");
    // LINK fails if a retired name already exists, unlike rename() which
    // would overwrite the immutable retirement tombstone. Fsync the
    // durable tombstone BEFORE unlinking the pending record. If the host
    // crashes between these steps, both files remain and pending()
    // deliberately fails closed for manual reconciliation.
    await link(path,this.#name(input.sessionId,"retired"));
    await this.#syncDir();
    await unlink(path);
    await this.#syncDir();
  }
}

/** For a NEW trusted bootstrap only. No automatic authority reinstatement. */
export async function reconcileOrphanedOperationalRoots(input:{
  store:TrustedOperationalRecoveryStore;
  gateway:{retireSession(sessionId:string):void|Promise<void>};
  credentials:{revokeRoot(credentialId:string):Promise<void>};
}):Promise<number>{
  if(!(input.store instanceof TrustedOperationalRecoveryStore)||
     typeof input.gateway?.retireSession!=="function"||
     typeof input.credentials?.revokeRoot!=="function")
    fail("trusted recovery needs Gateway tombstone and Rust revocation ports");
  let reconciled=0;
  for(const row of await input.store.pending()){
    // Terminal Gateway tombstone also blocks a late activation from an
    // in-flight old Coordinator after this recovery has started.
    // A broken Gateway must NOT prevent an independent attempt to revoke
    // the actual EVM/Rust credential. Try BOTH terminal operations even
    // when the first rejects; never mark an intent retired until both are
    // independently confirmed.
    let gatewayRetired=false,rustRevoked=false;
    try{
      await input.gateway.retireSession(row.session_id);
      gatewayRetired=true;
    }catch{}
    try{
      await input.credentials.revokeRoot(row.credential_id);
      rustRevoked=true;
    }catch{}
    if(!gatewayRetired||!rustRevoked)
      fail("root revocation or Gateway retirement NOT confirmed; manual reconciliation required");
    await input.store.markReconciled({
      sessionId:row.session_id,baseRevision:row.base_revision,
      credentialId:row.credential_id
    });
    reconciled++;
  }
  return reconciled;
}
