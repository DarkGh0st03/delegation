import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PLAN_SCHEMA_VERSION} from "../src/plan.mjs";
import {
 AUTHORITY_ONLY_SCHEMA,validateAuthorityProposal,validateAuthorityOnlyGrant,
 selectAuthorityOnlyGrant,authorityOnlyDigest,signAuthorityOnlyGrant,
 verifyAuthorityOnlyGrant,assertExecutionWithinAuthority
} from "../src/authority-only-approval.mjs";

const allowedOperations=new Set(["create_branch","create_pull_request",
 "read_repository","read_file","update_file","create_file","run_tests","list_directory"]);
const repository={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension";
const root="gitea://gitea.local/thesis/iam-console-poc";
const branchUri=root+"/branches/feature%2Faccount-suspension";
const file=branchUri+"/files/apps/backend/src/users/user.service.ts";
const other=branchUri+"/files/apps/backend/src/users/unauthorized.ts";
const requirement="Implement account suspension under the signed authority boundary";
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
  schema_version:AUTHORITY_ONLY_SCHEMA,session_id:"session-account-suspension",
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
function authorityPreflight(plan,authenticated){
 return assertExecutionWithinAuthority(plan,authenticated,{allowedOperations,nowMs:fixedNow});
}
function executionPlan(role="backend",suffix="initial"){
 const work="work-"+suffix;
 return {
  schema_version:PLAN_SCHEMA_VERSION,
  plan_id:"execution-"+suffix,session_id:"session-account-suspension",
  version:suffix==="initial"?1:2,repository:{...repository},
  base_revision:sha,requirement,
  candidate_agents:[
   {agent_id:role,did:"did:example:"+role,card_ref:"trusted:"+role},
   {agent_id:"test",did:"did:example:test",card_ref:"trusted:test"}
  ],
  tasks:[
   {id:"branch-"+suffix,agent_id:"orchestrator",title:"Start isolated branch",
    description:"Create work branch",depends_on:[],resources:[root]},
   {id:work,agent_id:role,title:"Implement "+suffix,
    description:"Read and update authorized existing source",
    depends_on:["branch-"+suffix],resources:[file]},
   {id:"test-"+suffix,agent_id:"test",title:"Verify "+suffix,
    description:"Run tests on exact feature branch",
    depends_on:[work],resources:[branchUri]}
  ],
  requested_permissions:[
   {id:"p1",task_id:"branch-"+suffix,agent_id:"orchestrator",
    operation:"create_branch",resource:root,reason:"Isolate"},
   {id:"p2",task_id:work,agent_id:role,operation:"read_file",resource:file,reason:"Inspect"},
   {id:"p3",task_id:work,agent_id:role,operation:"update_file",resource:file,reason:"Edit"},
   {id:"p4",task_id:"test-"+suffix,agent_id:"test",operation:"run_tests",
    resource:branchUri,reason:"Validate"}
  ],
  assumptions:[],uncertainties:[]
 };
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
test("One Engineer signature admits two different Task DAGs and selected agents without reapproval",()=>{
 const signature=signed(),trusted=verified(signature);
 assert.equal(trusted.authenticated_engineer_did,did);
 assert.equal(trusted.authenticated,true);
 const initial=authorityPreflight(executionPlan("backend","initial"),trusted,{allowedOperations});
 const repair=authorityPreflight(executionPlan("frontend","repair"),trusted,{allowedOperations});
 assert.deepEqual([initial.status,repair.status],["scope_preflight_only","scope_preflight_only"]);
 assert.equal(initial.authority_digest,repair.authority_digest);
 assert.equal(initial.execution_authorized,false);
 assert.equal(initial.root_credential_issued,false);
 assert.equal(repair.task_binding_authorized,false);
 const signatureText=JSON.stringify(signature);
 for(const token of ["task_id","agent_id","depends_on","candidate_agents"])
  assert.ok(!signatureText.includes(token));
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
test("Execution changing root, requirement, repository, branch or permissions fails closed",()=>{
 const scope=verified();
 for(const mutate of [
  p=>{p.session_id="other-session";},
  p=>{p.requirement="Delete all accounts instead";},
  p=>{p.base_revision="b".repeat(40);},
  p=>{p.repository.repository="foreign";},
  p=>{p.requested_permissions[3].resource=branchUri.replace("account-suspension","other");
    p.tasks[2].resources=[p.requested_permissions[3].resource];},
  p=>{p.requested_permissions[2].resource=other;
    p.tasks[1].resources=[file,other];}
 ]){
  const plan=executionPlan();
  mutate(plan);
  assert.throws(()=>authorityPreflight(plan,scope,{allowedOperations}));
 }
 const unapprovedPr=executionPlan();
 unapprovedPr.tasks.push({
  id:"pr",agent_id:"orchestrator",title:"PR",description:"Open review",
  depends_on:["test-initial"],resources:[root]
 });
 unapprovedPr.requested_permissions.push({
  id:"p5",task_id:"pr",agent_id:"orchestrator",
  resource:root,operation:"create_pull_request",reason:"Review"
 });
 assert.throws(()=>authorityPreflight(unapprovedPr,scope,
  {allowedOperations}),/unapproved permission/);
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
 assert.throws(()=>authorityPreflight(executionPlan(),forged,
  {allowedOperations}),/unverified Engineer authority/);
 assert.throws(()=>authorityPreflight(executionPlan(),{},
  {allowedOperations}),/unverified Engineer authority/);
 const tampered=verified();
 tampered.authorization.permissions[0].operation="create_file";
 assert.throws(()=>authorityPreflight(executionPlan(),tampered,
  {allowedOperations}));
});

test("R1 an already authenticated grant expires before any later execution preflight",()=>{
 const scope=verified();
 assert.throws(()=>assertExecutionWithinAuthority(executionPlan(),scope,{
  allowedOperations,nowMs:Date.parse("2026-11-05T08:00:00Z")
 }),/expired/);
});
