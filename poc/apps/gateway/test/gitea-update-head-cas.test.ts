import test from "node:test";
import assert from "node:assert/strict";
import {GiteaClient} from "../src/gitea-client.ts";
import {ProviderConflictError} from "../src/errors.ts";

const oldSha="a".repeat(40),newSha="c".repeat(40),
 oldBlob="b".repeat(40),newBlob="d".repeat(40);
const branch="feature/account-suspension";
const path="apps/backend/user.ts";
const oldContent="export const suspended = false;\n";
const updatedContent="export const suspended = true;\n";

function fixture(options:{
  startHead?:string;oldFileBlob?:string;
  branchMoveOnCas?:boolean;forgedParent?:boolean;
}={}){
 let head=options.startHead??oldSha;
 let stagingBranch:string|null=null,stagingHead:string|null=null;
 let writes=0,casWrites=0,stageWrites=0;
 const calls:string[]=[];
 const fetchFn:typeof fetch=(async(raw:URL|string,init?:RequestInit)=>{
  const u=new URL(String(raw)),method=init?.method??"GET";
  const headers=init?.headers as Record<string,string>;
  assert.equal(headers?.authorization,"token owner-gitea-cas");
  calls.push(method+" "+u.pathname);
  const json=(value:object,status=200)=>new Response(JSON.stringify(value),
    {status,headers:{"content-type":"application/json"}});
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(u.pathname.endsWith("/branches/feature%2Faccount-suspension")&&method==="GET")
   return json({name:branch,commit:{id:head}});
  if(stagingBranch&&u.pathname.endsWith(
    "/branches/"+encodeURIComponent(stagingBranch))&&method==="GET")
   return json({name:stagingBranch,commit:{id:stagingHead}});
  if(u.pathname.endsWith("/branches")&&method==="POST"){
   writes++;stageWrites++;
   assert.equal(body.old_ref_name,oldSha);
   assert.match(body.new_branch_name,/^feature\/r302-internal-[a-f0-9]{28}$/u);
   if(stagingBranch)return json({message:"already exists"},409);
   stagingBranch=body.new_branch_name;
   stagingHead=oldSha;
   return json({name:stagingBranch,commit:{id:oldSha}},201);
  }
  if(u.pathname.endsWith("/contents/apps/backend/user.ts")&&method==="GET"){
   const ref=u.searchParams.get("ref");
   assert.ok(ref===oldSha||ref===newSha);
   const content=ref===oldSha?oldContent:updatedContent;
   return json({type:"file",path,encoding:"base64",
    size:Buffer.byteLength(content),
    content:Buffer.from(content).toString("base64"),
    sha:ref===oldSha?(options.oldFileBlob??oldBlob):newBlob,
    last_commit_sha:ref});
  }
  if(u.pathname.endsWith("/contents/apps/backend/user.ts")&&method==="PUT"){
   writes++;
   assert.equal(body.branch,stagingBranch);
   assert.equal(body.sha,oldBlob);
   assert.equal(Buffer.from(body.content,"base64").toString("utf8"),updatedContent);
   if(stagingHead!==oldSha)return json({message:"staging conflict"},409);
   stagingHead=newSha;
   return json({content:{path,sha:newBlob},commit:{sha:newSha}});
  }
  if(u.pathname.endsWith("/git/commits/"+newSha)&&method==="GET")
   return json({sha:newSha,parents:[{
    sha:options.forgedParent?"f".repeat(40):oldSha
   }]});
  if(u.pathname.endsWith("/branches/feature%2Faccount-suspension")&&
     method==="PUT"){
   writes++;casWrites++;
   assert.equal(body.old_commit_id,oldSha);
   assert.equal(body.new_commit_id,newSha);
   assert.equal(body.force,false);
   if(options.branchMoveOnCas)head="e".repeat(40);
   if(head!==oldSha)return json({message:"HEAD changed"},409);
   head=newSha;
   return new Response(null,{status:204});
  }
  throw Error("Unexpected Gitea endpoint "+method+" "+u.pathname);
 }) as typeof fetch;
 const client=new GiteaClient({
  baseUrl:"http://gitea.local:3000",owner:"thesis",
  repository:"iam-console-poc",token:"owner-gitea-cas",
  fetchFn
 });
 const run=()=>client.updateFileWithHeadCas({
  branch,path,content:updatedContent,message:"R302 disposable branch CAS",
  requestId:"request-r302",expectedHeadSha:oldSha,expectedBlobSha:oldBlob
 });
 return {client,run,stats:()=>({head,writes,stageWrites,casWrites,
   stagingHead,stagingBranch,calls})};
}
test("R302 CAS stages exact-parent Git commit, atomically promotes and reads actual file",async()=>{
 const v=fixture();
 const result=await v.run();
 assert.equal(result.previous_head_sha,oldSha);
 assert.equal(result.previous_blob_sha,oldBlob);
 assert.equal(result.commit_sha,newSha);
 assert.equal(result.blob_sha,newBlob);
 assert.equal(result.branch,branch);
 assert.match(result.next_content_sha256,/^[a-f0-9]{64}$/u);
 assert.match(result.staging_branch,/^feature\/r302-internal-[a-f0-9]{28}$/u);
 assert.deepEqual(v.stats().casWrites,1);
 assert.equal(v.stats().head,newSha);
 assert.deepEqual(v.stats().stageWrites,1);
 assert.deepEqual(v.stats().writes,3);
 assert.ok(v.stats().calls.some(x=>x.startsWith("PUT ")&&
  x.includes("feature%2Faccount-suspension")));
 await assert.rejects(v.run(),ProviderConflictError);
 assert.equal(v.stats().casWrites,1);
});
test("R302 CAS refuses stale branch HEAD without any provider mutation",async()=>{
 const v=fixture({startHead:"e".repeat(40)});
 await assert.rejects(v.run(),ProviderConflictError);
 assert.equal(v.stats().writes,0);
 assert.equal(v.stats().casWrites,0);
});
test("R302 CAS refuses wrong old blob without staging branch or mutation",async()=>{
 const v=fixture({oldFileBlob:"f".repeat(40)});
 await assert.rejects(v.run(),ProviderConflictError);
 assert.equal(v.stats().writes,0);
});
test("R302 CAS loses remote compare-and-swap if another writer moves HEAD",async()=>{
 const v=fixture({branchMoveOnCas:true});
 await assert.rejects(v.run(),ProviderConflictError);
 assert.equal(v.stats().head,"e".repeat(40));
 assert.equal(v.stats().casWrites,1);
 assert.equal(v.stats().stageWrites,1);
 // An ambiguous/incomplete attempt MUST be reconciled, not repeated.
 await assert.rejects(v.run(),ProviderConflictError);
 assert.equal(v.stats().casWrites,1);
});
test("R302 CAS refuses staged commit with unrelated parent before branch movement",async()=>{
 const v=fixture({forgedParent:true});
 await assert.rejects(v.run(),/unexpected parent/);
 assert.equal(v.stats().casWrites,0);
});
test("R302 CAS rejects main, staging namespace and invalid paths pre-network",async()=>{
 const v=fixture();
 for(const bad of [
  {...{branch,path,content:updatedContent,message:"change",
    requestId:"request-r302",expectedHeadSha:oldSha,expectedBlobSha:oldBlob},
   branch:"main"},
  {branch,path:"apps/backend/../outside.ts",
   content:updatedContent,message:"change",requestId:"request-r302",
   expectedHeadSha:oldSha,expectedBlobSha:oldBlob},
  {branch:"feature/r302-internal-abc",path,
   content:updatedContent,message:"change",requestId:"request-r302",
   expectedHeadSha:oldSha,expectedBlobSha:oldBlob}
 ]){
  await assert.rejects(v.client.updateFileWithHeadCas(bad),
   ProviderConflictError);
 }
 assert.equal(v.stats().calls.length,0);
});
