import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,chmod,readdir,readFile,rm} from "node:fs/promises";
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
