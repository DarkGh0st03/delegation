import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createPrivateKey,createPublicKey} from "node:crypto";
import {chmod,link,mkdtemp,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {bindOriginalBackendCheckpointSigner}
 from "../src/disposable-gemini-original-checkpoint-signer.mjs";

const DENIED=/Disposable original backend checkpoint signer NO-GO/u;
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),"disposable-original-backend-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const pair=generateKeyPairSync("ed25519");
 const pem=pair.privateKey.export({format:"pem",type:"pkcs8"}).toString();
 const publicPem=pair.publicKey.export({format:"pem",type:"spki"}).toString();
 const file=join(dir,"backend-private.pem");
 await writeFile(file,pem,{mode:0o600,flag:"wx"});
 let called=0;
 const store=Object.freeze({
  assertSigner(id,privatePem){
   called++;
   assert.equal(id,"backend-existing-key");
   const actual=createPublicKey(createPrivateKey(privatePem))
    .export({format:"der",type:"spki"});
   const expected=createPublicKey(publicPem)
    .export({format:"der",type:"spki"});
   assert.ok(actual.equals(expected));
  }
 });
 const checkpoint=Object.freeze({
  backendKeyId:"backend-existing-key",store
 });
 const authority=Object.freeze({
  checkpoint,workBranch:"feature/account-suspension",
  approval:Object.freeze({engineerDid:"did:engineer:original"})
 });
 const loaded=Object.freeze({backendPublicKeyPem:publicPem});
 return {dir,file,authority,loaded,pem,store,checkpoint,
  calls:()=>called};
}

test("the original backend Ed25519 signer is restored and verified by the original checkpoint store",async t=>{
 const f=await fixture(t);
 const bound=await bindOriginalBackendCheckpointSigner({
  authority:f.authority,loaded:f.loaded,
  backendPrivateKeyFile:f.file,forbiddenFiles:["/another/private/file"]
 });
 assert.notEqual(bound,f.authority);
 assert.equal(Object.isFrozen(bound),true);
 assert.equal(Object.isFrozen(bound.checkpoint),true);
 assert.equal(bound.checkpoint.store,f.store);
 assert.equal(bound.checkpoint.backendKeyId,"backend-existing-key");
 assert.equal(bound.checkpoint.backendPrivateKeyPem,f.pem);
 assert.equal(bound.approval,f.authority.approval);
 assert.equal(f.authority.checkpoint,f.checkpoint);
 assert.equal(Object.hasOwn(f.authority.checkpoint,"backendPrivateKeyPem"),false);
 assert.equal(f.calls(),1);
});

test("foreign Ed25519 and RSA keys fail closed without constructing a signer",async t=>{
 const f=await fixture(t);
 const foreign=generateKeyPairSync("ed25519").privateKey
  .export({format:"pem",type:"pkcs8"}).toString();
 await writeFile(f.file,foreign);
 await assert.rejects(bindOriginalBackendCheckpointSigner({
  authority:f.authority,loaded:f.loaded,backendPrivateKeyFile:f.file
 }),DENIED);
 const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey
  .export({format:"pem",type:"pkcs8"}).toString();
 await writeFile(f.file,rsa);
 await assert.rejects(bindOriginalBackendCheckpointSigner({
  authority:f.authority,loaded:f.loaded,backendPrivateKeyFile:f.file
 }),DENIED);
 assert.equal(f.calls(),0);
});

test("missing identity, injected signer or reused private secret file is denied",async t=>{
 const f=await fixture(t);
 for(const patch of [
  {authority:{...f.authority,checkpoint:{backendKeyId:"x"}}},
  {authority:{...f.authority,checkpoint:{
    ...f.checkpoint,backendPrivateKeyPem:"forged"
  }}},
  {loaded:{backendPublicKeyPem:"garbage"}},
  {forbiddenFiles:[f.file]},
  {forbiddenFiles:"not-an-array"},
  {backendPrivateKeyFile:"relative.pem"}
 ]){
  await assert.rejects(bindOriginalBackendCheckpointSigner({
   authority:f.authority,loaded:f.loaded,
   backendPrivateKeyFile:f.file,...patch
  }),DENIED);
 }
 assert.equal(f.calls(),0);
});

test("insecure file permissions, symlink and hardlink are rejected",async t=>{
 const f=await fixture(t);
 await chmod(f.file,0o644);
 await assert.rejects(bindOriginalBackendCheckpointSigner({
  authority:f.authority,loaded:f.loaded,backendPrivateKeyFile:f.file
 }),DENIED);
 await chmod(f.file,0o600);
 const symlinkFile=join(f.dir,"backend-link.pem");
 await symlink(f.file,symlinkFile);
 await assert.rejects(bindOriginalBackendCheckpointSigner({
  authority:f.authority,loaded:f.loaded,backendPrivateKeyFile:symlinkFile
 }),DENIED);
 const hardFile=join(f.dir,"backend-hard.pem");
 await link(f.file,hardFile);
 await assert.rejects(bindOriginalBackendCheckpointSigner({
  authority:f.authority,loaded:f.loaded,backendPrivateKeyFile:f.file
 }),DENIED);
});
