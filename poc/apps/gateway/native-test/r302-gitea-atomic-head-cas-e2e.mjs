/**
 * R302 disposable provider-only Gitea branch CAS protocol E2E.
 * No agent, Rust VC, OPA, user repository, LLM or production keys involved.
 * The owner token edits only temporary feature branches in a disposable Gitea.
 */
import assert from "node:assert/strict";
import {GiteaClient} from "../src/gitea-client.ts";
import {ProviderConflictError} from "../src/errors.ts";

assert.equal(process.env.GEMINI_API_KEY,undefined);
assert.equal(process.env.OPENAI_API_KEY,undefined);
assert.ok(process.env.GITEA_GATEWAY_TOKEN);
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
const config={
 baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,
 owner:"thesis",repository:"iam-console-poc",
 timeoutMs:10000
};
const client=new GiteaClient(config);
const mainBefore=await client.getBranchMetadata("main");
const branch="feature/r302-cas-proof";
const path="apps/backend/r302-protected-proof.ts";
const oldContent="export const suspended = false;\n";
const newContent="export const suspended = true;\n";
await client.createBranch("main",branch);
const seed=await client.createFile(branch,path,oldContent,
 "R302 owner-only disposable seed");
const oldSha=seed.commit_sha;
const before=await client.readTextFile(branch,path,oldSha);
assert.equal(before.content,oldContent);
assert.equal(before.blob_sha,seed.blob_sha);
const updated=await client.updateFileWithHeadCas({
 branch,path,content:newContent,message:"R302 owner-only CAS commit",
 requestId:"r302-native-cas-owner",expectedHeadSha:oldSha,
 expectedBlobSha:before.blob_sha
});
assert.equal(updated.previous_head_sha,oldSha);
assert.equal(updated.previous_blob_sha,seed.blob_sha);
assert.notEqual(updated.commit_sha,oldSha);
assert.match(updated.staging_branch,/^feature\/r302-internal-[a-f0-9]{28}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,updated.commit_sha);
const file=await client.readTextFile(branch,path,updated.commit_sha);
assert.equal(file.content,newContent);
assert.equal(file.blob_sha,updated.blob_sha);
assert.equal((await client.getBranchMetadata("main")).commit_sha,
 mainBefore.commit_sha);
await assert.rejects(client.updateFileWithHeadCas({
 branch,path,content:newContent,message:"forbidden retry",
 requestId:"r302-native-cas-owner",expectedHeadSha:oldSha,
 expectedBlobSha:before.blob_sha
}),ProviderConflictError);

// Adversarial competitor changes a DIFFERENT file at the exact moment of
// branch-ref CAS. Its old target blob does not change, so a plain PUT
// /contents/<filepath> with only the old blob SHA would not be sufficient.
const raceBranch="feature/r302-race-proof";
const racePath="apps/backend/r302-race-proof.ts";
await client.createBranch("main",raceBranch);
const raceSeed=await client.createFile(raceBranch,racePath,oldContent,
 "R302 second owner-only disposable seed");
const raceOldSha=raceSeed.commit_sha;
const raceBefore=await client.readTextFile(
 raceBranch,racePath,raceOldSha);
let injected=false;
const competingClient=new GiteaClient(config);
const fetchFn=async(url,init={})=>{
 const pathname=new URL(String(url)).pathname;
 if(!injected&&init.method==="PUT"&&
    pathname.endsWith("/branches/feature%2Fr302-race-proof")){
  injected=true;
  // An unrelated authorized owner writes on the feature branch
  // between the staged commit and its CAS promotion.
  await competingClient.createFile(raceBranch,
   "apps/backend/r302-external-owner.ts",
   "export const otherWriter = true;\n",
   "R302 adversarial owner changed HEAD");
 }
 return fetch(url,init);
};
const contender=new GiteaClient({...config,fetchFn});
await assert.rejects(contender.updateFileWithHeadCas({
 branch:raceBranch,path:racePath,content:newContent,
 message:"R302 must not race on changed HEAD",
 requestId:"r302-native-cas-race",expectedHeadSha:raceOldSha,
 expectedBlobSha:raceBefore.blob_sha
}),ProviderConflictError);
assert.equal(injected,true);
assert.notEqual((await client.getBranchMetadata(raceBranch)).commit_sha,
 raceOldSha);
assert.equal((await client.readTextFile(raceBranch,racePath)).content,
 oldContent);
assert.equal((await client.getBranchMetadata("main")).commit_sha,
 mainBefore.commit_sha);
process.stdout.write(JSON.stringify({
 event:"r302_gitea_atomic_head_cas_live",
 staging_parent_checked:true,
 actual_feature_commit_updated:true,
 old_blob_pinned:true,
 independent_committed_content_read:true,
 parallel_unrelated_branch_commit_denied:true,
 main_unchanged:true,
 gateway_delegated_writes_enabled:false,
 rust_opa_e2e:false,
 paid_model_calls:0
})+"\n");
