/**
 * Phase W (W2) regression on the REAL local Gitea (opt-in: W2_GITEA_IT=1,
 * run inside the app container where /config holds the owner credentials).
 * W0 behaviours, now with explicit assertions on what OUR code requires.
 * Admin credentials only create the throw-away repository; every operation
 * uses the Gateway token through the production GiteaClient.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {GiteaClient} from "../src/gitea-client.ts";
import {ProviderConflictError} from "../src/errors.ts";

const enabled=process.env.W2_GITEA_IT==="1"&&existsSync("/config/local.env");
const env=(f:string)=>Object.fromEntries(readFileSync(f,"utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#"))
 .map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
const NAME="w2-it";
async function setupRepo(){
 const local=env("/config/local.env"),gitea=env("/config/gitea.env");
 const base=process.env.GITEA_URL??"http://gitea:3000",org=local.GITEA_ORG!;
 const admin="Basic "+Buffer.from(local.GITEA_ADMIN_USER+":"+local.GITEA_ADMIN_PASSWORD).toString("base64");
 const call=async(method:string,path:string,body?:unknown,auth=admin)=>{
  const r=await fetch(base+"/api/v1"+path,{method,headers:{authorization:auth,"content-type":"application/json"},
   ...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,json:await r.json().catch(()=>undefined)};
 };
 if((await call("GET",`/repos/${org}/${NAME}`)).status===200)await call("DELETE",`/repos/${org}/${NAME}`);
 await call("POST",`/orgs/${org}/repos`,{name:NAME,private:true,auto_init:true,default_branch:"main",readme:"Default"});
 await call("PUT",`/repos/${org}/${NAME}/collaborators/${gitea.GITEA_GATEWAY_USER}`,{permission:"write"});
 await call("POST",`/repos/${org}/${NAME}/contents`,{branch:"main",message:"seed",files:[
  {operation:"create",path:"src/a.js",content:Buffer.from("a1\n").toString("base64")},
  {operation:"create",path:"src/b.js",content:Buffer.from("b1\n").toString("base64")}]});
 const client=new GiteaClient({baseUrl:base,token:gitea.GITEA_GATEWAY_TOKEN!,owner:org,repository:NAME,
  baseBranch:"main",timeoutMs:15000});
 return {client,call,org};
}
const ref=(n:number)=>"feature/w2-write-set-"+String(n).repeat(28);

test("real Gitea: mixed write-set in ONE commit, exact change set, modes, single CAS",{skip:!enabled},async()=>{
 const {client,call,org}=await setupRepo();
 await call("POST",`/repos/${org}/${NAME}/branches`,{new_branch_name:"feature/w2-work",old_ref_name:"main"});
 const h0=(await client.getBranchMetadata("feature/w2-work")).commit_sha;
 const a=await client.readTextFile("feature/w2-work","src/a.js",h0);
 const staged=await client.stageWriteSetCommit({branch:"feature/w2-work",expectedHeadSha:h0,stagingBranch:ref(1),
  message:"w2 it",files:[{operation:"update_file",path:"src/a.js",content:"a2\n",expectedBlobSha:a.blob_sha},
   {operation:"create_file",path:"src/n.js",content:"n\n",expectedBlobSha:null}]});
 const changes=await client.getCommitChanges(staged.commit_sha);
 assert.deepEqual(changes.parents,[h0]);
 assert.deepEqual(changes.files.map(f=>`${f.filename}:${f.status}`).sort(),["src/a.js:modified","src/n.js:added"]);
 const cmp=await client.compareCommitFiles(h0,staged.commit_sha);
 assert.equal(cmp.total_commits,1);
 assert.deepEqual(cmp.files.map(f=>`${f.filename}:${f.status}`).sort(),["src/a.js:modified","src/n.js:added"]);
 const before=await client.getTreeModes(h0,["src/a.js","src/n.js"]);
 const after=await client.getTreeModes(staged.commit_sha,["src/a.js","src/n.js"]);
 assert.equal(before.get("src/a.js")?.mode,after.get("src/a.js")?.mode);
 assert.equal(before.has("src/n.js"),false);
 assert.equal(after.get("src/n.js")?.mode,"100644");
 assert.equal((await client.getBranchMetadata("feature/w2-work")).commit_sha,h0);   // isolation
 assert.equal(await client.casBranchToCommit("feature/w2-work",h0,staged.commit_sha),"updated");
 assert.equal((await client.getBranchMetadata("feature/w2-work")).commit_sha,staged.commit_sha);
 await client.deleteWriteSetStagingRef(ref(1));
});

test("real Gitea: stale old_commit_id rejected although the candidate descends from the current HEAD",{skip:!enabled},async()=>{
 const {client,call,org}=await setupRepo();
 await call("POST",`/repos/${org}/${NAME}/branches`,{new_branch_name:"feature/w2-work",old_ref_name:"main"});
 const h0=(await client.getBranchMetadata("feature/w2-work")).commit_sha;
 await call("POST",`/repos/${org}/${NAME}/contents`,{branch:"feature/w2-work",message:"concurrent",
  files:[{operation:"create",path:"src/c.js",content:Buffer.from("c\n").toString("base64")}]});
 const h1=(await client.getBranchMetadata("feature/w2-work")).commit_sha;
 const staged=await client.stageWriteSetCommit({branch:"feature/w2-work",expectedHeadSha:h1,stagingBranch:ref(2),
  message:"w2 it",files:[{operation:"create_file",path:"src/x.js",content:"x\n",expectedBlobSha:null},
   {operation:"create_file",path:"src/y.js",content:"y\n",expectedBlobSha:null}]});
 assert.deepEqual((await client.getCommitChanges(staged.commit_sha)).parents,[h1]);   // a fast-forward of h1
 assert.equal(await client.casBranchToCommit("feature/w2-work",h0,staged.commit_sha),"rejected");
 assert.equal((await client.getBranchMetadata("feature/w2-work")).commit_sha,h1);
});

test("real Gitea: our guards for the W0 diagnostics (update without sha, identical bytes) and private refs",{skip:!enabled},async()=>{
 const {client,call,org}=await setupRepo();
 await call("POST",`/repos/${org}/${NAME}/branches`,{new_branch_name:"feature/w2-work",old_ref_name:"main"});
 const h0=(await client.getBranchMetadata("feature/w2-work")).commit_sha;
 const a=await client.readTextFile("feature/w2-work","src/a.js",h0);
 // S6b: Gitea would accept an update without sha; our client refuses to send one.
 await assert.rejects(client.stageWriteSetCommit({branch:"feature/w2-work",expectedHeadSha:h0,stagingBranch:ref(3),
  message:"m",files:[{operation:"update_file",path:"src/a.js",content:"z\n",expectedBlobSha:null},
   {operation:"create_file",path:"src/q.js",content:"q\n",expectedBlobSha:null}]}),ProviderConflictError);
 // S8: identical bytes yield a commit WITHOUT that file: the exact-set check would refuse it.
 const staged=await client.stageWriteSetCommit({branch:"feature/w2-work",expectedHeadSha:h0,stagingBranch:ref(4),
  message:"m",files:[{operation:"update_file",path:"src/a.js",content:a.content,expectedBlobSha:a.blob_sha},
   {operation:"create_file",path:"src/q.js",content:"q\n",expectedBlobSha:null}]});
 const files=(await client.getCommitChanges(staged.commit_sha)).files.map(f=>`${f.filename}:${f.status}`).sort();
 assert.deepEqual(files,["src/q.js:added"]);
 assert.notDeepEqual(files,["src/a.js:modified","src/q.js:added"]);
 // Private staging refs: never a work branch for the Gateway (they ARE ordinary
 // branches readable by repository readers, which is why nothing secret is staged).
 await assert.rejects(client.casBranchToCommit(ref(4),h0,staged.commit_sha),ProviderConflictError);
 assert.equal((await client.getBranchMetadata(ref(4))).commit_sha,staged.commit_sha);
 await client.deleteWriteSetStagingRef(ref(4));
});
