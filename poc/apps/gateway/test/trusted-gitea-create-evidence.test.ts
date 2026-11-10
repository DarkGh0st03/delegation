import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,rm,readdir,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {GiteaClient} from "../src/gitea-client.ts";
import {AuthenticatedGiteaCreateCompletionObserver as Observer,
 TrustedGatewayGiteaCreateEvidencePublisher as Publisher}
 from "../src/trusted-authority-only-gitea-create-evidence.ts";

const OLD="a".repeat(40),NEW="b".repeat(40),BLOB="c".repeat(40);
const branch="feature/account-suspension";
const path="apps/backend/src/new-handler.ts";
const repository="thesis/iam-console-poc";
const content="export const suspend = true;\n";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const binding={
 session_id:"r3836-session",authority_digest:"d".repeat(64),
 root_credential_id:"urn:r3836:root",
 task_id:"task-3836",runtime_task_id:"runtime-3836",
 epoch:5,agent_did:"did:ethr:0xabc",
 credential_id:"urn:r3836:child",request_id:"request-3836",
 request_fingerprint:"e".repeat(64)
};
const intent={
 schema:"authority-only-gitea-create-intent-v1" as const,
 kind:"create_file_preflight_only" as const,
 ...binding,repository,branch,path,
 expected_head_sha:OLD,old_path_absent_at_pinned_head:true as const,
 next_content_sha256:sha(content),
 next_content_bytes:Buffer.byteLength(content),
 prepared_at_ms:Date.now(),provider_write_authorized:false as const
};
const result={
 branch,path,revision:NEW,commit_sha:NEW,blob_sha:BLOB,
 previous_head_sha:OLD,staging_branch:"feature/r3832-create-staged",
 next_content_sha256:intent.next_content_sha256,
 old_path_absent_at_pinned_head:true as const
};
async function fixture(t:import("node:test").TestContext){
 const root=await mkdtemp(join(tmpdir(),"r3836-create-evidence-"));
 const dir=join(root,"receipts");
 await mkdir(dir,{mode:0o700});
 t.after(()=>rm(root,{recursive:true,force:true}));
 let head=NEW,parent=OLD,oldExists=false,nextContent=content;
 let reads=0,writes=0;
 const json=(value:object,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json"}
 });
 const fetchFn:typeof fetch=(async(raw:URL|string,init?:RequestInit)=>{
  const u=new URL(String(raw));
  const method=init?.method??"GET";
  if(method!=="GET"){writes++;throw Error("Independent observer attempted provider mutation");}
  reads++;
  const base="/api/v1/repos/thesis/iam-console-poc";
  if(u.pathname===base+"/branches/"+encodeURIComponent(branch))
   return json({name:branch,commit:{id:head}});
  if(u.pathname===base+"/git/commits/"+NEW)
   return json({sha:NEW,parents:[{sha:parent}]});
  if(u.pathname===base+"/contents/"+path){
   const revision=u.searchParams.get("ref");
   if(revision===OLD){
    if(!oldExists)return json({message:"not found"},404);
    return json({type:"file",path,encoding:"base64",
     sha:"a".repeat(40),size:4,
     content:Buffer.from("old!").toString("base64")});
   }
   if(revision===NEW)
    return json({type:"file",path,encoding:"base64",
     sha:BLOB,size:Buffer.byteLength(nextContent),
     content:Buffer.from(nextContent).toString("base64"),
     last_commit_sha:NEW});
  }
  throw Error("unexpected independent Gitea read "+u.pathname);
 }) as typeof fetch;
 const makeClient=(token:string)=>new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:"thesis",
  repository:"iam-console-poc",token,fetchFn
 });
 const writer=makeClient("writer");
 const publisherReader=makeClient("publisher-readonly");
 const observerReader=makeClient("observer-readonly");
 const key=Buffer.alloc(32,71);
 const publisher=new Publisher({directory:dir,key,repository,branch,
  independentGiteaClient:publisherReader});
 const observer=new Observer({directory:dir,key,repository,branch,
  independentGiteaClient:observerReader});
 return {dir,writer,publisher,observer,stats:()=>({reads,writes}),
  setHead:(x:string)=>{head=x;},
  setParent:(x:string)=>{parent=x;},
  setOldExists:(x:boolean)=>{oldExists=x;},
  setNewContent:(x:string)=>{nextContent=x;}};
}
test("R383.6 real independent Gitea old-absence proof is MAC sealed then reverified",async t=>{
 const f=await fixture(t);
 assert.equal(f.publisher.isForRepository(repository,branch,f.writer),true);
 assert.equal(f.observer.isIndependentOf(f.writer),true);
 assert.equal(Observer.isForRepository(f.observer,repository,branch),true);
 const evidence=await f.publisher.publish(intent,binding,result,"opa-policy");
 assert.match(evidence,/^[a-f0-9]{64}$/u);
 const actual=await f.observer.observe(binding);
 assert.equal(actual.status,"owner_verified_provider_result");
 assert.equal(actual.evidence_sha256,evidence);
 assert.equal(actual.request_fingerprint,binding.request_fingerprint);
 assert.ok(f.stats().reads>=10,
  "publisher and observer each repeat old-absence and HEAD verification");
 assert.equal(f.stats().writes,0);
 const records=await readdir(f.dir);
 assert.equal(records.length,1);
 assert.ok(records[0].endsWith(".create.json"));
 const receipt=JSON.parse(await readFile(join(f.dir,records[0]),"utf8"));
 assert.equal(receipt.kind,"gateway_atomic_create_file_completed");
 assert.equal(receipt.old_path_absent_at_pinned_head,true);
 assert.equal("previous_blob_sha" in receipt,false);
 assert.equal(receipt.verification.independent_old_path_absent,true);
 await assert.rejects(f.publisher.publish(intent,binding,result,"opa-policy"),
  /EEXIST/u);
 assert.equal(f.stats().writes,0);
});
test("R383.6 tampered MAC cannot impersonate an independently completed Task",async t=>{
 const f=await fixture(t);
 await f.publisher.publish(intent,binding,result,"opa");
 const name=(await readdir(f.dir))[0];
 const receipt=JSON.parse(await readFile(join(f.dir,name),"utf8"));
 receipt.source_sha256="f".repeat(64);
 await writeFile(join(f.dir,name),JSON.stringify(receipt)+"\n");
 await assert.rejects(f.observer.observe(binding),/MAC/u);
 assert.equal(f.stats().writes,0);
});
test("R383.6 producer refuses signed intent/Child mismatch and forged CAS result",async t=>{
 const f=await fixture(t);
 await assert.rejects(f.publisher.publish({...intent,
  credential_id:"urn:r3836:foreign-child"},binding,result,"opa"),
  /differs/u);
 await assert.rejects(f.publisher.publish(intent,binding,{
  ...result,previous_head_sha:"f".repeat(40)},"opa"),/differs/u);
 await assert.rejects(f.publisher.publish(intent,binding,{
  ...result,old_path_absent_at_pinned_head:false as never},"opa"),/differs/u);
 assert.deepEqual(await readdir(f.dir),[]);
 assert.equal(f.stats().writes,0);
});
for(const mode of ["old-exists","wrong-parent","stale-head","wrong-content"] as const){
 test("R383.6 no receipt for independently detected "+mode,async t=>{
  const f=await fixture(t);
  if(mode==="old-exists")f.setOldExists(true);
  if(mode==="wrong-parent")f.setParent("f".repeat(40));
  if(mode==="stale-head")f.setHead("e".repeat(40));
  if(mode==="wrong-content")f.setNewContent("injected source");
  await assert.rejects(f.publisher.publish(intent,binding,result,"opa"));
  assert.deepEqual(await readdir(f.dir),[]);
  assert.equal(f.stats().writes,0);
 });
}
test("R383.6 observer rechecks current feature HEAD even after MAC receipt",async t=>{
 const f=await fixture(t);
 await f.publisher.publish(intent,binding,result,"opa");
 f.setHead("f".repeat(40));
 await assert.rejects(f.observer.observe(binding));
 assert.equal(f.stats().writes,0);
});

test("R383.6 owner-only CREATE digest matches authenticated independent receipt without disclosing source",async t=>{
 const f=await fixture(t);
 const evidence=await f.publisher.publish(intent,binding,result,"opa");
 const digest=await f.observer.observeAuthenticatedSourceDigest(binding);
 assert.equal(digest.status,"owner_verified_gateway_gitea_create_digest_only");
 assert.equal(digest.task_id,binding.task_id);
 assert.equal(digest.runtime_task_id,binding.runtime_task_id);
 assert.equal(digest.agent_did,binding.agent_did);
 assert.equal(digest.credential_id,binding.credential_id);
 assert.equal(digest.branch,branch);
 assert.equal(digest.path,path);
 assert.equal(digest.previous_head_sha,OLD);
 assert.equal(digest.commit_sha,NEW);
 assert.equal(digest.old_path_absent_at_pinned_head,true);
 assert.equal(digest.source_sha256,sha(content));
 assert.equal(digest.source_bytes,Buffer.byteLength(content));
 assert.equal(digest.evidence_sha256,evidence);
 assert.equal(JSON.stringify(digest).includes(content),false);
 assert.equal("mac_sha256" in digest,false);
 assert.equal(f.stats().writes,0);
});
test("R383.6 owner-only CREATE digest refuses forged Task and stale HEAD",async t=>{
 const f=await fixture(t);
 await f.publisher.publish(intent,binding,result,"opa");
 await assert.rejects(f.observer.observeAuthenticatedSourceDigest({
  ...binding,credential_id:"urn:foreign-child"
 }),/original signed Task\/Child/u);
 f.setHead("d".repeat(40));
 await assert.rejects(f.observer.observeAuthenticatedSourceDigest(binding));
 assert.equal(f.stats().writes,0);
});
