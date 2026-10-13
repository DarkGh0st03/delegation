/**
 * Human-only protected Gitea merge CLI.
 *
 * Entry point intentionally absent from ADK, MCP, Gateway and test runners.
 * Only a reviewed GitHub workflow_dispatch from the configured actor should
 * call this script, using environment-scoped credentials.
 *
 * There is no dry-run-to-write fallback and NO automatic operation on push.
 */
import {TrustedGiteaMergeExecutor,TrustedMergeDenied}
  from "../src/trusted-merge.ts";
import {MergeReadinessDenied} from "../src/merge-readiness.ts";
import {validateManualMergeIntent,ManualMergeIntentDenied}
  from "../src/manual-merge-intent.ts";

function required(name){
  const value=process.env[name];
  if(!value||value.trim()!==value){
    throw new Error("missing_or_invalid_configuration");
  }
  return value;
}
function actor(prefix){
  const id=Number(required(prefix+"_ID"));
  const login=required(prefix+"_LOGIN");
  if(!Number.isSafeInteger(id)||id<1||
    !/^[a-zA-Z0-9_.-]{1,128}$/u.test(login)){
    throw new Error("missing_or_invalid_configuration");
  }
  return {id,login};
}
async function run(){
  // Nothing (including a read of the privileged credentials) happens until
  // all manual controls and the exact operator confirmation have passed.
  if(process.argv.length!==3||process.argv[2]!=="--execute"||
    process.env.GITHUB_ACTIONS!=="true"){
    throw new ManualMergeIntentDenied("invalid_dispatch");
  }
  const intent=validateManualMergeIntent({
    eventName:process.env.GITHUB_EVENT_NAME,
    actor:process.env.GITHUB_ACTOR,
    triggeringActor:process.env.GITHUB_TRIGGERING_ACTOR,
    authorizedActor:process.env.THESIS_MERGE_GITHUB_OPERATOR,
    ref:process.env.GITHUB_REF,
    pr:process.env.MANUAL_MERGE_PR,
    sha:process.env.MANUAL_MERGE_SHA,
    confirmation:process.env.MANUAL_MERGE_CONFIRM
  });
  const reader=required("THESIS_MERGE_READ_TOKEN");
  const protectionReader=required("THESIS_MERGE_PROTECTION_READ_TOKEN");
  const merger=required("THESIS_MERGE_WRITE_TOKEN");
  // Prevent accidentally reusing the privileged token as a reader.
  if(merger===reader||merger===protectionReader){
    throw new Error("missing_or_invalid_configuration");
  }
  const executor=new TrustedGiteaMergeExecutor({
    giteaBaseUrl:required("THESIS_MERGE_GITEA_URL"),
    readToken:reader,branchProtectionReadToken:protectionReader,
    humanReviewer:actor("THESIS_MERGE_REVIEWER"),
    securityPipelineActor:actor("THESIS_MERGE_CI"),
    mergeToken:merger,mergeActor:actor("THESIS_MERGE_OPERATOR")
  });
  const result=await executor.execute({
    pullRequestNumber:intent.pullRequestNumber,
    expectedHeadSha:intent.expectedHeadSha
  });
  // The output contains only revision/actor IDs, never tokens or PR contents.
  process.stdout.write(JSON.stringify({
    event:"gitea_manual_protected_merge",status:"MERGED",
    ...result
  })+"\n");
}
try{
  await run();
}catch(error){
  // Do not print remote bodies, URL or environment values under any error.
  const code=error instanceof ManualMergeIntentDenied||
    error instanceof TrustedMergeDenied||
    error instanceof MergeReadinessDenied
    ?error.reason:"configuration_or_execution_error";
  process.stderr.write(JSON.stringify({
    event:"gitea_manual_protected_merge",status:"DENIED",reason:code
  })+"\n");
  process.exitCode=1;
}
