import test from "node:test";
import assert from "node:assert/strict";
import {GiteaClient} from "../src/gitea-client.ts";
import {ProviderConflictError,ProviderNotFoundError,
 ProviderUnavailableError} from "../src/errors.ts";

const OLD="a".repeat(40),NEW="b".repeat(40),BLOB="c".repeat(40);
const BRANCH="feature/account-suspension";
const FILE="apps/backend/new-account-suspension.ts";
const CONTENT='export const suspend = (id:string) => ({id,active:false});\n';
function fixture(options:{
 oldHead?:string;existing?:boolean;forgeParent?:boolean;
 raceCas?:boolean;stageUnexpectedFile?:boolean;
 unavailableAbsence?:boolean;maliciousStage?:boolean;
 stagedContent?:string;casUnconfirmed?:boolean
}={}){
 let head=options.oldHead??OLD,stage:string|undefined,stageHead:string|undefined;
 let providerWrites=0,stageWrites=0,created=0,branchCas=0;
 const calls:string[]=[];
 const json=(x:object,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{"content-type":"application/json"}
 });
 const fetchFn:typeof fetch=(async (raw:URL|string,init?:RequestInit)=>{
  const url=new URL(String(raw)),method=init?.method??"GET";
  const body=init?.body?JSON.parse(String(init.body)):{};
  const headers=init?.headers as Record<string,string>;
  assert.equal(headers?.authorization,"token r3832-owner-only");
  calls.push(method+" "+url.pathname+"?"+url.searchParams.toString());
  const base="/api/v1/repos/thesis/iam-console-poc";
  if(url.pathname===base+"/branches/"+encodeURIComponent(BRANCH)&&
     method==="GET")return json({name:BRANCH,commit:{id:head}});
  if(stage&&url.pathname===base+"/branches/"+encodeURIComponent(stage)&&
     method==="GET")return json({name:stage,commit:{id:stageHead}});
  if(url.pathname===base+"/branches"&&method==="POST"){
   providerWrites++;stageWrites++;
   assert.equal(body.old_ref_name,OLD);
   assert.match(body.new_branch_name,
    /^feature\/r3832-create-[a-f0-9]{28}$/u);
   if(stage)return json({message:"staging ref exists"},409);
   stage=body.new_branch_name;
   stageHead=OLD;
   return json({name:options.maliciousStage?"feature/unrelated":stage,
    commit:{id:OLD}},201);
  }
  const contents=base+"/contents/"+FILE;
  if(url.pathname===contents&&method==="GET"){
   const sha=url.searchParams.get("ref");
   assert.ok(sha===OLD||sha===NEW);
   if(options.unavailableAbsence&&sha===OLD)
    return json({message:"Gateway unavailable"},503);
   if(sha===OLD&&options.existing)
    return json({type:"file",path:FILE,encoding:"base64",
     content:Buffer.from("already exists").toString("base64"),
     size:14,sha:"d".repeat(40)});
   if(sha===OLD&&options.stageUnexpectedFile&&stage)
    return json({type:"file",path:FILE,encoding:"base64",
     content:Buffer.from("staging unexpected").toString("base64"),
     size:18,sha:"e".repeat(40)});
   if(sha===OLD)return json({message:"not found"},404);
   const content=options.stagedContent??CONTENT;
   return json({type:"file",path:FILE,encoding:"base64",
    content:Buffer.from(content).toString("base64"),
    size:Buffer.byteLength(content),sha:BLOB,last_commit_sha:NEW});
  }
  if(url.pathname===contents&&method==="POST"){
   providerWrites++;created++;
   assert.equal(body.branch,stage,
    "original feature branch cannot receive a plain contents POST");
   assert.equal(Buffer.from(body.content,"base64").toString("utf8"),CONTENT);
   assert.equal(stageHead,OLD);
   stageHead=NEW;
   return json({content:{path:FILE,sha:BLOB},commit:{sha:NEW}});
  }
  if(url.pathname===base+"/git/commits/"+NEW&&method==="GET")
   return json({sha:NEW,parents:[{
    sha:options.forgeParent?"f".repeat(40):OLD
   }]});
  if(url.pathname===base+"/branches/"+encodeURIComponent(BRANCH)&&
     method==="PUT"){
   providerWrites++;branchCas++;
   assert.equal(body.old_commit_id,OLD);
   assert.equal(body.new_commit_id,NEW);
   assert.equal(body.force,false);
   if(options.raceCas)head="e".repeat(40);
   if(head!==OLD)return json({message:"HEAD moved"},409);
   if(!options.casUnconfirmed)head=NEW;
   return new Response(null,{status:204});
  }
  throw Error("unexpected "+method+" "+url.pathname);
 }) as typeof fetch;
 const client=new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:"thesis",
  repository:"iam-console-poc",token:"r3832-owner-only",fetchFn
 });
 const input={branch:BRANCH,path:FILE,content:CONTENT,
  message:"R3832 private owner staged create",
  requestId:"r3832-create-task-1",expectedHeadSha:OLD};
 const run=()=>client.createFileWithHeadCas(input);
 const independent=new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:"thesis",
  repository:"iam-console-poc",token:"r3832-owner-only",fetchFn
 });
 const verify=(change:Awaited<ReturnType<typeof run>>)=>independent
  .verifyCreatedFileHeadCas({
   branch:BRANCH,path:FILE,expectedHeadSha:OLD,
   createdCommitSha:change.commit_sha,createdBlobSha:change.blob_sha,
   expectedContentSha256:change.next_content_sha256,
   expectedContentBytes:Buffer.byteLength(CONTENT)
  });
 return {client,independent,input,run,verify,stats:()=>({
  head,stage,stageHead,providerWrites,stageWrites,created,branchCas,calls
 })};
}
test("R383.2 absent old source -> isolated file create -> parent proof -> feature HEAD CAS -> committed bytes",async()=>{
 const f=fixture(),result=await f.run();
 assert.equal(result.previous_head_sha,OLD);
 assert.equal(result.commit_sha,NEW);
 assert.equal(result.blob_sha,BLOB);
 assert.equal(result.old_path_absent_at_pinned_head,true);
 assert.equal(result.branch,BRANCH);
 assert.equal(result.path,FILE);
 assert.match(result.next_content_sha256,/^[0-9a-f]{64}$/u);
 assert.match(result.staging_branch,/^feature\/r3832-create-[0-9a-f]{28}$/u);
 assert.deepEqual(f.stats().providerWrites,3);
 assert.equal(f.stats().stageWrites,1);
 assert.equal(f.stats().created,1);
 assert.equal(f.stats().branchCas,1);
 assert.equal(f.stats().head,NEW);
 assert.equal(f.stats().stageHead,NEW);
 const posts=f.stats().calls.filter(c=>c.startsWith("POST "));
 assert.equal(posts.length,2);
 assert.equal(f.stats().calls.some(c=>c.startsWith(
  "POST /api/v1/repos/thesis/iam-console-poc/contents/")),true);
 // A second request may NOT re-create the old path after HEAD moves.
 await assert.rejects(f.run(),ProviderConflictError);
 assert.equal(f.stats().branchCas,1);
});
test("R383.2 independent Gitea client reopens parent, old absence, new HEAD, blob and UTF-8",async()=>{
 const f=fixture();
 assert.notEqual(f.client,f.independent);
 const change=await f.run();
 const writes=f.stats().providerWrites;
 const evidence=await f.verify(change);
 assert.equal(evidence.status,"gitea_create_head_cas_read_only_verified");
 assert.equal(evidence.previous_head_sha,OLD);
 assert.equal(evidence.commit_sha,NEW);
 assert.equal(evidence.blob_sha,BLOB);
 assert.equal(evidence.content_sha256,change.next_content_sha256);
 assert.equal(evidence.provider_write_authorized,false);
 assert.equal(f.stats().providerWrites,writes,
  "observer must not send an additional staging ref, mutation or CAS");
});

test("R383.2 independent observer detects forged blob, changed parent, new bytes and old path existence",async()=>{
 for(const mode of ["wrong-blob","parent","bytes","previously-existed"]){
  const options:{forgeParent?:boolean;stagedContent?:string;existing?:boolean}={};
  const f=fixture(options),result=await f.run();
  const writes=f.stats().providerWrites;
  if(mode==="wrong-blob"){
   await assert.rejects(f.independent.verifyCreatedFileHeadCas({
    branch:BRANCH,path:FILE,expectedHeadSha:OLD,
    createdCommitSha:result.commit_sha,
    createdBlobSha:"e".repeat(40),
    expectedContentSha256:result.next_content_sha256,
    expectedContentBytes:Buffer.byteLength(CONTENT)
   }),ProviderConflictError);
  }else{
   if(mode==="parent")options.forgeParent=true;
   if(mode==="bytes")options.stagedContent="malicious mutation";
   if(mode==="previously-existed")options.existing=true;
   await assert.rejects(f.verify(result),ProviderConflictError);
  }
  assert.equal(f.stats().providerWrites,writes,
   "failed independent observation never authorizes another provider write");
 }
});

test("R383.2 already-existing file at pinned SHA is denied before provider writes",async()=>{
 const f=fixture({existing:true});
 await assert.rejects(f.run(),ProviderConflictError);
 assert.equal(f.stats().providerWrites,0);
});
test("R383.2 stale HEAD denied before provider writes",async()=>{
 const f=fixture({oldHead:"e".repeat(40)});
 await assert.rejects(f.run(),ProviderConflictError);
 assert.equal(f.stats().providerWrites,0);
});
test("R383.2 503 when probing absence is NOT interpreted as a 404",async()=>{
 const f=fixture({unavailableAbsence:true});
 await assert.rejects(f.run(),ProviderUnavailableError);
 assert.equal(f.stats().providerWrites,0);
});
test("R383.2 inconsistent staging branch identity cannot create a file",async()=>{
 const f=fixture({maliciousStage:true});
 await assert.rejects(f.run(),/staging ref did not start at pinned HEAD/u);
 assert.equal(f.stats().stageWrites,1);
 assert.equal(f.stats().created,0);
 assert.equal(f.stats().branchCas,0);
});
test("R383.2 stale staged source file cannot acquire create rights",async()=>{
 const f=fixture({stageUnexpectedFile:true});
 await assert.rejects(f.run(),ProviderConflictError);
 assert.equal(f.stats().stageWrites,1);
 assert.equal(f.stats().created,0);
 assert.equal(f.stats().branchCas,0);
});
test("R383.2 altered staged commit parent stops before feature HEAD CAS",async()=>{
 const f=fixture({forgeParent:true});
 await assert.rejects(f.run(),/unexpected parent/u);
 assert.equal(f.stats().created,1);
 assert.equal(f.stats().branchCas,0);
});
test("R383.2 altered staged bytes block feature HEAD CAS",async()=>{
 const f=fixture({stagedContent:"not the owner bytes"});
 await assert.rejects(f.run(),/Staged create file differs/u);
 assert.equal(f.stats().created,1);
 assert.equal(f.stats().branchCas,0);
});
test("R383.2 concurrent remote branch advance rejects create CAS",async()=>{
 const f=fixture({raceCas:true});
 await assert.rejects(f.run(),ProviderConflictError);
 assert.equal(f.stats().branchCas,1);
 assert.equal(f.stats().head,"e".repeat(40));
 await assert.rejects(f.run(),ProviderConflictError);
 assert.equal(f.stats().branchCas,1);
});
test("R383.2 lost acknowledgement after CAS is AMBIGUOUS, never success",async()=>{
 const f=fixture({casUnconfirmed:true});
 await assert.rejects(f.run(),/CAS outcome ambiguous/u);
 assert.equal(f.stats().branchCas,1);
 assert.equal(f.stats().head,OLD);
 // The private staging ref survives for operator reconciliation.
 assert.equal(f.stats().stageHead,NEW);
});
test("R383.2 invalid branch/path/content/ID denied with zero IO",async()=>{
 const f=fixture();
 const bad=[
  {branch:"main"},
  {branch:"feature/r3832-create-abc"},
  {branch:"feature/r302-internal-abc"},
  {branch:"feature/x/../../main"},
  {path:"apps/backend/../new.ts"},
  {path:"/etc/passwd"},
  {path:"apps\\backend\\new.ts"},
  {path:"apps/backend/new%2Ets"},
  {path:"apps/backend//new.ts"},
  {content:""},
  {content:"hi\0there"},
  {content:"x".repeat(2_000_001)},
  {requestId:""},
  {requestId:"bad/id"},
  {expectedHeadSha:"z".repeat(40)}
 ];
 for(const value of bad){
  await assert.rejects(f.client.createFileWithHeadCas({
   ...f.input,...value
  }),ProviderConflictError);
 }
 assert.equal(f.stats().calls.length,0);
});
