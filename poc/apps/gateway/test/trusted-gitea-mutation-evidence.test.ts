import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readFile,writeFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {GiteaClient} from "../src/gitea-client.ts";
import {AuthenticatedGiteaMutationCompletionObserver,
 TrustedGatewayGiteaMutationEvidencePublisher}
 from "../src/trusted-authority-only-gitea-mutation-evidence.ts";

const oldHead="a".repeat(40),nextHead="c".repeat(40),
 oldBlob="b".repeat(40),nextBlob="d".repeat(40);
const content="export const suspended = true;\n",path="apps/backend/user.ts";
const branch="feature/account-suspension";
const expected={
 session_id:"r302-evidence-session",authority_digest:"a".repeat(64),
 root_credential_id:"urn:r302:root",
 task_id:"task-backend",runtime_task_id:"runtime-backend",epoch:1,
 agent_did:"did:example:backend",credential_id:"urn:r302:child",
 request_id:"request-r302",request_fingerprint:"e".repeat(64)
};
const intent={
 schema:"authority-only-gitea-update-intent-v1" as const,
 kind:"update_file_preflight_only" as const,
 ...expected,repository:"thesis/iam-console-poc",branch,path,
 expected_head_sha:oldHead,expected_blob_sha:oldBlob,
 previous_content_sha256:"f".repeat(64),
 next_content_sha256:requireHash(content),
 next_content_bytes:Buffer.byteLength(content),prepared_at_ms:1762340000000,
 provider_write_authorized:false as const
};
function requireHash(value:string){
 return createHash("sha256").update(value).digest("hex");
}
const result={
 branch,path,revision:nextHead,commit_sha:nextHead,blob_sha:nextBlob,
 previous_revision:oldHead,precondition_blob_sha:oldBlob,
 previous_head_sha:oldHead,previous_blob_sha:oldBlob,
 staging_branch:"feature/r302-internal-test",
 next_content_sha256:intent.next_content_sha256
};
async function fixture(fn:(x:{
 dir:string;publisher:TrustedGatewayGiteaMutationEvidencePublisher;
 observer:AuthenticatedGiteaMutationCompletionObserver;
 setHead:(v:string)=>void;setParent:(v:string)=>void;
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),"r302-write-evidence-"));
 const dir=join(root,"receipts");
 await mkdir(dir,{mode:0o700});
 let head=nextHead,parent=oldHead;
 const client=new GiteaClient({
  baseUrl:"http://gitea.local:3000",token:"owner-independent-read",
  owner:"thesis",repository:"iam-console-poc",
  fetchFn:(async(raw:URL|string,init?:RequestInit)=>{
   assert.equal(init?.method,"GET");
   const u=new URL(String(raw));
   if(u.pathname.endsWith("/branches/feature%2Faccount-suspension"))
    return new Response(JSON.stringify({name:branch,commit:{id:head}}));
   if(u.pathname.endsWith("/git/commits/"+nextHead))
    return new Response(JSON.stringify({sha:nextHead,
     parents:[{sha:parent}]}));
   if(u.pathname.endsWith("/contents/apps/backend/user.ts")){
    assert.equal(u.searchParams.get("ref"),nextHead);
    return new Response(JSON.stringify({type:"file",path,
     encoding:"base64",content:Buffer.from(content).toString("base64"),
     size:Buffer.byteLength(content),sha:nextBlob,last_commit_sha:nextHead}));
   }
   throw Error("Unexpected real Gitea GET "+u.pathname);
  }) as typeof fetch
 });
 const key=Buffer.alloc(32,82),nowMs=()=>1762340000500;
 try{
  await fn({dir,
   publisher:new TrustedGatewayGiteaMutationEvidencePublisher({
    directory:dir,key,repository:"thesis/iam-console-poc",
    branch,independentGiteaClient:client,nowMs
   }),
   observer:new AuthenticatedGiteaMutationCompletionObserver({
    directory:dir,key,repository:"thesis/iam-console-poc",
    branch,giteaClient:client,nowMs
   }),
   setHead:(v:string)=>{head=v;},
   setParent:(v:string)=>{parent=v;}
  });
 }finally{await rm(root,{recursive:true,force:true});}
}
test("R302.4 owner MAC receipt is independently reread, Task-pinned and single-shot",async()=>{
 await fixture(async({publisher,observer,dir})=>{
  const proof=await publisher.publish(intent,expected,result,"opa-r302");
  const independentlyObserved=await observer.observe(expected);
  assert.equal(independentlyObserved.status,"owner_verified_provider_result");
  assert.equal(independentlyObserved.evidence_sha256,proof);
  assert.equal(independentlyObserved.credential_id,expected.credential_id);
  await assert.rejects(publisher.publish(intent,expected,result,"opa-r302"),/EEXIST/);
  await assert.rejects(observer.observe({...expected,
   credential_id:"urn:foreign:child"}),/receipt differs/);
  const files=await readdir(dir);
  assert.equal(files.length,1);
  const contents=await readFile(join(dir,files[0]),"utf8");
  assert.equal(contents.includes(content),false);
  const modified=JSON.parse(contents);
  modified.blob_sha="f".repeat(40);
  await writeFile(join(dir,files[0]),JSON.stringify(modified)+"\n","utf8");
  await assert.rejects(observer.observe(expected),/forged or tampered/);
 });
});
test("R302.4 independent head/parent mismatches never become authenticated success",async()=>{
 await fixture(async({publisher,observer,setHead,setParent})=>{
  setHead("e".repeat(40));
  await assert.rejects(publisher.publish(intent,expected,result,"opa"),
   /feature HEAD is not/);
  setHead(nextHead);
  setParent("f".repeat(40));
  await assert.rejects(publisher.publish(intent,expected,result,"opa"),
   /descend directly/);
  setParent(oldHead);
  await publisher.publish(intent,expected,result,"opa");
  setHead(oldHead);
  await assert.rejects(observer.observe(expected),/feature HEAD is not/);
 });
});
test("R302.4 unrelated original request or forged Gitea CAS result is refused",async()=>{
 await fixture(async({publisher,dir})=>{
  await assert.rejects(publisher.publish({
   ...intent,request_fingerprint:"f".repeat(64)
  },expected,result,"opa"),/does not match immutable/);
  await assert.rejects(publisher.publish(intent,expected,{
   ...result,previous_head_sha:"f".repeat(40)
  },"opa"),/does not match immutable/);
  assert.equal((await readdir(dir)).length,0);
 });
});
