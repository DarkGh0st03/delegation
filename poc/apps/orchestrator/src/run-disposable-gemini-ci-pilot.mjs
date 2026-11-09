#!/usr/bin/env node
/**
 * Disposable CI research-only Engineer DECISION SIMULATION.
 *
 * A proposal may only select from an experiment-wide, code-pinned ceiling.
 * This module signs and verifies a REAL domain-separated Ed25519 approval
 * using an EPHEMERAL CI-only Engineer identity. It does not issue Rust roots,
 * Child DC/VP or dispatch tasks; those are separate native E2E proofs.
 * Crucially, this CANNOT stand in for the protected human R5 owner path.
 *
 * No model is imported here. The initial executable is scripted-only,
 * strictly workflow_dispatch, with no GEMINI_API_KEY or billable mode.
 */
import {generateKeyPairSync} from "node:crypto";
import {execFileSync} from "node:child_process";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {RUST_OPERATIONS}
 from "../../gateway/src/operation-catalog.ts";
import {selectAuthorityOnlyGrant,signAuthorityOnlyGrant,verifyAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";

const REPOSITORY=Object.freeze({
 authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"
});
const SOURCE_REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WF=".github/workflows/gemini-authority-only-ci-pilot.yml";
const REQ="R375 original protected-main Account Suspension signed functional integration proof";
const BRANCH="feature/account-suspension";
const BASE="gitea://gitea.local/thesis/iam-console-poc";
const FEATURE=BASE+"/branches/feature%2Faccount-suspension";
const SHA=/^[0-9a-f]{40}$/u;
const ROLES=Object.freeze(["backend","frontend","test"]);
const PATHS=Object.freeze([
 "apps/backend/src/users/user.service.ts",
 "apps/backend/src/users/user.controller.ts",
 "apps/backend/src/users/user.routes.ts",
 "packages/shared/src/account-status.ts",
 "apps/frontend/src/api/users-api.ts",
 "apps/frontend/src/pages/UserDetailPage.tsx",
 "apps/frontend/src/styles.css",
 "tests/backend/user.service.test.ts",
 "tests/backend/user.routes.test.ts",
 "tests/frontend/UserDetailPage.test.tsx"
]);
const pair=(resource,operation)=>({resource,operation});
const fixedCeiling=Object.freeze([
 pair(BASE,"create_branch"),pair(BASE,"create_pull_request"),
 pair(FEATURE,"run_tests"),
 ...PATHS.flatMap(p=>[
  pair(FEATURE+"/files/"+p,"read_file"),
  pair(FEATURE+"/files/"+p,"update_file")
 ])
]);
const PERMITTED=new Set(fixedCeiling.map(p=>JSON.stringify([p.resource,p.operation])));
const OPERATIONS=new Set(RUST_OPERATIONS);
function deny(){throw Error("Disposable authority-only CI pilot NO-GO");}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function validRoles(roles){
 return Array.isArray(roles)&&equal(roles,ROLES);
}
function samePair(a,b){
 return a?.resource===b.resource&&a?.operation===b.operation;
}
/** No user or model can supply the approved ceiling or an Engineer key. */
export function simulateDisposableEngineerDecision({
 proposal,roles=ROLES,nowMs=Date.now()
}={}){
 if(!validRoles(roles)||!Number.isSafeInteger(nowMs)||nowMs<0||
    !proposal||typeof proposal!=="object"||
    proposal.schema_version!=="1.0.0"||
    proposal.requirement!==REQ||
    !equal(proposal.repository,REPOSITORY)||
    proposal.branch!==BRANCH||
    !SHA.test(proposal.base_revision??"")||
    !Array.isArray(proposal.requested_permissions)||
    proposal.requested_permissions.length===0||
    proposal.requested_permissions.some(p=>
     !PERMITTED.has(JSON.stringify([p?.resource,p?.operation]))))
  deny();
 // A valid proposal is NOT authority. It must pass the original
 // plan-contract selection, Ed25519 signer, then independent verifier.
 const approved=proposal.requested_permissions.map(p=>({
  resource:p.resource,operation:p.operation
 }));
 if(!approved.every(p=>fixedCeiling.some(x=>samePair(p,x))))deny();
 const grant=selectAuthorityOnlyGrant(proposal,approved,{
  allowedOperations:OPERATIONS
 });
 const {publicKey,privateKey}=generateKeyPairSync("ed25519");
 const did="did:thesis:disposable-ci-engineer";
 const keyId="disposable-ci-engineer-ed25519";
 const issuedAt=new Date(nowMs).toISOString().replace(/\.\d{3}Z$/u,"Z");
 const expiresAt=new Date(nowMs+10*60_000).toISOString()
  .replace(/\.\d{3}Z$/u,"Z");
 const receipt=signAuthorityOnlyGrant({
  authorization:grant,engineerDid:did,keyId,
  privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}),
  issuedAt,expiresAt,allowedOperations:OPERATIONS
 });
 const verified=verifyAuthorityOnlyGrant(receipt,{
  expectedEngineerDid:did,nowMs,
  trustedKeys:{[keyId]:{engineer_did:did,
   public_key_pem:publicKey.export({format:"pem",type:"spki"})}},
  allowedOperations:OPERATIONS
 });
 if(verified.authenticated!==true||
    !equal(verified.authorization,grant))deny();
 // The receipt, signer and raw proposal stay inside this process.
 return Object.freeze({
  status:"disposable_ci_engineer_decision_simulated_and_signed",
  engineer_review:"SIMULATED_NOT_HUMAN",
  signed_authority_verified:true,
  authority_digest:verified.authority_digest,
  permission_count:grant.permissions.length,
  canonical_specialists:[...ROLES],
  native_rust_roots_in_this_step:0,
  child_credentials_in_this_step:0,
  live_a2a_tasks_in_this_step:0,
  model_calls:0,
  model_generativity_proven:false,
  full_pilot_proven:false
 });
}
/** Fixed, bounded fixture, NOT a Gemini-produced plan or Gitea revision. */
export function scriptedResearchProposal(){
 return {
  schema_version:"1.0.0",
  session_id:"disposable-ci-scripted-only",
  repository:{...REPOSITORY},branch:BRANCH,
  base_revision:"a".repeat(40),
  requirement:REQ,
  requested_permissions:fixedCeiling.map(p=>({...p}))
 };
}
export function assertDisposableCiSource(env=process.env){
 if(env.GITHUB_ACTIONS!=="true"||
    env.GITHUB_REPOSITORY!==SOURCE_REPO||
    env.GITHUB_REF!==REF||
    env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
    env.GITHUB_WORKFLOW_REF!==SOURCE_REPO+"/"+WF+"@"+REF||
    env.GITHUB_RUN_ATTEMPT!=="1"||
    !/^[1-9]\d{0,19}$/u.test(env.GITHUB_RUN_ID??"")||
    !SHA.test(env.GITHUB_SHA??"")||
    env.DELEGATION_DISPOSABLE_CI_MODE!=="scripted-offline"||
    env.GEMINI_API_KEY!==undefined||
    env.OPENAI_API_KEY!==undefined||
    env.DELEGATION_SIGNED_GEMINI_PILOT!==undefined)
  deny();
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
 let sha,dirty;
 try{
  sha=execFileSync("git",["rev-parse","HEAD"],{
   cwd:root,encoding:"utf8",timeout:3000,stdio:["ignore","pipe","ignore"]
  }).trim();
  dirty=execFileSync("git",["status","--porcelain","--untracked-files=all"],{
   cwd:root,encoding:"utf8",timeout:3000,stdio:["ignore","pipe","ignore"]
  }).trim();
 }catch{deny();}
 if(sha!==env.GITHUB_SHA||dirty)deny();
 return Object.freeze({source_sha:sha,mode:"scripted-offline"});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==2)deny();
  const source=assertDisposableCiSource();
  const approved=simulateDisposableEngineerDecision({
   proposal:scriptedResearchProposal()
  });
  process.stdout.write(JSON.stringify({...approved,source_sha:source.source_sha})+"\n");
 }catch{
  process.stderr.write("Disposable authority-only CI pilot NO-GO\n");
  process.exitCode=1;
 }
}
