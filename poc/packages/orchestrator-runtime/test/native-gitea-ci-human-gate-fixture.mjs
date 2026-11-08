/**
 * R399: ON THE SAME NATIVE R385.13 GITEA DRAFT PR, a separate disposable
 * Security CI service account runs the REAL Docker project + researcher
 * acceptance, publishes pending -> success on the exact attested SHA,
 * then a READ-ONLY Human Gate must refuse readiness while the PR is Draft.
 *
 * Not an actual human approval; Gitea is disposable and main is immutable.
 * This fixture never makes a review, undrafts a PR, or sends merge requests.
 * Runner evidence is created afresh by a trusted independent CI runner.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {IsolatedDockerRunnerExecutor}
 from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {TrustedGiteaSecurityCi,SECURITY_STATUS_CONTEXT}
 from "../../../apps/test-runner-controller/src/trusted-security-ci.ts";
import {GiteaMergeReadinessVerifier,MergeReadinessDenied}
 from "../src/merge-readiness.ts";

const REPO="/api/v1/repos/thesis/iam-console-poc";
const SHA=/^[a-f0-9]{40}$/u;
const BRANCH="feature/account-suspension";

function basic(user,password){
 return "Basic "+Buffer.from(user+":"+password).toString("base64");
}
async function getJson(base,path,authorization,method="GET",body){
 const response=await fetch(base+path,{
  method,redirect:"error",
  headers:{
   authorization,accept:"application/json",
   ...(method==="POST"||method==="PUT"
      ?{"content-type":"application/json"}:{})
  },
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(30000)
 });
 if(!response.ok||![200,201,204].includes(response.status))
  throw Error("R399 disposable Gitea request refused: "+method+
   " "+response.status);
 if(response.status===204)return {};
 return response.json();
}
function registerDisposableUser(user,password){
 // The CLI is used solely to bootstrap a LOCAL disposable Gitea account.
 // No environment passwords, tokens or Docker stderr may enter CI logs.
 try{
  execFileSync("docker",[
   "compose","--env-file","poc/infra/.env",
   "-f","poc/infra/docker-compose.yml",
   "exec","-T","--user","1000:1000","gitea",
   "gitea","admin","user","create",
   "--username",user,"--password",password,
   "--email",user+"@localhost.invalid",
   "--must-change-password=false"
  ],{
   cwd:fileURLToPath(new URL("../../../../",import.meta.url)),
   stdio:["ignore","pipe","pipe"],timeout:120000
  });
 }catch{
  throw Error("R399 disposable CI actor bootstrap failed");
 }
}
export async function proveNativeDraftPrSameHeadSecurityCi({
 giteaBaseUrl,readToken,runner,number,headSha,mainSha
}){
 assert.equal(process.env.R399_NATIVE_SAME_PR_GATE,"1");
 assert.equal(process.env.R38513_NATIVE_STRICT_FULL_RECOVERY,"1");
 assert.equal(process.env.GEMINI_API_KEY,undefined);
 assert.equal(process.env.OPENAI_API_KEY,undefined);
 assert.ok(typeof giteaBaseUrl==="string"&&
  /^http:\/\/127\.0\.0\.1:\d{2,5}$/u.test(giteaBaseUrl),
  "R399 must use disposable local Gitea, never production");
 assert.ok(SHA.test(headSha)&&SHA.test(mainSha)&&headSha!==mainSha);
 assert.ok(Number.isSafeInteger(number)&&number>0);
 assert.ok(typeof readToken==="string"&&readToken.length>=20);
 assert.ok(runner instanceof IsolatedDockerRunnerExecutor,
  "R399 only accepts the authentic independent isolated Docker Runner");
 const adminUser=process.env.GITEA_ADMIN_USER;
 const adminPass=process.env.GITEA_ADMIN_PASSWORD;
 assert.ok(adminUser&&adminPass,"R399 requires disposable Gitea administrator");
 const adminAuth=basic(adminUser,adminPass),readAuth="token "+readToken;
 const prPath=REPO+"/pulls/"+number;
 const [initialPr,initialMain,branchMeta]=await Promise.all([
  getJson(giteaBaseUrl,prPath,readAuth),
  getJson(giteaBaseUrl,REPO+"/branches/main",readAuth),
  getJson(giteaBaseUrl,REPO+"/branches/"+encodeURIComponent(BRANCH),readAuth)
 ]);
 assert.equal(initialPr.state,"open");
 assert.equal(initialPr.merged,false);
 assert.equal(initialPr.draft,true,
  "R399 must check the ORIGINAL signed native Draft PR");
 assert.equal(initialPr.head?.ref,BRANCH);
 assert.equal(initialPr.head?.sha,headSha);
 assert.equal(initialPr.base?.sha,mainSha);
 assert.equal(initialMain.commit?.id,mainSha);
 assert.equal(branchMeta.commit?.id,headSha);

 // Status writer and the merge-readiness inspector have DIFFERENT tokens.
 // Native owner and A2A workers never receive the CI service PAT.
 const suffix=randomBytes(6).toString("hex");
 const ciName="native-security-ci-"+suffix;
 const ciPassword=randomBytes(24).toString("hex");
 registerDisposableUser(ciName,ciPassword);
 await getJson(giteaBaseUrl,REPO+"/collaborators/"+ciName,adminAuth,"PUT",
  {permission:"write"});
 const [ciToken,adminReader]=await Promise.all([
  getJson(giteaBaseUrl,"/api/v1/users/"+ciName+"/tokens",
   basic(ciName,ciPassword),"POST",{
    name:"native-ci-"+suffix,
    scopes:["write:repository","read:user"]
   }),
  getJson(giteaBaseUrl,"/api/v1/users/"+adminUser+"/tokens",
   adminAuth,"POST",{
    name:"native-human-gate-reader-"+suffix,
    scopes:["read:repository","read:user"]
   })
 ]);
 assert.match(ciToken.sha1??"",SHA);
 assert.match(adminReader.sha1??"",SHA);
 const branchProtection=await getJson(giteaBaseUrl,
  REPO+"/branch_protections/main","token "+adminReader.sha1);
 assert.equal(branchProtection.branch_name,"main");
 assert.equal(branchProtection.enable_push,false);
 assert.equal(branchProtection.enable_force_push,false);
 assert.ok(branchProtection.required_approvals>=1);
 assert.equal(branchProtection.block_admin_merge_override,true);
 assert.equal(branchProtection.dismiss_stale_approvals,true);
 assert.equal(branchProtection.block_on_outdated_branch,true);
 const [ciIdentity,humanIdentity]=await Promise.all([
  getJson(giteaBaseUrl,"/api/v1/user","token "+ciToken.sha1),
  getJson(giteaBaseUrl,"/api/v1/user",adminAuth)
 ]);
 assert.ok(Number.isSafeInteger(ciIdentity.id)&&ciIdentity.id>0);
 assert.ok(Number.isSafeInteger(humanIdentity.id)&&humanIdentity.id>0);
 assert.equal(ciIdentity.login,ciName);
 assert.equal(humanIdentity.login,adminUser);
 assert.notEqual(ciIdentity.id,humanIdentity.id);

 const gate=new GiteaMergeReadinessVerifier({
  giteaBaseUrl,readToken,
  branchProtectionReadToken:adminReader.sha1,
  humanReviewer:{id:humanIdentity.id,login:adminUser},
  securityPipelineActor:{id:ciIdentity.id,login:ciName},
  timeoutMs:25000
 });
 const input={pullRequestNumber:number,expectedHeadSha:headSha};
 const mustDenyDraft=()=>assert.rejects(gate.verify(input),
  error=>error instanceof MergeReadinessDenied&&
   error.reason==="pr_is_draft");
 await mustDenyDraft();
 const ci=new TrustedGiteaSecurityCi({
  giteaBaseUrl,giteaReadToken:readToken,
  giteaStatusToken:ciToken.sha1,
  trustedStatusActor:{id:ciIdentity.id,login:ciName},
  runner
 });
 const request={
  request_id:randomUUID(),
  repository:"gitea://gitea.local/thesis/iam-console-poc",
  branch:BRANCH,commit_sha:headSha,profile:"poc-default"
 };
 const verdict=await ci.run(request);
 assert.equal(verdict.status,"success");
 assert.equal(verdict.tested_commit_sha,headSha);
 assert.equal(verdict.context,SECURITY_STATUS_CONTEXT);
 const statuses=await getJson(giteaBaseUrl,
  REPO+"/commits/"+headSha+"/statuses?limit=50",readAuth);
 assert.ok(Array.isArray(statuses));
 const trustedStatuses=statuses.filter(x=>
  x.context===SECURITY_STATUS_CONTEXT);
 assert.equal(trustedStatuses.length,2,
  "Native PR exact HEAD must have one pending and one success");
 assert.ok(trustedStatuses.some(x=>x.status==="pending"&&
  x.creator?.id===ciIdentity.id));
 assert.ok(trustedStatuses.some(x=>x.status==="success"&&
  x.creator?.id===ciIdentity.id&&x.id===verdict.gitea_status_id));
 // A draft is NOT merge-ready, even if real Docker PASS and the CI actor
 // are correct; only a real human may subsequently advance that state.
 await mustDenyDraft();
 await assert.rejects(gate.verify({
  pullRequestNumber:number,expectedHeadSha:mainSha
 }),error=>error instanceof MergeReadinessDenied&&
  error.reason==="pr_revision_mismatch");
 const [finalPr,finalMain,finalBranch]=await Promise.all([
  getJson(giteaBaseUrl,prPath,readAuth),
  getJson(giteaBaseUrl,REPO+"/branches/main",readAuth),
  getJson(giteaBaseUrl,REPO+"/branches/"+encodeURIComponent(BRANCH),readAuth)
 ]);
 assert.equal(finalPr.number,number);
 assert.equal(finalPr.state,"open");
 assert.equal(finalPr.draft,true);
 assert.equal(finalPr.merged,false);
 assert.equal(finalPr.head?.sha,headSha);
 assert.equal(finalMain.commit?.id,mainSha);
 assert.equal(finalBranch.commit?.id,headSha);
 process.stdout.write(JSON.stringify({
  event:"r399_native_draft_pr_exact_head_security_ci",
  actual_native_draft_pr:true,
  original_root_pr_unchanged:true,
  real_disposable_gitea:true,
  exact_sha:headSha===verdict.tested_commit_sha,
  independent_ci_actor:true,
  real_ci_docker_tests_and_researcher_acceptance:"pass",
  exact_context_pending_then_success:true,
  read_only_human_gate_denied_draft:true,
  real_protected_main:true,
  branch_unchanged:true,main_unchanged:true,no_merge:true,
  paid_model_calls:0
 })+"\n");
 return {status:"pass",pull_request_number:number,
  head_sha:headSha,security_status_id:verdict.gitea_status_id};
}
