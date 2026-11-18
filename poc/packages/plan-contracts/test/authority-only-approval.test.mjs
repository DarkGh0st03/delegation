import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {
 AUTHORITY_ONLY_SCHEMA,validateAuthorityProposal,validateAuthorityOnlyGrant,
 selectAuthorityOnlyGrant,authorityOnlyDigest,signAuthorityOnlyGrant,
 verifyAuthorityOnlyGrant,assertVerifiedAuthorityOnlyGrant
} from "../src/authority-only-approval.mjs";

const allowedOperations=new Set(["create_branch","create_pull_request",
 "read_repository","read_file","update_file","create_file","run_tests","list_directory"]);
const repository={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/session-work";
const root="gitea://gitea.local/thesis/iam-console-poc";
const branchUri=root+"/branches/feature%2Fsession-work";
const file=branchUri+"/files/apps/backend/src/users/user.service.ts";
const other=branchUri+"/files/apps/backend/src/users/unauthorized.ts";
const requirement="Implement the requested change under the signed authority boundary";
const sha="a".repeat(40);
const did="did:example:trusted-engineer",keyId="engineer-v2";
const keys=generateKeyPairSync("ed25519");
const trustedKeys={[keyId]:{
 engineer_did:did,public_key_pem:keys.publicKey.export({type:"spki",format:"pem"})
}};
const privateKeyPem=keys.privateKey.export({type:"pkcs8",format:"pem"});
const requested=[
 {resource:root,operation:"create_branch"},
 {resource:file,operation:"read_file"},
 {resource:file,operation:"update_file"},
 {resource:branchUri,operation:"run_tests"},
 {resource:root,operation:"create_pull_request"}
];
const permitted=requested.slice(0,4);
const fixedNow=Date.parse("2026-11-05T07:30:00Z");
function proposal(){
 return {
  schema_version:AUTHORITY_ONLY_SCHEMA,session_id:"session-work",
  repository:{...repository},branch,base_revision:sha,requirement,
  requested_permissions:structuredClone(requested)
 };
}
function grant(){return selectAuthorityOnlyGrant(proposal(),permitted,{allowedOperations});}
function signed(authorization=grant()){
 return signAuthorityOnlyGrant({
  authorization,engineerDid:did,keyId,privateKeyPem,
  issuedAt:"2026-11-05T07:00:00Z",expiresAt:"2026-11-05T08:00:00Z",
  allowedOperations
 });
}
function verified(receipt=signed()){
 return verifyAuthorityOnlyGrant(receipt,{trustedKeys,expectedEngineerDid:did,
  allowedOperations,nowMs:Date.parse("2026-11-05T07:30:00Z")});
}
function admitted(authenticated,nowMs=fixedNow){
 return assertVerifiedAuthorityOnlyGrant(authenticated,{allowedOperations,nowMs});
}
test("R1 proposal and selected grant contain authority without any Task, Agent or DAG fields",()=>{
 const draft=proposal();
 assert.equal(validateAuthorityProposal(draft,{allowedOperations}),draft);
 const authority=grant();
 assert.equal(validateAuthorityOnlyGrant(authority,{allowedOperations}),authority);
 assert.deepEqual(Object.keys(authority).sort(),[
  "base_revision","branch","permissions","repository","requirement_sha256",
  "schema_version","session_id"
 ]);
 assert.equal("tasks" in authority,false);
 assert.equal("candidate_agents" in authority,false);
 assert.equal("plan_digest" in authority,false);
 assert.equal(authority.permissions.length,4);
 assert.equal(authority.permissions.some(p=>p.operation==="create_pull_request"),false);
 assert.equal(authorityOnlyDigest(authority,{allowedOperations}).length,64);
});
test("Authority decision cannot approve an unrequested pair or duplicate an authorization",()=>{
 const draft=proposal();
 assert.throws(()=>selectAuthorityOnlyGrant(draft,[...permitted,
  {resource:other,operation:"update_file"}],{allowedOperations}),/exceeds proposal/);
 assert.throws(()=>selectAuthorityOnlyGrant(draft,[permitted[0],permitted[0]],
  {allowedOperations}),/duplicate/);
 const duplicated=proposal();
 duplicated.requested_permissions.push({...duplicated.requested_permissions[0]});
 assert.throws(()=>validateAuthorityProposal(duplicated,{allowedOperations}),/duplicate/);
 const outOfRepo=proposal();
 outOfRepo.requested_permissions[1].resource="gitea://evil.local/thesis/iam-console-poc";
 assert.throws(()=>validateAuthorityProposal(outOfRepo,{allowedOperations}),/outside repository/);
 const badKind=proposal();
 badKind.requested_permissions[1].resource=root;
 assert.throws(()=>validateAuthorityProposal(badKind,{allowedOperations}),/wrong resource kind/);
});
test("Signature modification, revoked key mapping, wrong Engineer and expiry are rejected",()=>{
 const signature=signed();
 const modified=structuredClone(signature);
 modified.authorization.requirement_sha256="b".repeat(64);
 assert.throws(()=>verified(modified),/invalid signature/);
 const altered=structuredClone(signature);
 altered.authorization.permissions[0].operation="create_pull_request";
 assert.throws(()=>verified(altered));
 assert.throws(()=>verifyAuthorityOnlyGrant(signature,{
  trustedKeys,expectedEngineerDid:"did:example:other",
  allowedOperations,nowMs:Date.parse("2026-11-05T07:30:00Z")}),/wrong Engineer/);
 assert.throws(()=>verifyAuthorityOnlyGrant(signature,{
  trustedKeys:{},expectedEngineerDid:did,
  allowedOperations,nowMs:Date.parse("2026-11-05T07:30:00Z")}),/untrusted/);
 assert.throws(()=>verifyAuthorityOnlyGrant(signature,{
  trustedKeys,expectedEngineerDid:did,
  allowedOperations,nowMs:Date.parse("2026-11-05T08:00:00Z")}),/expired/);
});
test("A forged authenticated-looking record cannot bypass the signed-receipt verifier",()=>{
 const real=verified();
 const forged={...structuredClone(real),authenticated:true};
 assert.equal(admitted(real).authority_digest,real.authority_digest);
 assert.throws(()=>admitted(forged),/unverified Engineer authority/);
 assert.throws(()=>admitted({}),/unverified Engineer authority/);
 const tampered=verified();
 tampered.authorization.permissions[0].operation="create_file";
 assert.throws(()=>admitted(tampered));
});

test("an already authenticated grant expires before any later admission",()=>{
 assert.throws(()=>admitted(verified(),Date.parse("2026-11-05T08:00:00Z")),/expired/);
});

test("the project profile digest is carried from the proposal into the signed grant", async () => {
  const {selectAuthorityOnlyGrant, authorityOnlyDigest, validateAuthorityProposal} =
    await import("../src/authority-only-approval.mjs");
  const repository = {authority: "gitea.local", owner: "thesis", repository: "iam-console-poc"};
  const base = {schema_version: "1.0.0", session_id: "s-profile", repository,
    branch: "feature/s-profile", base_revision: "a".repeat(40), requirement: "Add a feature",
    requested_permissions: [{operation: "create_branch", resource: "gitea://gitea.local/thesis/iam-console-poc"}]};
  const withProfile = sha => ({...base, project_profile_sha256: sha});
  const g1 = selectAuthorityOnlyGrant(withProfile("1".repeat(64)), base.requested_permissions, {allowedOperations});
  const g2 = selectAuthorityOnlyGrant(withProfile("2".repeat(64)), base.requested_permissions, {allowedOperations});
  assert.equal(g1.project_profile_sha256, "1".repeat(64));
  assert.notEqual(authorityOnlyDigest(g1, {allowedOperations}), authorityOnlyDigest(g2, {allowedOperations}),
    "signing a different test profile is a different Engineer decision");
  assert.throws(() => validateAuthorityProposal(withProfile("not-a-digest"), {allowedOperations}), /project profile/u);
  assert.equal(Object.hasOwn(selectAuthorityOnlyGrant(base, base.requested_permissions, {allowedOperations}),
    "project_profile_sha256"), false);
});
