import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,chmod,readdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GiteaClient} from "../src/gitea-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions as Admissions}
 from "../src/trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight as Preflight}
 from "../src/trusted-authority-only-create-preflight.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal as Journal}
 from "../src/trusted-authority-only-create-intent-journal.ts";
import type {PreparedRequestRecord} from "../src/types.ts";
import {executeAuthorization} from "../src/execute.ts";
import {InMemoryRequestStore} from "../src/prepare.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor as CreateExecutor}
 from "../src/trusted-authority-only-create-executor.ts";
import {AuthenticatedGiteaCreateCompletionObserver as CreateObserver,
 TrustedGatewayGiteaCreateEvidencePublisher as CreatePublisher}
 from "../src/trusted-authority-only-gitea-create-evidence.ts";

const HEAD="a".repeat(40),NEXT="b".repeat(40);
const branch="feature/account-suspension";
const path="apps/backend/src/new-handler.ts";
const repository="thesis/iam-console-poc";
const content="export const suspend = true;\n";
const bound=Object.freeze({
 session_id:"r3833-owner",authority_digest:"c".repeat(64),
 root_credential_id:"urn:r3833:original-root",
 task_id:"task-3833",runtime_task_id:"runtime-3833",
 epoch:7,agent_did:"did:ethr:0x7a69:r3833",
 credential_id:"urn:r3833:child",request_id:"req-3833",
 request_fingerprint:"d".repeat(64)
});
async function fixture(t:import("node:test").TestContext,opts:{
 exists?:boolean;status?:number;head?:string;
 changeHeadDuringRead?:boolean;expire?:boolean;
 blockGateway?:boolean;foreignGitea?:boolean
}={}){
 const dir=await mkdtemp(join(tmpdir(),"r3833-create-intent-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 let head=opts.head??HEAD,gets=0,writes=0,gateCalls=0;
 const fetchFn:typeof fetch=(async(raw:URL|string,init?:RequestInit)=>{
  const url=new URL(String(raw));
  const method=init?.method??"GET";
  if(method!=="GET"){writes++;throw Error("No Gitea writes during create intent reservation");}
  gets++;
  const root="/api/v1/repos/thesis/iam-console-poc";
  const json=(body:object,status=200)=>new Response(JSON.stringify(body),{
   status,headers:{"content-type":"application/json"}
  });
  if(url.pathname===root+"/branches/"+encodeURIComponent(branch))
   return json({name:branch,commit:{id:head}});
  if(url.pathname===root+"/contents/"+path&&url.searchParams.get("ref")===HEAD){
   if(opts.changeHeadDuringRead)head=NEXT;
   if(opts.status)return json({message:"not a trustworthy absence"},opts.status);
   if(opts.exists)return json({type:"file",path,sha:"e".repeat(40),
    encoding:"base64",content:Buffer.from("already present").toString("base64"),
    size:15});
   return json({message:"absent"},404);
  }
  throw Error("Unexpected owner create preflight GET "+url.pathname);
 }) as typeof fetch;
 const giteaClient=new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:opts.foreignGitea?"other":"thesis",
  repository:"iam-console-poc",token:"owner-private",fetchFn
 });
 const record={
  consumed:false,request_id:bound.request_id,task_id:bound.runtime_task_id,
  request_fingerprint:bound.request_fingerprint,
  expires_at_ms:Date.now()+(opts.expire?-1:60000),
  request:{tool:"create_file",arguments:{branch,path,content}}
 } as unknown as PreparedRequestRecord;
 const admissions=Object.assign(Object.create(Admissions.prototype),{
  assertTrustedGiteaCreateIntentBinding(actual:PreparedRequestRecord){
   gateCalls++;
   assert.equal(actual,record,"only original in-memory Prepare can reach owner preflight");
   if(opts.blockGateway)throw Error("Gateway rejected untrusted Child before Gitea read");
   return bound;
  }
 }) as Admissions;
 const journal=new Journal(dir);
 const mkPreflight=()=>new Preflight({admissions,giteaClient,journal,
  branch,repository,nowMs:()=>Date.now()});
 return {dir,record,admissions,journal,giteaClient,mkPreflight,
  stats:()=>({head,gets,writes,gateCalls})};
}

test("R383.3 original signed Child + absent HEAD reserves durable one-use NO-WRITE create intent",async t=>{
 const f=await fixture(t);
 const preflight=f.mkPreflight();
 const stage=await preflight.stageCreate(f.record,HEAD);
 assert.equal(stage.status,"gitea_create_intent_reserved_without_execution");
 assert.equal(stage.provider_write_authorized,false);
 assert.equal(stage.intent.provider_write_authorized,false);
 assert.equal(stage.intent.old_path_absent_at_pinned_head,true);
 assert.equal(stage.intent.expected_head_sha,HEAD);
 assert.equal(stage.intent.path,path);
 assert.equal(stage.intent.repository,repository);
 assert.equal(stage.intent.request_id,bound.request_id);
 assert.equal(stage.intent.agent_did,bound.agent_did);
 assert.equal(stage.intent.next_content_sha256,
  createHash("sha256").update(content).digest("hex"));
 assert.equal(stage.intent.next_content_bytes,Buffer.byteLength(content));
 await f.journal.assertReserved(stage.intent);
 assert.equal(preflight.getReservedIntent(f.record),stage.intent);
 assert.equal(f.stats().writes,0);
 assert.equal(f.stats().gets,3,"HEAD → pinned absence → HEAD");
 assert.deepEqual(await readdir(f.dir),[
  createHash("sha256").update(bound.session_id+"\n"+bound.task_id)
   .digest("hex")+".create-intent.json"
 ]);
 const persisted=JSON.parse(await readFile(
  join(f.dir,(await readdir(f.dir))[0]),"utf8"));
 assert.deepEqual(persisted,stage.intent);
 assert.equal("expected_blob_sha" in persisted,false,
  "a genuinely new file must never receive an invented old blob SHA");
 assert.equal("verification" in persisted,false,
  "preflight does not claim a Rust VP, OPA or Task completion");
 await assert.rejects(preflight.stageCreate(f.record,HEAD),
  /concurrent or repeated create preflight/u);
 assert.equal(f.stats().gets,3);
 await assert.rejects(f.mkPreflight().stageCreate(f.record,HEAD),
  /EEXIST/u);
 assert.equal(f.stats().writes,0);
});

for(const mode of ["already-exists","stale-head","head-moves",
 "503-is-not-absence","expired","gateway-denies"] as const){
 test("R383.3 fail closed on "+mode+" with no durable intent or provider writes",async t=>{
  const f=await fixture(t,{
   exists:mode==="already-exists",
   head:mode==="stale-head"?NEXT:HEAD,
   changeHeadDuringRead:mode==="head-moves",
   status:mode==="503-is-not-absence"?503:undefined,
   expire:mode==="expired",blockGateway:mode==="gateway-denies"
  });
  const preflight=f.mkPreflight();
  await assert.rejects(preflight.stageCreate(f.record,HEAD));
  assert.equal(f.stats().writes,0);
  assert.deepEqual(await readdir(f.dir),[]);
  const oldReads=f.stats().gets;
  await assert.rejects(preflight.stageCreate(f.record,HEAD));
  assert.equal(f.stats().gets,oldReads,
   "the original ambiguous preflight must never be repeated");
 });
}
test("R383.3 journal rejects replay, altered Child, forged old absence, unsafe directory and path",async t=>{
 const f=await fixture(t);
 const result=await f.mkPreflight().stageCreate(f.record,HEAD);
 for(const change of [
  {credential_id:"urn:r3833:forged"},
  {old_path_absent_at_pinned_head:false},
  {provider_write_authorized:true},
  {expected_head_sha:NEXT},
  {path:"apps/backend/../other.ts"},
  {repository:"thesis/another-repo"},
  {epoch:0},
  {next_content_bytes:0},
  {schema:"authority-only-gitea-update-intent-v1"}
 ]){
  const forged={...result.intent,...change};
  await assert.rejects(f.journal.assertReserved(forged as never),
   /create intent|untrusted|differs/u);
  await assert.rejects(f.journal.reserve(forged as never),
   /create intent|untrusted|EEXIST/u);
 }
 await chmod(f.dir,0o755);
 await assert.rejects(f.journal.assertReserved(result.intent),/unsafe shared/u);
 await assert.rejects(f.journal.reserve(result.intent),/unsafe shared/u);
 assert.equal(f.stats().writes,0);
});
test("R383.3 preflight refuses foreign repository client and unknown original Prepare identity",async t=>{
 const f=await fixture(t);
 assert.equal(Preflight.isNativeForOwner(f.mkPreflight(),f.admissions,
  f.giteaClient,repository,branch),true);
 assert.equal(Preflight.isNativeForOwner(f.mkPreflight(),f.admissions,
  f.giteaClient,"foreign/repository",branch),false);
 assert.throws(()=>f.mkPreflight().getReservedIntent(f.record),
  /no reserved create intent/u);
 const foreign=await fixture(t,{foreignGitea:true});
 assert.throws(()=>foreign.mkPreflight(),/original Gateway, Gitea repository/u);
 assert.equal(foreign.stats().gets,0);
});

test("R383.4 create attempt is durable, exactly once and never a provider write",async t=>{
 const f=await fixture(t);
 const {intent}=await f.mkPreflight().stageCreate(f.record,HEAD);
 await f.journal.reserveAttempt(intent);
 const stem=createHash("sha256").update(bound.session_id+"\n"+bound.task_id)
  .digest("hex");
 assert.deepEqual((await readdir(f.dir)).sort(),[
  stem+".create-attempt.json",stem+".create-intent.json"
 ].sort());
 const attempt=JSON.parse(await readFile(join(f.dir,
  stem+".create-attempt.json"),"utf8"));
 assert.equal(attempt.schema,"authority-only-gitea-create-attempt-v1");
 assert.equal(attempt.provider_write_authorized,false);
 assert.equal(attempt.root_credential_id,intent.root_credential_id);
 assert.equal(attempt.credential_id,intent.credential_id);
 assert.equal(attempt.request_fingerprint,intent.request_fingerprint);
 assert.equal(attempt.expected_head_sha,HEAD);
 assert.equal(attempt.next_content_sha256,intent.next_content_sha256);
 await assert.rejects(f.journal.reserveAttempt(intent),/EEXIST/u);
 // A process restart must not convert an ambiguous request into a retry.
 await assert.rejects(new Journal(f.dir).reserveAttempt(intent),/EEXIST/u);
 await assert.rejects(f.journal.reserveAttempt({
  ...intent,credential_id:"urn:foreign:child"
 } as never),/differs/u);
 assert.equal(f.stats().writes,0);
 assert.equal(f.stats().gets,3);
});

test("R383.4 simultaneous attempt reservations cannot issue two writes",async t=>{
 const f=await fixture(t);
 const {intent}=await f.mkPreflight().stageCreate(f.record,HEAD);
 const independent=new Journal(f.dir);
 const results=await Promise.allSettled([
  f.journal.reserveAttempt(intent),independent.reserveAttempt(intent)
 ]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(results.filter(x=>x.status==="rejected").length,1);
 assert.equal((await readdir(f.dir)).filter(x=>
  x.endsWith(".create-attempt.json")).length,1);
 assert.equal(f.stats().writes,0);
});

test("R383.4 failed preflight cannot reserve a create attempt",async t=>{
 const f=await fixture(t,{status:503});
 await assert.rejects(f.mkPreflight().stageCreate(f.record,HEAD));
 const forged={...bound,
  schema:"authority-only-gitea-create-intent-v1",
  kind:"create_file_preflight_only",
  repository,branch,path,expected_head_sha:HEAD,
  old_path_absent_at_pinned_head:true,
  next_content_sha256:createHash("sha256").update(content).digest("hex"),
  next_content_bytes:Buffer.byteLength(content),prepared_at_ms:Date.now(),
  provider_write_authorized:false
 };
 await assert.rejects(f.journal.reserveAttempt(forged as never));
 assert.deepEqual(await readdir(f.dir),[]);
 assert.equal(f.stats().writes,0);
});

/**
 * R383.5 post-native boundary tests. These are intentionally OFFLINE:
 * the admission double enforces its input identity, not a real Rust/OPA
 * cryptographic result or real Task flight. The production method uses the
 * private admission class; executeAuthorization is NOT yet wired for create.
 */
test("R383.5 immutable preflight joins consumed native Child VP, OPA and original flight without write",async t=>{
 const f=await fixture(t);
 const preflight=f.mkPreflight();
 const {intent}=await preflight.stageCreate(f.record,HEAD);
 const verified={presenter_id:bound.agent_did,
  credential_id:bound.credential_id,
  root_credential_id:bound.root_credential_id,
  hierarchy_depth:1,
  permissions:[{operation:"create_file",resource:"gitea://example"}]};
 const policy={allow:true,policy_version:"r3835-opa"};
 let admitted=0;
 Object.assign(f.admissions,{
  assertTrustedCreateNativeAdmissionBinding(
   actual:PreparedRequestRecord,proof:typeof verified){
   admitted++;
   assert.equal(actual,f.record);
   if(proof!==verified)throw Error("different original native verifier response");
   return bound;
  }
 });
 f.record.consumed=true;
 const response=await preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified as never,policy as never);
 assert.equal(response.status,"native_create_task_admitted_no_provider_write");
 assert.equal(response.provider_write_authorized,false);
 assert.equal(response.request_id,intent.request_id);
 assert.equal(response.task_id,intent.task_id);
 assert.equal(admitted,1);
 assert.deepEqual((await readdir(f.dir)).length,1,
  "this read-only admission MUST NOT reserve an attempt or attest completion");
 assert.equal(f.stats().writes,0);
});

test("R383.5 fails closed on missing native admission, unconsumed request and OPA denial",async t=>{
 const f=await fixture(t);
 const preflight=f.mkPreflight();
 await preflight.stageCreate(f.record,HEAD);
 const verified={} as never;
 const allow={allow:true,policy_version:"opa"} as never;
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,allow),/consumed Prepare/u);
 f.record.consumed=true;
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,{allow:false,policy_version:"opa"} as never),
  /native VP\/OPA allow/u);
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,{allow:true,policy_version:""} as never),
  /native VP\/OPA allow/u);
 Object.assign(f.admissions,{
  assertTrustedCreateNativeAdmissionBinding(){
   throw Error("Gateway missing durable Task flight or native Child VP");
  }
 });
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,allow),/missing durable Task flight/u);
 assert.equal(f.stats().writes,0);
 assert.deepEqual((await readdir(f.dir)).length,1);
});

test("R383.5 rejects mutable source, changed admission binding and tampered on-disk intent",async t=>{
 const f=await fixture(t);
 const preflight=f.mkPreflight();
 const {intent}=await preflight.stageCreate(f.record,HEAD);
 Object.assign(f.admissions,{
  assertTrustedCreateNativeAdmissionBinding(){return bound;}
 });
 f.record.consumed=true;
 const verified={} as never;
 const allow={allow:true,policy_version:"opa"} as never;
 const request=f.record.request;
 if(request.tool!=="create_file")throw Error("fixture is not create_file");
 const oldContent=request.arguments.content;
 request.arguments.content=oldContent+"// unapproved change";
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,allow),/differs from immutable reserved intent/u);
 request.arguments.content=oldContent;
 Object.assign(f.admissions,{
  assertTrustedCreateNativeAdmissionBinding(){return {...bound,epoch:99};}
 });
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,allow),/differs from immutable reserved intent/u);
 Object.assign(f.admissions,{
  assertTrustedCreateNativeAdmissionBinding(){return bound;}
 });
 const name=(await readdir(f.dir))[0];
 await writeFile(join(f.dir,name),JSON.stringify({...intent,
  request_fingerprint:"f".repeat(64)})+"\n");
 await assert.rejects(preflight.assertNativeCreateAdmissionAfterVerification(
  f.record,verified,allow),/differs from persistent marker/u);
 assert.equal(f.stats().writes,0);
});

test("R383.5 Gateway never falls through to legacy create_file even after VP and OPA allow",async()=>{
 const original=new InMemoryRequestStore();
 const request:PreparedRequestRecord={
  request_id:"req-create-3835",task_id:"task-create-3835",
  agent_role:"backend",
  request:{tool:"create_file",arguments:{
   branch,path,content
  }},
  required_permission:{
   resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/"+path,
   operation:"create_file"
  },
  audience:"cloud-access-gateway",
  challenge:"challenge-3835",
  request_fingerprint:"c".repeat(64),
  authority_only_digest:"d".repeat(64),
  authority_only_plan_task_id:"plan-create-3835",
  authority_only_agent_did:bound.agent_did,
  created_at_ms:Date.now(),expires_at_ms:Date.now()+60000,
  consumed:false
 };
 original.put(request);
 let verifierCalls=0,opaCalls=0,providerCalls=0;
 const admissions=Object.assign(Object.create(Admissions.prototype),{
  assertTrustedCreateNativeAdmissionBinding(){
   throw Error("create admission alone is not Gitea execution");
  },
  assertVerifiedVpAndPolicyForExecution(){
   throw Error("unsupported native create: no independently attested executor");
  }
 });
 await assert.rejects(executeAuthorization({
  request_id:request.request_id,signed_vp:"offline-signed-vp"
 },{
  store:original,
  audit:{emit:()=>{}},
  verifier:{async verify(){verifierCalls++;return {
   presenter_id:bound.agent_did,
   credential_id:bound.credential_id,
   issuer_id:"did:example:issuer",
   root_credential_id:bound.root_credential_id,
   hierarchy_depth:1,
   permissions:[request.required_permission]
  };}},
  policy:{async evaluate(){opaCalls++;return {
   allow:true,policy_version:"offline-allow"
  };}},
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"},
  executor:{provider:"gitea",async execute(){providerCalls++;
   throw Error("LEGACY GITEA CREATE MUST NEVER RUN");
  }},
  authorityOnlyAdmissions:admissions
 } as never),/not enabled/u);
 assert.equal(verifierCalls,1);
 assert.equal(opaCalls,1);
 assert.equal(providerCalls,0);
 assert.equal(request.consumed,true,"original Prepare remains single-use");
});

/**
 * R383.6 protected executor composition (OFFLINE: simulated Rust/OPA and
 * transport). The separate receipt tests run the actual Gitea independent
 * read-only verifier. No native EVM/OPA/Docker success is claimed here.
 */
async function createPipeline(t:import("node:test").TestContext,failWriter=false){
 const f=await fixture(t);
 const preflight=f.mkPreflight();
 const {intent}=await preflight.stageCreate(f.record,HEAD);
 const receiptDirectory=join(f.dir,"receipts");
 await mkdir(receiptDirectory,{mode:0o700});
 let writerCalls=0,readerCalls=0;
 const verified={presenter_id:bound.agent_did,
  credential_id:bound.credential_id,
  root_credential_id:bound.root_credential_id,
  hierarchy_depth:1,
  permissions:[{operation:"create_file",resource:"gitea://thesis/created"}]};
 const policy={allow:true,policy_version:"r3836-policy"};
 Object.assign(f.admissions,{
  assertTrustedCreateNativeAdmissionBinding(
   actual:PreparedRequestRecord,actualVerified:typeof verified){
   assert.equal(actual,f.record);
   assert.equal(actualVerified,verified);
   return bound;
  }
 });
 const makeReader=(token:string)=>{
  const client=new GiteaClient({
   baseUrl:"http://gitea.local:3000",token,owner:"thesis",
   repository:"iam-console-poc",fetchFn:async()=>{throw Error("GET stub");}
  });
  Object.assign(client,{async verifyCreatedFileHeadCas(x:{
   branch:string;path:string;expectedHeadSha:string;
   createdCommitSha:string;createdBlobSha:string;
   expectedContentSha256:string;expectedContentBytes:number
  }){
   readerCalls++;
   assert.equal(x.expectedHeadSha,HEAD);
   assert.equal(x.createdCommitSha,NEXT);
   assert.equal(x.createdBlobSha,"a".repeat(40));
   assert.equal(x.expectedContentSha256,intent.next_content_sha256);
   assert.equal(x.expectedContentBytes,Buffer.byteLength(content));
   return {
    status:"gitea_create_head_cas_read_only_verified",
    branch,path,previous_head_sha:HEAD,commit_sha:NEXT,
    blob_sha:"a".repeat(40),
    content_sha256:intent.next_content_sha256,
    provider_write_authorized:false
   };
  }});
  return client;
 };
 const key=Buffer.alloc(32,41);
 const publisher=new CreatePublisher({
  directory:receiptDirectory,key,repository,branch,
  independentGiteaClient:makeReader("publisher-only")});
 const observer=new CreateObserver({
  directory:receiptDirectory,key,repository,branch,
  independentGiteaClient:makeReader("observer-only")});
 Object.assign(f.giteaClient,{async createFileWithHeadCas(x:{
  expectedHeadSha:string;branch:string;path:string;content:string;
 }){
  writerCalls++;
  assert.equal(x.expectedHeadSha,HEAD);
  assert.equal(x.branch,branch);
  assert.equal(x.path,path);
  assert.equal(x.content,content);
  if(failWriter)throw Error("Gitea CAS reply ambiguous");
  return {
   branch,path,revision:NEXT,commit_sha:NEXT,blob_sha:"a".repeat(40),
   previous_head_sha:HEAD,staging_branch:"feature/r3832-create-s",
   next_content_sha256:intent.next_content_sha256,
   old_path_absent_at_pinned_head:true
  };
 }});
 const executor=new CreateExecutor({
  admissions:f.admissions,preflight,journal:f.journal,
  giteaClient:f.giteaClient,publisher,observer,repository,branch
 });
 f.record.consumed=true;
 return {...f,intent,preflight,executor,verified,policy,receiptDirectory,
  stats2:()=>({writerCalls,readerCalls})};
}
test("R383.6 real create pipeline stages one attempt and two independent MAC observations",async t=>{
 const f=await createPipeline(t);
 assert.equal(f.executor.isForAdmissions(f.admissions),true);
 const result=await f.executor.executeAfterVerifiedRustOpa(
  f.record,f.verified as never,f.policy as never);
 assert.equal(result.tool,"create_file");
 assert.equal(result.provider,"gitea");
 assert.equal(result.commit_sha,NEXT);
 assert.deepEqual(f.stats2(),{writerCalls:1,readerCalls:2});
 assert.equal(f.stats().writes,0,"legacy provider is never called");
 const names=await readdir(f.dir);
 const stem=createHash("sha256").update(bound.session_id+"\n"+bound.task_id)
  .digest("hex");
 assert.ok(names.includes(stem+".create-intent.json"));
 assert.ok(names.includes(stem+".create-attempt.json"));
 assert.ok(names.includes(stem+".create-completed.json"));
 const receipt=await readdir(f.receiptDirectory);
 assert.equal(receipt.length,1);
 assert.match(receipt[0],/\.create\.json$/u);
 await assert.rejects(f.executor.executeAfterVerifiedRustOpa(
  f.record,f.verified as never,f.policy as never),/EEXIST/u);
 assert.equal(f.stats2().writerCalls,1);
});
test("R383.6 ambiguous create CAS is terminal after a durable one-shot marker",async t=>{
 const f=await createPipeline(t,true);
 await assert.rejects(f.executor.executeAfterVerifiedRustOpa(
  f.record,f.verified as never,f.policy as never),/CAS reply ambiguous/u);
 assert.equal(f.stats2().writerCalls,1);
 assert.equal(f.stats2().readerCalls,0);
 const files=await readdir(f.dir);
 assert.ok(files.some(x=>x.endsWith(".create-attempt.json")));
 assert.equal(files.some(x=>x.endsWith(".create-completed.json")),false);
 await assert.rejects(f.executor.executeAfterVerifiedRustOpa(
  f.record,f.verified as never,f.policy as never),/EEXIST/u);
 assert.equal(f.stats2().writerCalls,1);
 assert.equal(f.stats().writes,0);
});
test("R383.6 cannot create after OPA denies or without consumed native Prepare",async t=>{
 const f=await createPipeline(t);
 await assert.rejects(f.executor.executeAfterVerifiedRustOpa(
  f.record,f.verified as never,{allow:false,policy_version:"opa"} as never),
  /native VP, OPA/u);
 f.record.consumed=false;
 await assert.rejects(f.executor.executeAfterVerifiedRustOpa(
  f.record,f.verified as never,f.policy as never),/native VP, OPA/u);
 assert.equal(f.stats2().writerCalls,0);
 assert.equal((await readdir(f.dir)).some(x=>
  x.endsWith(".create-attempt.json")),false);
});
