import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AuthorityPlanningCheckpointStore,signAuthorityPlanningCheckpoint}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts";
import {SignedAuthorityOnlyFileStore}
 from "../../../packages/orchestrator-runtime/src/signed-authority-only-store.ts";
import {scriptedResearchProposal}
 from "../src/run-disposable-gemini-ci-pilot.mjs";
import {writeOriginalDisposableCiEngineerReceipt}
 from "../src/disposable-ci-original-signed-review.mjs";

const DENY=/Disposable original CI Engineer review NO-GO/u;
const privatePem=key=>key.export({format:"pem",type:"pkcs8"}).toString();
const publicPem=key=>key.export({format:"pem",type:"spki"}).toString();
async function setup(t,mutate){
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
