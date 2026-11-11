#!/usr/bin/env node
/**
 * FREE, no-model GitHub Actions OIDC smoke. Push-only, non-authorizing:
 * no Engineer trust store, no Gitea, no DC, no model secret.
 * Never print a raw OIDC JWT or its jti/signature/subject.
 */
import {verifyGithubOidcOfflinePushProbe}
  from "../src/trusted-github-oidc.ts";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/cumulative-refactoring-offline.yml";
const AUDIENCE="urn:thesis:delegation:offline-github-oidc-check-v1";
const POLICY=Object.freeze({
  expectedAudience:AUDIENCE,
  // Repositories created after 2026-07-15 use GitHub's immutable default
  // subject: owner@ownerId/repository@repoId (not legacy mutable names).
  expectedSubject:"repo:DarkGh0st03@150908952/delegation@1374168963:ref:"+REF,
  // Independently verified immutable GitHub repository and owner IDs.
  expectedRepositoryId:"1374168963",
  expectedOwnerId:"150908952"
});
function deny(){throw Error("Offline GitHub OIDC proof denied");}
let stage="environment";
try{
  if(process.env.GITHUB_ACTIONS!=="true"||
     process.env.GITHUB_EVENT_NAME!=="push"||
     process.env.GITHUB_RUN_ATTEMPT!=="1"||
     process.env.GITHUB_REPOSITORY!==REPO||
     process.env.GITHUB_REF!==REF||
     process.env.GITHUB_WORKFLOW_REF!==REPO+"/"+WORKFLOW+"@"+REF||
     !/^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA??"")||
     !/^[1-9][0-9]*$/u.test(process.env.GITHUB_RUN_ID??""))
    deny();
  stage="oidc_request_configuration";
  const rawUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(!rawUrl||!bearer)deny();
  const url=new URL(rawUrl);
  if(url.protocol!=="https:"||
     !/(^|\.)actions\.githubusercontent\.com$/u.test(url.hostname))
    deny();
  url.searchParams.set("audience",AUDIENCE);
  stage="request_real_github_oidc_token";
  const response=await fetch(url,{
    headers:{authorization:"Bearer "+bearer,accept:"application/json"},
    redirect:"error",signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)deny();
  const responseText=await response.text();
  if(responseText.length>18000)deny();
  const body=JSON.parse(responseText);
  if(typeof body.value!=="string")deny();
  stage="verify_real_oidc_signature_claims";
  const proof=await verifyGithubOidcOfflinePushProbe({
    jwt:body.value,
    pinned:{
      repository:REPO,ref:REF,workflowPath:WORKFLOW,
      sourceSha:process.env.GITHUB_SHA
    },
    expectedRunId:process.env.GITHUB_RUN_ID,
    trust:POLICY
  });
  if(proof.kind!=="offline_push_identity_only"||
     proof.signature_verified!==true)deny();
  process.stdout.write(JSON.stringify({
    status:"github_issued_oidc_signature_and_push_identity_verified",
    event:"push",
    authenticated_job:true,
    engineer_approval:"not_checked",
    billable_execution:"not_permitted",
    gemini_calls:0
  })+"\n");
}catch(error){
  // Fixed-stage diagnostic only; never echo JWT/URL/headers or exceptions
  // that could contain security-sensitive values.
  const knownError=typeof error?.message==="string"&&
    error.message.startsWith("Trusted GitHub OIDC assertion:");
  const reason=knownError?error.message.slice(
    "Trusted GitHub OIDC assertion:".length).trim():"unclassified";
  process.stderr.write("[offline-oidc] rejected "+
    JSON.stringify({stage,reason})+"\n");
  process.exitCode=1;
}
