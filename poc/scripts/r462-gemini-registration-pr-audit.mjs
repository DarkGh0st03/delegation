#!/usr/bin/env node
/**
 * R462: ZERO-BILLING, READ-ONLY review of the independent paid-Gemini
 * GitHub workflow registration PR. Not registration, dispatch, Engineer
 * approval, a live runner, a private Host, or R5 GO. Never mutate main.
 */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const REPO='DarkGh0st03/delegation';
const MAIN='main';
const DEV='refactor/post-prof-plan-contracts-20261021';
const REG='chore/r5-private-registration-draft-20261109';
const PR=39;
const HEAD='9027178c2385a1f4604e3528665e77572ea17085';
const WORKFLOW='.github/workflows/trusted-gemini-private-session-hold.yml';
const BLOB='5db9d8862aa4de257ffada67171b56431c11440a';
const API='https://api.github.com/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/u;
const deny=reason=>{throw Error('R462 Gemini registration PR NO-GO: '+reason);};
const inRepo=ref=>ref?.repo?.full_name===REPO;

/** Pure snapshot verification; independent owner pins are mandatory. */
export function verifyR462GeminiRegistrationPrSnapshot({
 expectedDevelopmentSha,expectedMainSha,repository,main,development,
 registration,pr,files,developmentWorkflow,registrationWorkflow,
 mainWorkflowAbsent
}={}){
 if(!SHA.test(expectedDevelopmentSha??'')||!SHA.test(expectedMainSha??''))
  deny('independent SHA pins missing');
 if(repository?.full_name!==REPO||repository?.default_branch!==MAIN||
    main?.name!==MAIN||main?.commit?.sha!==expectedMainSha||
    development?.name!==DEV||development?.commit?.sha!==expectedDevelopmentSha||
    registration?.name!==REG||registration?.commit?.sha!==HEAD)
  deny('source or registration branch drift');
 if(pr?.number!==PR||pr.state!=='open'||pr.draft!==true||
    pr.merged!==false||pr.base?.ref!==MAIN||
    pr.base.sha!==expectedMainSha||pr.head?.ref!==REG||
    pr.head.sha!==HEAD||!inRepo(pr.head)||!inRepo(pr.base))
  deny('the reviewed draft PR identity or base/head changed');
 if(pr.changed_files!==1||pr.additions!==63||pr.deletions!==0||
    !Array.isArray(files)||files.length!==1)
  deny('registration PR is not the reviewed one-file change');
 const file=files[0];
 if(file?.filename!==WORKFLOW||file.status!=='added'||
    file.sha!==BLOB||file.additions!==63||file.deletions!==0||
    developmentWorkflow?.type!=='file'||developmentWorkflow.path!==WORKFLOW||
    developmentWorkflow.sha!==BLOB||
    registrationWorkflow?.type!=='file'||registrationWorkflow.path!==WORKFLOW||
    registrationWorkflow.sha!==BLOB||mainWorkflowAbsent!==true)
  deny('private workflow byte identity or default registration drift');
 return Object.freeze({
  status:'reviewed_paid_workflow_registration_draft_only_not_merged',
  pull_request:PR,registration_head:HEAD,workflow_blob_sha:BLOB,
  reviewed_main_sha:expectedMainSha,reviewed_development_sha:expectedDevelopmentSha,
  workflow_registered_on_main:false,private_engineer_host_verified:false,
  private_runner_verified:false,charged_model_calls:0,r5_go:false
 });
}

/** Public GET only, fixed endpoints, fail closed on API/shape drift. */
export async function verifyR462GeminiRegistrationPr({
 expectedDevelopmentSha,expectedMainSha,fetchFn=fetch
}={}){
 if(!SHA.test(expectedDevelopmentSha??'')||!SHA.test(expectedMainSha??'')||
    typeof fetchFn!=='function')deny('missing review pins or reader');
 async function read(path,{array=false,allowMissing=false}={}){
  let response;
  try{
   response=await fetchFn(API+path,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{accept:'application/vnd.github+json',
     'x-github-api-version':'2022-11-28'}
   });
  }catch{deny('GitHub public information unavailable');}
  if(allowMissing&&response?.status===404)return null;
  if(!response?.ok)deny('GitHub PR or source unavailable');
  try{
   const value=await response.json();
   if(!value||typeof value!=='object'||Array.isArray(value)!==array)
    deny('malformed GitHub response');
   return value;
  }catch{deny('malformed GitHub response');}
 }
 const [repository,main,development,registration,pr,files,
        developmentWorkflow,registrationWorkflow,mainWorkflow]=await Promise.all([
  read(''),
  read('/branches/'+MAIN),
  read('/branches/'+encodeURIComponent(DEV)),
  read('/branches/'+encodeURIComponent(REG)),
  read('/pulls/'+PR),
  read('/pulls/'+PR+'/files?per_page=100',{array:true}),
  read('/contents/'+WORKFLOW+'?ref='+encodeURIComponent(DEV)),
  read('/contents/'+WORKFLOW+'?ref='+encodeURIComponent(REG)),
  read('/contents/'+WORKFLOW+'?ref='+MAIN,{allowMissing:true})
 ]);
 return verifyR462GeminiRegistrationPrSnapshot({
  expectedDevelopmentSha,expectedMainSha,repository,main,development,
  registration,pr,files,developmentWorkflow,registrationWorkflow,
  mainWorkflowAbsent:mainWorkflow===null
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const proof=await verifyR462GeminiRegistrationPr({
   expectedDevelopmentSha:process.env.DELEGATION_R462_EXPECTED_DEV_SHA,
   expectedMainSha:process.env.DELEGATION_R462_EXPECTED_MAIN_SHA
  });
  process.stdout.write('R462: PR #'+proof.pull_request+
   ' exact draft workflow verified; main remains UNREGISTERED; no R5 GO\n');
 }catch{
  // No upstream error body, token, secret or internal host details.
  process.stderr.write('R462 private Gemini registration PR audit NO-GO\n');
  process.exitCode=1;
 }
}
