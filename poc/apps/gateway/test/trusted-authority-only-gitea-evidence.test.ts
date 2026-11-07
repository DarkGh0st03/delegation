import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import {mkdtemp,writeFile,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GiteaClient} from "../src/gitea-client.ts";
import {AuthenticatedGiteaReadCompletionObserver}
 from "../src/trusted-authority-only-gitea-evidence.ts";
import {TrustedGatewayGiteaReadEvidencePublisher}
 from "../src/trusted-authority-only-gitea-publisher.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../src/trusted-authority-only-admissions.ts";
import {GiteaExecutor} from "../src/gitea-executor.ts";
import type {PreparedRequestRecord,VerifiedDelegation,GiteaReadFileExecutionResult}
 from "../src/types.ts";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function canonical(v:unknown):string{
 if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
 if(v!==null&&typeof v==="object"){
  const obj=v as Record<string,unknown>;
  return "{"+Object.keys(obj).sort().map(k=>JSON.stringify(k)+":"+canonical(obj[k])).join(",")+"}";
 }
 return JSON.stringify(v);
}
const revision="a".repeat(40),blobSha="b".repeat(40);
const contents="export const suspended = true;\n";
const expected={
 session_id:"r294-session",authority_digest:"1".repeat(64),
 root_credential_id:"urn:r294:root",task_id:"task-backend",
 runtime_task_id:"runtime-backend",epoch:1,
 agent_did:"did:thesis:backend",credential_id:"urn:r294:child",
 request_id:"request-r294",request_fingerprint:"2".repeat(64)
};
const key=Buffer.alloc(32,45);
async function fixture(fn:(arg:{
 directory:string;record:()=>Record<string,unknown>;
 sign:(r:Record<string,unknown>)=>Record<string,unknown>;
 save:(r:Record<string,unknown>)=>Promise<void>;
 reader:(opts?:{revision?:string;content?:string;key?:Buffer})=>
  AuthenticatedGiteaReadCompletionObserver;
})=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),"r294-evidence-"));
 const record=()=>({
  schema:"authority-only-gitea-read-evidence-v1",
  kind:"gateway_read_file_completed",...expected,
  repository:"thesis/iam-console-poc",
  branch:"feature/account-suspension",path:"apps/backend/user.ts",
  revision,blob_sha:blobSha,source_sha256:sha(contents),
  source_bytes:Buffer.byteLength(contents),
  policy_version:"test-only-opa-v1",
  completed_at_ms:Date.parse("2026-11-05T10:00:00Z"),
  verification:{native_rust_vp_verified:true,
   opa_allow:true,gateway_provider_result:"success"}
 });
 const sign=(body:Record<string,unknown>)=>({
  ...body,mac_sha256:createHmac("sha256",key)
   .update(canonical(body)).digest("hex")
 });
 const name=sha(expected.session_id+"\n"+expected.request_id)+".json";
 const save=async(v:Record<string,unknown>)=>{
  await writeFile(join(directory,name),JSON.stringify(v)+"\n",
   {mode:0o600,flag:"w"});
 };
 const reader=(opts:{revision?:string;content?:string;key?:Buffer}={})=>{
  const fetchFn=async(url:URL|string,init?:RequestInit)=>{
   assert.equal((init?.headers as Record<string,string>)?.authorization,
    "token trusted-gitea-read-only");
   const u=new URL(String(url));
   const returnedRev=opts.revision??revision;
   if(u.pathname.endsWith("/branches/feature%2Faccount-suspension"))
    return new Response(JSON.stringify({name:"feature/account-suspension",
     commit:{id:returnedRev}}));
   if(u.pathname.endsWith("/contents/apps/backend/user.ts")){
    assert.equal(u.searchParams.get("ref"),revision);
    const data=opts.content??contents;
    return new Response(JSON.stringify({type:"file",path:"apps/backend/user.ts",
     encoding:"base64",content:Buffer.from(data).toString("base64"),
     size:Buffer.byteLength(data),sha:blobSha}));
   }
   throw Error("Unexpected authenticated Gitea request: "+u.pathname);
  };
  return new AuthenticatedGiteaReadCompletionObserver({
   directory,key:opts.key??key,
   repository:"thesis/iam-console-poc",
   branch:"feature/account-suspension",
   giteaClient:new GiteaClient({
    baseUrl:"http://gitea.local:3000",owner:"thesis",
    repository:"iam-console-poc",token:"trusted-gitea-read-only",
    fetchFn:fetchFn as typeof fetch
   }),nowMs:()=>Date.parse("2026-11-05T10:01:00Z")
  });
 };
 try{await fn({directory,record,sign,save,reader});}
 finally{await rm(directory,{recursive:true,force:true});}
}
// R357.3 unit-only: the real admission gate is tested separately. The
// prototype fixture supplies expected binding solely to exercise publisher
// witness, independent read, MAC and file-replay behavior, NOT EVM/OPA.
function sourceClient(token:string,head=revision,data=contents){
 const fetchFn=async(url:URL|string,init?:RequestInit)=>{
  assert.equal((init?.headers as Record<string,string>)?.authorization,"token "+token);
  const u=new URL(String(url));
  if(u.pathname.endsWith("/branches/feature%2Faccount-suspension"))
   return new Response(JSON.stringify({name:"feature/account-suspension",commit:{id:head}}));
  if(u.pathname.endsWith("/contents/apps/backend/user.ts"))
   return new Response(JSON.stringify({type:"file",path:"apps/backend/user.ts",
    encoding:"base64",content:Buffer.from(data).toString("base64"),
    size:Buffer.byteLength(data),sha:blobSha}));
  throw Error("Unexpected Gitea URI "+u.pathname);
 };
 return new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:"thesis",repository:"iam-console-poc",
  token,fetchFn:fetchFn as typeof fetch
 });
}
function originalReadRecord():PreparedRequestRecord{
 return {
  request_id:expected.request_id,task_id:expected.runtime_task_id,
  agent_role:"backend",
  request:{tool:"read_file",arguments:{branch:"feature/account-suspension",
   path:"apps/backend/user.ts"}},
  required_permission:{operation:"read_file",
   resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/user.ts"},
  audience:"cloud-access-gateway",challenge:"r3573-local",
  request_fingerprint:expected.request_fingerprint,
  pinned_revision:revision,authority_only_digest:expected.authority_digest,
  authority_only_plan_task_id:expected.task_id,
  authority_only_agent_did:expected.agent_did,
  created_at_ms:1,expires_at_ms:Date.now()+60_000,consumed:true
 };
}
const verifiedRead:VerifiedDelegation={
 presenter_id:expected.agent_did,credential_id:expected.credential_id,
 issuer_id:"did:thesis:engineer",root_credential_id:expected.root_credential_id,
 permissions:[{operation:"read_file",resource:
  "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/user.ts"}],
 hierarchy_depth:1,expiration:"999999999999"
};
function fakeReadAdmission(){
 return Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype),{
  assertTrustedCompletedReadEvidenceBinding(
   record:PreparedRequestRecord,verified:VerifiedDelegation
  ){
   assert.equal(record.authority_only_digest,expected.authority_digest);
   assert.equal(verified.credential_id,expected.credential_id);
   return expected;
  }
 }) as TrustedAuthorityOnlyGatewayAdmissions;
}
test("R357.3 exact witnessed Gitea read publishes only owner-authenticated bytes",async()=>{
 await fixture(async({directory,reader})=>{
  const record=originalReadRecord(),gate=fakeReadAdmission();
  const result=await new GiteaExecutor(sourceClient("trusted-gateway")).execute(record);
  const publisher=new TrustedGatewayGiteaReadEvidencePublisher({
   directory,key,admissions:gate,
   independentGiteaClient:sourceClient("separate-read-only"),
   repository:"thesis/iam-console-poc",branch:"feature/account-suspension",
   nowMs:()=>Date.parse("2026-11-05T10:00:00Z")
  });
  assert.equal(publisher.isForAdmissions(gate),true);
  const first=publisher.publishSuccessfulRead({
   record,verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:result as GiteaReadFileExecutionResult
  });
  await assert.rejects(publisher.publishSuccessfulRead({
   record,verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:result as GiteaReadFileExecutionResult
  }),/concurrent evidence publication denied/);
  const out=await first;
  assert.equal(out.status,"gateway_read_evidence_published_staged");
  assert.equal(out.provider_execution_enabled,false);
  assert.match(out.evidence_sha256,/^[a-f0-9]{64}$/u);
  const observed=await reader().observe(expected);
  assert.equal(observed.evidence_sha256,out.evidence_sha256);
  await assert.rejects(publisher.publishSuccessfulRead({
   record,verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:result as GiteaReadFileExecutionResult
  }),/EEXIST/u);
 });
});
test("R357.3 missing HEAD pin, forged result or moved independent Gitea HEAD never signs",async()=>{
 await fixture(async({directory,reader})=>{
  const gate=fakeReadAdmission(),record=originalReadRecord();
  const real=await new GiteaExecutor(sourceClient("trusted-gateway")).execute(record);
  const opts={directory,key,admissions:gate,
   repository:"thesis/iam-console-poc",branch:"feature/account-suspension",
   nowMs:()=>Date.parse("2026-11-05T10:00:00Z")};
  const live=new TrustedGatewayGiteaReadEvidencePublisher({
   ...opts,independentGiteaClient:sourceClient("read-only")
  });
  await assert.rejects(live.publishSuccessfulRead({
   record:{...record,pinned_revision:undefined},
   verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:real as GiteaReadFileExecutionResult
  }),/provider success or independent OPA decision missing/);
  await assert.rejects(live.publishSuccessfulRead({
   record,verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:{...real} as GiteaReadFileExecutionResult
  }),/trusted provider provenance/);
  const moved=new TrustedGatewayGiteaReadEvidencePublisher({
   ...opts,independentGiteaClient:sourceClient("read-only-moved","f".repeat(40))
  });
  await assert.rejects(moved.publishSuccessfulRead({
   record,verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:real as GiteaReadFileExecutionResult
  }),/HEAD changed before owner evidence publication/);
  const tamperedSource=new TrustedGatewayGiteaReadEvidencePublisher({
   ...opts,independentGiteaClient:sourceClient("read-only-tampered",revision,
    "export const suspended = false;\\n")
  });
  await assert.rejects(tamperedSource.publishSuccessfulRead({
   record,verified:verifiedRead,policy:{allow:true,policy_version:"test-only-opa-v1"},
   execution:real as GiteaReadFileExecutionResult
  }),/independently reread provider source, blob or HEAD differs/);
  await assert.rejects(reader().observe(expected),/ENOENT/);
 });
});
test("R294 real Gitea client evidence reader binds MAC, exact Task, branch HEAD and file bytes",async()=>{
 await fixture(async({record,sign,save,reader})=>{
  await save(sign(record()));
  const v=await reader().toTrustedObserver().observe(expected);
  assert.equal(v.status,"owner_verified_provider_result");
  assert.equal(v.credential_id,expected.credential_id);
  assert.equal(v.request_fingerprint,expected.request_fingerprint);
  assert.match(v.evidence_sha256,/^[0-9a-f]{64}$/u);
  assert.equal(v.completed_at_ms,Date.parse("2026-11-05T10:00:00Z"));
 });
});
test("R294 forged Task, wrong key and tampered Gitea bytes/head are denied",async()=>{
 await fixture(async({record,sign,save,reader})=>{
  await save(sign(record()));
  for(const bad of [
   {...expected,credential_id:"urn:foreign:child"},
   {...expected,request_fingerprint:"9".repeat(64)},
   {...expected,epoch:2}
  ])await assert.rejects(reader().observe(bad),/precise permission boundary/);
  await assert.rejects(reader({key:Buffer.alloc(32,23)}).observe(expected),
   /authentication failed/);
  await assert.rejects(reader({content:"different bytes"}).observe(expected),
   /contents do not match/);
  await assert.rejects(reader({revision:"f".repeat(40)}).observe(expected),
   /HEAD differs/);
 });
});
test("R294 missing outcome, unsigned, invented OPA or malformed signed claims fail closed",async()=>{
 await fixture(async({record,sign,save,reader})=>{
  await assert.rejects(reader().observe(expected),/ENOENT/);
  const r=record();
  await save({...r,mac_sha256:"0".repeat(64)});
  await assert.rejects(reader().observe(expected),/authentication failed/);
  await save(sign({...r,verification:{native_rust_vp_verified:true,
   opa_allow:false,gateway_provider_result:"success"}}));
  await assert.rejects(reader().observe(expected),/precise permission boundary/);
  await save(sign({...r,extra_claim:"untrusted"}));
  await assert.rejects(reader().observe(expected),/malformed Gateway provider evidence/);
  await save(sign({...r,branch:"main"}));
  await assert.rejects(reader().observe(expected),/precise permission boundary/);
 });
});
test("R376.2 only the independent authenticated read exposes a bounded source observation",async()=>{
 await fixture(async({record,sign,save,reader})=>{
  await save(sign(record()));
  const observer=reader();
  assert.equal(observer.isForRepository("thesis/iam-console-poc","feature/account-suspension"),true);
  assert.equal(observer.isForRepository("foreign/iam-console-poc","feature/account-suspension"),false);
  assert.equal(observer.isForRepository("thesis/iam-console-poc","feature/another"),false);
  const value=await observer.observeSource(expected);
  assert.equal(value.status,"owner_verified_bounded_gitea_source_observation");
  assert.equal(value.task_id,expected.task_id);
  assert.equal(value.runtime_task_id,expected.runtime_task_id);
  assert.equal(value.path,"apps/backend/user.ts");
  assert.equal(value.revision,revision);
  assert.equal(value.source_sha256,sha(contents));
  assert.equal(value.excerpt,contents);
  assert.equal(value.excerpt_truncated,false);
  assert.equal(value.evidence_sha256,(await observer.observe(expected)).evidence_sha256);
 });
});
test("R376.2 diagnostic excerpt is bounded, controls sanitized and signed bytes immutable",async()=>{
 await fixture(async({record,sign,save,reader})=>{
  const long="const value = 1;\n"+"x".repeat(4700)+"\u0007";
  await save(sign({...record(),source_sha256:sha(long),
   source_bytes:Buffer.byteLength(long)}));
  const observed=await reader({content:long}).observeSource(expected);
  assert.equal(observed.excerpt.length,4096);
  assert.equal(observed.excerpt_truncated,true);
  assert.equal(observed.source_bytes,Buffer.byteLength(long));
  await assert.rejects(reader({content:long+"modified"}).observeSource(expected),
   /contents do not match/u);
  await assert.rejects(reader({revision:"f".repeat(40)}).observeSource(expected),
   /HEAD differs/u);
  await assert.rejects(reader({key:Buffer.alloc(32,23)}).observeSource(expected),
   /authentication failed/u);
 });
});
test("R294 symlinked evidence file cannot impersonate Gateway-owned record",async()=>{
 await fixture(async({directory,record,sign,save,reader})=>{
  await save(sign(record()));
  const name=sha(expected.session_id+"\n"+expected.request_id)+".json";
  const second=join(directory,"second.json");
  await writeFile(second,JSON.stringify(sign(record())),{mode:0o600});
  const {unlink}=await import("node:fs/promises");
  await unlink(join(directory,name));
  await symlink(second,join(directory,name));
  await assert.rejects(reader().observe(expected),/ELOOP/);
 });
});
test("R294 evidence reader cannot construct from a non-private or unpinned source",async()=>{
 await fixture(async({directory})=>{
  assert.throws(()=>new AuthenticatedGiteaReadCompletionObserver({
   directory:"relative",key,repository:"thesis/iam-console-poc",
   branch:"feature/account-suspension",giteaClient:{} as never
  }),/independent Gitea reader/);
 });
});
