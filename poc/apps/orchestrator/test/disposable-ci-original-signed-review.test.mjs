import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,mkdir,writeFile,rm,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AuthorityPlanningCheckpointStore,signAuthorityPlanningCheckpoint}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts";
import {SignedAuthorityOnlyFileStore}
 from "../../../packages/orchestrator-runtime/src/signed-authority-only-store.ts";
import {scriptedResearchProposal}
 from "../src/run-disposable-gemini-ci-pilot.mjs";
import {writeOriginalDisposableCiEngineerReceipt,
 writeOriginalDisposableActionsEngineerReceipt,
 assertOriginalDisposableCiReviewOrigin}
 from "../src/disposable-ci-original-signed-review.mjs";

const DENY=/Disposable original CI Engineer review NO-GO/u;
const privatePem=key=>key.export({format:"pem",type:"pkcs8"}).toString();
const publicPem=key=>key.export({format:"pem",type:"spki"}).toString();
async function setup(t,mutate){

 const sourceSha=execFileSync("git",["rev-parse","--verify","HEAD"],{
  encoding:"utf8",cwd:new URL("../../../../",import.meta.url)
 }).trim();
 const ref="refs/heads/experiment/disposable-gemini-live-20261109";
 const env={
  GITHUB_ACTIONS:"true",
  GITHUB_REPOSITORY:"DarkGh0st03/delegation",
  GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_REF:ref,
  GITHUB_WORKFLOW_REF:"DarkGh0st03/delegation/.github/workflows/r38513-native-strict-full-recovery.yml@"+ref,
  GITHUB_RUN_ID:"42833508019",
  GITHUB_RUN_ATTEMPT:"1",
  GITHUB_SHA:sourceSha,
  R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING:"1",
  R38513_NATIVE_STRICT_FULL_RECOVERY:"1"
 };
 const denied=[
  "GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY",
  "DELEGATION_GEMINI_CHARGE_CONFIRMATION","DELEGATION_BILLING_CAP_ACK",
  "DELEGATION_DISPOSABLE_LIVE_MODE","DELEGATION_SIGNED_GEMINI_PILOT"
 ];
 const saved=new Map([...Object.keys(env),...denied]
  .map(k=>[k,process.env[k]]));
 for(const name of denied)delete process.env[name];
 Object.assign(process.env,env);
 t.after(()=>{
  for(const [key,value] of saved){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });

 const parent=await mkdtemp(join(tmpdir(),"disposable-original-ci-"));
 t.after(()=>rm(parent,{recursive:true,force:true}));
 const directory=join(parent,"checkpoints"),receipts=join(parent,"receipts");
 await mkdir(directory,{mode:0o700});
 await mkdir(receipts,{mode:0o700});
 const proposal=scriptedResearchProposal();
 proposal.session_id="disposable-native-ci-session";
 if(mutate)mutate(proposal);
 const snapshot={
  session_id:proposal.session_id,repository:proposal.repository,
  base_revision:proposal.base_revision,directories:[""],files:[]
 };
 const backend=generateKeyPairSync("ed25519");
 const engineer=generateKeyPairSync("ed25519");
 const store=new AuthorityPlanningCheckpointStore({directory,trust:{
  trustedKeys:{backend:{public_key_pem:publicPem(backend.publicKey)}},
  expectedSessionId:snapshot.session_id,expectedRepository:snapshot.repository,
  expectedBaseRevision:snapshot.base_revision,
  expectedWorkBranch:proposal.branch,expectedRequirement:proposal.requirement
 }});
 const start=new Date(),issuedAt=start.toISOString();
 const expiresAt=new Date(start.getTime()+20*60_000).toISOString();
 const checkpoint=signAuthorityPlanningCheckpoint({
  snapshot,proposal:{status:"unapproved_authority_proposal",
   proposal,verified_source_reads:1},
  keyId:"backend",privateKeyPem:privatePem(backend.privateKey),
  issuedAt,expiresAt
 });
 await store.persistVerified(checkpoint);
 const privateKeyFile=join(parent,"engineer.pem");
 await writeFile(privateKeyFile,privatePem(engineer.privateKey),{
  mode:0o600,flag:"wx"
 });
 const input={checkpointStore:store,snapshot,workBranch:proposal.branch,
  requirement:proposal.requirement,
  receiptDirectory:receipts,privateKeyFile,
  engineerDid:"did:thesis:disposable-ci-engineer",
  keyId:"disposable-ci-engineer",publicKeyPem:publicPem(engineer.publicKey)};
 return {input,receipts,sessionId:proposal.session_id,proposal};
}

test("original Planning checkpoint receives one real Engineer-signed CI receipt for the SAME session",async t=>{
 const f=await setup(t);
 const proof=await writeOriginalDisposableCiEngineerReceipt(f.input);
 assert.equal(proof.review,"SIMULATED_NOT_HUMAN");
 assert.equal(proof.checkpoint_from_original_planning,true);
 assert.equal(proof.original_receipt_written_and_independently_verified,true);
 assert.equal(proof.permission_count,23);
 assert.deepEqual(proof.delegated_roles,["backend","frontend","test"]);
 assert.equal(proof.native_root_issued_here,false);
 assert.equal(proof.gemini_called_here,false);
 const result=await new SignedAuthorityOnlyFileStore({
  directory:f.receipts,engineerDid:f.input.engineerDid,
  trustedKeys:{[f.input.keyId]:{
   engineer_did:f.input.engineerDid,public_key_pem:f.input.publicKeyPem}}
 }).loadAuthenticatedAuthority(f.sessionId);
 assert.equal(result.authenticated,true);
 assert.equal(result.authorization.session_id,f.sessionId);
 assert.equal(result.authorization.permissions.length,23);
 await assert.rejects(
  writeOriginalDisposableCiEngineerReceipt(f.input),
  /EEXIST/u,"same session cannot overwrite its signed review");
});

test("checkpoint can select a strict subset but no out-of-ceiling permission",async t=>{
 const f=await setup(t,p=>p.requested_permissions=p.requested_permissions.slice(0,3));
 const result=await writeOriginalDisposableCiEngineerReceipt(f.input);
 assert.equal(result.permission_count,3);
});

test("an authentic backend checkpoint outside CI permission ceiling cannot be auto-approved",async t=>{
 const f=await setup(t,p=>p.requested_permissions[3]={
  resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/.github/workflows/unsafe.yml",
  operation:"update_file"
 });
 await assert.rejects(writeOriginalDisposableCiEngineerReceipt(f.input),DENY);
 await assert.rejects(access(join(f.receipts,f.sessionId+".json")));
});

test("CI approval rejects foreign Engineer key and foreign work context",async t=>{
 const f=await setup(t),foreign=generateKeyPairSync("ed25519");
 await assert.rejects(writeOriginalDisposableCiEngineerReceipt({
  ...f.input,publicKeyPem:publicPem(foreign.publicKey)
 }),DENY);
 await assert.rejects(writeOriginalDisposableCiEngineerReceipt({
  ...f.input,workBranch:"feature/other"
 }),DENY);
 await assert.rejects(access(join(f.receipts,f.sessionId+".json")));
});

test("native R385.13 experimental switch reuses the same post-Planning signed receipt, never a second Root",async()=>{
 const {readFile}=await import("node:fs/promises");
 const e2e=await readFile(new URL(
  "../../../packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs",
  import.meta.url),"utf8");
 const yml=await readFile(new URL(
  "../../../../.github/workflows/r38513-native-strict-full-recovery.yml",
  import.meta.url),"utf8");
 assert.match(e2e,/if\(ciApprovalAfterPlanning\)\{/u);
 assert.match(e2e,/writeOriginalDisposableCiEngineerReceipt\(\{/u);
 assert.match(e2e,/checkpointStore:checkpoints,snapshot,workBranch:branch/u);
 assert.match(e2e,/if\(!ciApprovalAfterPlanning\)await writeFile/u);
 assert.match(yml,/R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING:/u);
 assert.match(yml,/original_ci_engineer_after_planning:/u);
 assert.equal(e2e.includes("ciApprovalAfterPlanning?null:signAuthorityOnlyGrant"),true);
});

test("CI-only signer refuses private hosts, foreign workflow, replay attempt and paid mode",async t=>{
 const f=await setup(t);
 const origin={...process.env};
 const observed=origin.GITHUB_SHA;
 assert.equal(assertOriginalDisposableCiReviewOrigin(origin,observed)
  .provider_calls_authorized,false);
 const mutations=[
  ["GITHUB_ACTIONS","false"],
  ["GITHUB_REPOSITORY","untrusted/repo"],
  ["GITHUB_EVENT_NAME","pull_request"],
  ["GITHUB_REF","refs/heads/main"],
  ["GITHUB_WORKFLOW_REF","attacker/forge.yml@"+origin.GITHUB_REF],
  ["GITHUB_RUN_ATTEMPT","2"],
  ["GITHUB_RUN_ID","0"],
  ["GITHUB_SHA","b".repeat(40)],
  ["R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING","0"],
  ["R38513_NATIVE_STRICT_FULL_RECOVERY","0"],
  ["GEMINI_API_KEY","not-a-key"],
  ["GOOGLE_API_KEY","not-a-key"],
  ["DELEGATION_GEMINI_CHARGE_CONFIRMATION","I AUTHORIZE GEMINI API CHARGES"],
  ["DELEGATION_DISPOSABLE_LIVE_MODE","gemini-real"]
 ];
 for(const [key,value] of mutations){
  process.env[key]=value;
  assert.throws(()=>assertOriginalDisposableCiReviewOrigin(
   process.env,observed),DENY,key);
  await assert.rejects(writeOriginalDisposableCiEngineerReceipt(f.input),
   DENY,key);
  if(origin[key]===undefined)delete process.env[key];
  else process.env[key]=origin[key];
 }
 assert.throws(()=>assertOriginalDisposableCiReviewOrigin(
  origin,"b".repeat(40)),DENY,"stale HEAD");
 const pushed={...origin,GITHUB_EVENT_NAME:"push"};
 assert.throws(()=>assertOriginalDisposableCiReviewOrigin(
  pushed,observed),DENY,"unregistered push workflow");
 const allowedPush={...pushed,GITHUB_WORKFLOW_REF:
  "DarkGh0st03/delegation/.github/workflows/disposable-original-engineer-native-ci.yml@"+
  pushed.GITHUB_REF};
 assert.equal(assertOriginalDisposableCiReviewOrigin(
  allowedPush,observed).original_root_issued,false);
 // The free pilot's exact workflow path may trigger a one-time push E2E
 // on the experimental branch, but it is NEVER a human approval or a
 // paid-model consent. This used to fail after all Rust builds completed.
 const pilotPush={...pushed,GITHUB_WORKFLOW_REF:
  "DarkGh0st03/delegation/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+
   pushed.GITHUB_REF};
 const admitted=assertOriginalDisposableCiReviewOrigin(pilotPush,observed);
 assert.equal(admitted.workflow,"gemini-authority-only-live-ci-pilot.yml");
 assert.equal(admitted.provider_calls_authorized,false);
 assert.equal(admitted.human_approval_verified,false);
 assert.equal(admitted.original_root_issued,false);
 for(const change of [
  {GITHUB_REF:"refs/heads/main"},
  {GITHUB_RUN_ATTEMPT:"2"},
  {GITHUB_EVENT_NAME:"pull_request"},
  {DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES"},
  {GEMINI_API_KEY:"forbidden"},
  {DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real"}
 ]){
  assert.throws(()=>assertOriginalDisposableCiReviewOrigin(
   {...pilotPush,...change},observed),DENY,
   "push Engineer signer must never accept foreign or paid origin");
 }
 await assert.rejects(access(join(f.receipts,f.sessionId+".json")));
});

test("real Gemini Actions profile signs the SAME authenticated original checkpoint after Planning, never promotes simulated decision to human",async t=>{
 const f=await setup(t);
 const ref="refs/heads/experiment/disposable-gemini-live-20261109";
 const keys={
  GITHUB_REF:ref,
  GITHUB_WORKFLOW_REF:"DarkGh0st03/delegation/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+ref,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:
   "I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
  APPROVED_RUNNER_NATIVE_MCP:"1",
  ENGINEER_CORE_NATIVE_MODE:"1"
 };
 const absent=[
  "R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING",
  "R38513_NATIVE_STRICT_FULL_RECOVERY","GEMINI_API_KEY",
  "GOOGLE_API_KEY","OPENAI_API_KEY","GH_TOKEN","GITHUB_TOKEN"
 ];
 const originals=new Map([...Object.keys(keys),...absent]
  .map(k=>[k,process.env[k]]));
 for(const key of absent)delete process.env[key];
 Object.assign(process.env,keys);
 const oldFetch=globalThis.fetch;
 let reads=0,runStatus="in_progress";
 globalThis.fetch=async(url,request)=>{
  reads++;
  assert.equal(url,"https://api.github.com/repos/DarkGh0st03/delegation/actions/runs/"+process.env.GITHUB_RUN_ID);
  assert.equal(request.headers.authorization,"Bearer synthetic-github-owner-read-token");
  return {ok:true,async json(){return {
   id:process.env.GITHUB_RUN_ID,event:"workflow_dispatch",
   run_attempt:1,status:runStatus,
   head_sha:process.env.GITHUB_SHA,
   head_branch:"experiment/disposable-gemini-live-20261109",
   path:" .github/workflows/gemini-authority-only-live-ci-pilot.yml".trim(),
   head_repository:{full_name:"DarkGh0st03/delegation"},
   created_at:new Date().toISOString()
  };}};
 };
 t.after(()=>{
  globalThis.fetch=oldFetch;
  for(const [name,value] of originals){
   if(value===undefined)delete process.env[name];
   else process.env[name]=value;
  }
 });
 await assert.rejects(writeOriginalDisposableCiEngineerReceipt(f.input),DENY);
 const paidInput={...f.input,githubApiToken:"synthetic-github-owner-read-token"};
 const proof=await writeOriginalDisposableActionsEngineerReceipt(paidInput);
 assert.equal(proof.review,"SIMULATED_NOT_HUMAN");
 assert.equal(proof.checkpoint_from_original_planning,true);
 assert.equal(proof.original_receipt_written_and_independently_verified,true);
 assert.equal(proof.human_approval_verified_here,false);
 assert.equal(proof.native_root_issued_here,false);
 assert.equal(proof.gemini_called_here,false);
 assert.equal(reads,1);
 const verified=await new SignedAuthorityOnlyFileStore({
  directory:f.receipts,engineerDid:f.input.engineerDid,
  trustedKeys:{[f.input.keyId]:{
   engineer_did:f.input.engineerDid,public_key_pem:f.input.publicKeyPem}}
 }).loadAuthenticatedAuthority(f.sessionId);
 assert.equal(verified.authenticated,true);
 assert.equal(verified.authorization.permissions.length,23);
 await assert.rejects(writeOriginalDisposableActionsEngineerReceipt(paidInput),
  /EEXIST/u,"same signed session cannot be overwritten");
 runStatus="completed";
 await assert.rejects(writeOriginalDisposableActionsEngineerReceipt({
  ...paidInput,nowMs:Date.now()
 }),DENY,"manual clock override forbidden");
 await assert.rejects(writeOriginalDisposableActionsEngineerReceipt(paidInput),
  /Trusted Github manual dispatch:/u);
});

test("paid simulated reviewer cannot approve wider permissions or foreign source",async t=>{
 const f=await setup(t,p=>p.requested_permissions[0]={
  operation:"update_file",
  resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/.github/workflows/unsafe.yml"
 });
 const ref="refs/heads/experiment/disposable-gemini-live-20261109";
 const env={
  GITHUB_REF:ref,
  GITHUB_WORKFLOW_REF:"DarkGh0st03/delegation/.github/workflows/gemini-authority-only-live-ci-pilot.yml@"+ref,
  DELEGATION_DISPOSABLE_LIVE_MODE:"gemini-real",
  DELEGATION_GEMINI_CHARGE_CONFIRMATION:"I AUTHORIZE GEMINI API CHARGES",
  DELEGATION_BILLING_CAP_ACK:"I VERIFIED PROJECT SPEND CAP AND UNDERSTAND POSSIBLE OVERAGES",
  DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
  APPROVED_RUNNER_NATIVE_MCP:"1",ENGINEER_CORE_NATIVE_MODE:"1"
 };
 const gone=["R38513_CI_ORIGINAL_APPROVAL_AFTER_PLANNING",
  "R38513_NATIVE_STRICT_FULL_RECOVERY","GEMINI_API_KEY","GOOGLE_API_KEY",
  "OPENAI_API_KEY","GH_TOKEN","GITHUB_TOKEN"];
 const previous=new Map([...Object.keys(env),...gone]
  .map(k=>[k,process.env[k]]));
 for(const k of gone)delete process.env[k];
 Object.assign(process.env,env);
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,async json(){return {
  id:process.env.GITHUB_RUN_ID,event:"workflow_dispatch",
  run_attempt:1,status:"in_progress",head_sha:process.env.GITHUB_SHA,
  head_branch:"experiment/disposable-gemini-live-20261109",
  path:".github/workflows/gemini-authority-only-live-ci-pilot.yml",
  head_repository:{full_name:"DarkGh0st03/delegation"},
  created_at:new Date().toISOString()
 }}});
 t.after(()=>{
  globalThis.fetch=oldFetch;
  for(const [k,v] of previous){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 });
 await assert.rejects(writeOriginalDisposableActionsEngineerReceipt({
  ...f.input,githubApiToken:"synthetic-github-owner-read-token"
 }),DENY);
 await assert.rejects(access(join(f.receipts,f.sessionId+".json")));
});
