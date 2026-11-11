import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GiteaClient} from "../../gateway/src/gitea-client.ts";
import {InMemoryRequestStore} from "../../gateway/src/prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../gateway/src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight}
 from "../../gateway/src/trusted-authority-only-create-preflight.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor}
 from "../../gateway/src/trusted-authority-only-create-executor.ts";
import {AuthenticatedGiteaCreateCompletionObserver}
 from "../../gateway/src/trusted-authority-only-gitea-create-evidence.ts";
import {assembleTrustedAuthorityOnlyNativeCreateEffects}
 from "../src/trusted-authority-only-native-create-effects.mjs";

const repository="thesis/iam-console-poc";
const branch="feature/account-suspension";
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),"r3839-owner-create-"));
 const createIntentDirectory=join(dir,"createIntent");
 const createReceiptDirectory=join(dir,"createReceipts");
 await mkdir(createIntentDirectory,{mode:0o700});
 await mkdir(createReceiptDirectory,{mode:0o700});
 t.after(()=>rm(dir,{recursive:true,force:true}));
 let gets=0,posts=0;
 const client=(owner="thesis")=>new GiteaClient({
  baseUrl:"http://gitea.local:3000",
  owner,repository:"iam-console-poc",token:"private-credential",
  fetchFn:async(_url,init)=>{
   if((init?.method??"GET")==="GET")gets++;
   else posts++;
   throw Error("NO provider calls before private Task admission");
  }
 });
 const gateway=Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype);
 const store=new InMemoryRequestStore();
 const giteaClient=client(),independentGiteaClient=client();
 const evidenceKey=Buffer.alloc(32,56);
 return {directory:dir,gateway,store,giteaClient,independentGiteaClient,
  evidenceKey,repository,branch,createIntentDirectory,createReceiptDirectory,
  counts:()=>({gets,posts})};
}
test("R383.9 owner preassembles native CREATE preflight CAS and MAC observer without provider I/O",async t=>{
 const f=await fixture(t);
 const effects=assembleTrustedAuthorityOnlyNativeCreateEffects(f);
 assert.equal(effects.preflight instanceof TrustedAuthorityOnlyGiteaCreatePreflight,true);
 assert.equal(effects.executor instanceof TrustedAuthorityOnlyGiteaCreateExecutor,true);
 assert.equal(effects.observer instanceof AuthenticatedGiteaCreateCompletionObserver,true);
 assert.equal(effects.executor.isForAdmissions(f.gateway),true);
 assert.equal(TrustedAuthorityOnlyGiteaCreatePreflight.isNativeForOwner(
  effects.preflight,f.gateway,f.giteaClient,repository,branch),true);
 assert.equal(AuthenticatedGiteaCreateCompletionObserver.isForRepository(
  effects.observer,repository,branch),true);
 assert.deepEqual(f.counts(),{gets:0,posts:0});
 assert.deepEqual(await readdir(f.createIntentDirectory),[]);
 assert.deepEqual(await readdir(f.createReceiptDirectory),[]);
});
test("R383.9 cross-owner and non-independent Gitea cannot assemble CREATE capabilities",async t=>{
 const f=await fixture(t);
 const foreign=Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype);
 const fx=assembleTrustedAuthorityOnlyNativeCreateEffects(f);
 assert.equal(fx.executor.isForAdmissions(foreign),false);
 const cases=[
  {...f,independentGiteaClient:f.giteaClient},
  {...f,independentGiteaClient:new GiteaClient({
   baseUrl:"http://gitea.local:3000",owner:"foreign",
   repository:"iam-console-poc",token:"other"
  })},
  {...f,giteaClient:new GiteaClient({
   baseUrl:"http://gitea.local:3000",owner:"foreign",
   repository:"iam-console-poc",token:"other"
  })},
  {...f,evidenceKey:Buffer.alloc(16)},
  {...f,branch:"main"},
  {...f,createReceiptDirectory:f.createIntentDirectory},
  {...f,repository:"other/iam-console-poc"}
 ];
 for(const bad of cases){
  assert.throws(()=>assembleTrustedAuthorityOnlyNativeCreateEffects(bad),
   /pinned trusted dependencies|preflight NO-WRITE|create evidence NO-GO/u);
 }
 assert.deepEqual(f.counts(),{gets:0,posts:0});
});
test("R383.9 preflight creation is not admission: absent signed Task denies before provider",async t=>{
 const f=await fixture(t);
 const fx=assembleTrustedAuthorityOnlyNativeCreateEffects(f);
 assert.throws(()=>fx.preflight.getReservedIntent({
  request:{tool:"create_file"},request_id:"forged",task_id:"forged",
  request_fingerprint:"f".repeat(64)
 }),/no reserved create intent/u);
 assert.deepEqual(f.counts(),{gets:0,posts:0});
});
