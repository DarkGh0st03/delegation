#!/usr/bin/env node
/**
 * F1 OPTIONAL REAL GEMINI RESEARCH PROBE on a disposable REAL Gitea checkout.
 *
 * No call to Gemini, Node ADK model construction, credential issuance,
 * approved execution or Gitea write happens on the default --dry-run path.
 *
 * PAID --execute is NEVER allowed in GitHub Actions and requires four
 * independent operator inputs: explicit CLI flag, literal billing consent,
 * API key and model name, plus a fresh owner-only artifact directory.
 *
 * This is the DIRECT READ-ONLY Gitea research path. It is explicitly NOT
 * TrustedPlanningGatewayReadPort, does not authenticate a preliminary Rust
 * VP or provide native Gateway/OPA evidence. DO NOT use its proposal as
 * approval, or claim it is the full production F2 Gemini E2E.
 */
import {mkdir,lstat,open} from "node:fs/promises";
import {join,isAbsolute,resolve,normalize} from "node:path";
import {pathToFileURL} from "node:url";
import {buildF1RealGiteaResearchPlanningPort}
  from "./f1-gitea-research-planning-port.mjs";
import {CONSENT,classifyPlannerProbeFailure}
  from "./run-gemini-planner-fixture.mjs";
import {evaluatePlannerFeasibility} from "./planner-feasibility-eval.mjs";
import {assessF1DepartmentDirectoryPlan}
  from "./f1-department-directory-functional-review.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const LOCAL=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
function reject(reason){throw Error("F1 real Gemini Planning refused: "+reason);}
// This exception applies ONLY to the first attempt of a narrowly pinned,
// single-use workflow. Every other GitHub Actions run stays denied.
export const F1_ONE_TIME_CI_WORKFLOW=
  "F1 Gemini Real Gitea Single Authorized Planner Attempt";
export function isApprovedF1OneTimeCI({
  githubActions=process.env.GITHUB_ACTIONS,ciPermit=false,
  runnerEnv=process.env
}={}){
  if(githubActions!=="true")return true;
  return ciPermit===true&&runnerEnv.GITHUB_ACTIONS==="true"&&
    runnerEnv.GITHUB_WORKFLOW===F1_ONE_TIME_CI_WORKFLOW&&
    runnerEnv.GITHUB_REPOSITORY==="DarkGh0st03/delegation"&&
    runnerEnv.GITHUB_REF===
      "refs/heads/refactor/post-prof-plan-contracts-20261021"&&
    runnerEnv.GITHUB_EVENT_NAME==="push"&&
    runnerEnv.GITHUB_RUN_ATTEMPT==="1"&&
    /^[1-9][0-9]{0,19}$/u.test(runnerEnv.GITHUB_RUN_ID??"");
}

export function assertF1RealGeminiOperatorConsent({
  flag,consent,apiKey,modelName,outputDir,githubActions,ciPermit=false
}={}){
  if(!isApprovedF1OneTimeCI({githubActions,ciPermit}))
    reject("only the approved single-use F1 CI can infer");
  if(flag!=="--execute"||consent!==CONSENT||
     typeof apiKey!=="string"||apiKey.trim().length<10||
     typeof modelName!=="string"||
     !/^gemini-[a-z0-9.-]+$/u.test(modelName))
    reject("separate explicit model, API key and billable consent required");
  if(typeof outputDir!=="string"||!isAbsolute(outputDir)||
     outputDir.length>512||resolve(outputDir)!==outputDir||
     normalize(outputDir)!==outputDir)
    reject("fresh absolute private artifact directory required");
  return Object.freeze({modelName,outputDir});
}
async function privateDir(dir){
  await mkdir(dir,{recursive:false,mode:0o700});
  const s=await lstat(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||
     (process.getuid?.()!==undefined&&s.uid!==process.getuid()))
    reject("private research evidence directory is untrusted");
}
async function persist(dir,name,obj){
  const fd=await open(join(dir,name),"wx",0o600);
  try{await fd.writeFile(JSON.stringify(obj,null,2)+"\n","utf8");}
  finally{await fd.close();}
}
function hostPins({baseUrl,readToken,expectedMainSha}={}){
  const m=typeof baseUrl==="string"?LOCAL.exec(baseUrl):null;
  if(!m||Number(m[1])>65535||!SHA.test(expectedMainSha??"")||
     typeof readToken!=="string"||readToken.trim().length<16)
    reject("disposable loopback Gitea read token and independent SHA required");
  return {baseUrl,readToken,expectedMainSha};
}
export async function runF1RealGiteaGeminiResearch({
  flag,baseUrl,readToken,expectedMainSha,apiKey,
  modelName,outputDir,consent,githubActions=process.env.GITHUB_ACTIONS,
  ciPermit=false,fetchFn=fetch
}={}){
  if(flag!=="--dry-run"&&flag!=="--execute")
    reject("explicit --dry-run or --execute required");
  if(flag==="--execute"&&
     !isApprovedF1OneTimeCI({githubActions,ciPermit}))
    reject("no unapproved Gemini inference inside GitHub Actions");
  const host=hostPins({baseUrl,readToken,expectedMainSha});
  if(flag==="--execute")
    assertF1RealGeminiOperatorConsent({
      flag,consent,apiKey,modelName,outputDir,githubActions,ciPermit
    });
  // A REAL repository read and discovery, even on --dry-run, never writes.
  const binding=await buildF1RealGiteaResearchPlanningPort({
    ...host,sessionId:"f1_gitea_"+expectedMainSha.slice(0,16),fetchFn
  });
  const meta={
    schema:"f1-direct-gitea-gemini-research-v1",
    source_revision:expectedMainSha,
    repository:"thesis/iam-console-poc",scenario:"department-directory",
    source_kind:"real_disposable_gitea",
    trusted_gateway_vp_opa_planning:false,
    local_gitea_read_only:true,
    files_available:binding.snapshot.files.length,
    directories_available:binding.snapshot.directories.length,
    billable_model_inference:false,
    genuine_human_approval:false,
    execution_permitted:false,
    private_r5_go:false
  };
  if(flag==="--dry-run")
    return Object.freeze({status:"f1_ready_without_inference",...meta});
  await privateDir(outputDir);
  const events=[];
  let status="failed_closed";
  try{
    const {TrustedAdkReadOnlyPlanner}=await import(
      "../packages/orchestrator-runtime/src/trusted-adk-planner.ts");
    const {createGeminiAdkModel}=await import(
      "../packages/agent-runtime/src/gemini-adk-model.ts");
    const model=createGeminiAdkModel({apiKey,model:modelName});
    const planner=new TrustedAdkReadOnlyPlanner({
      model,snapshot:binding.snapshot,
      requirement:"Enable an administrator to search the IAM user directory by department (case-insensitive), with an authenticated API, accessible frontend and meaningful tests. Preserve existing account suspension/reactivation semantics.",
      planId:"f1_real_gitea_department_directory",
      workBranch:"feature/experiment-department-directory",
      agents:{
        backend:{did:"did:example:research-backend",card_ref:"research:backend"},
        frontend:{did:"did:example:research-frontend",card_ref:"research:frontend"},
        test:{did:"did:example:research-test",card_ref:"research:test"}
      },
      readPort:binding.readPort,
      onObservation:e=>{events.push(e);},
      // Bounded first live research probe. These are request ceilings,
      // NOT a money-denominated cost guarantee.
      maxModelTurns:12,maxModelCallMs:90000,
      maxPlanningMs:360000,maxOutputTokens:8192,
      thinkingLevel:"MEDIUM"
    });
    const proposal=await planner.propose();
    const report=evaluatePlannerFeasibility({
      scenario:"department-directory",
      expectedBaseRevision:expectedMainSha,proposal,observations:events,
      trustedSnapshot:binding.snapshot
    });
    const functional=assessF1DepartmentDirectoryPlan({
      proposal,expectedBaseRevision:expectedMainSha
    });
    // The generated plan is saved for ENGINEER review ONLY. Never sign,
    // issue child credentials, merge, or execute in this probe.
    await persist(outputDir,"unapproved-proposal.json",proposal);
    await persist(outputDir,"observations.json",events);
    await persist(outputDir,"evaluation.json",report);
    await persist(outputDir,"functional-review.json",functional);
    status="unapproved_proposal_observed";
    return Object.freeze({status,technical_preflight_pass:
      report.technical_preflight_pass,
      functional_design_plausible:functional.functional_design_plausible,
      functional_review_failed_checks:Object.freeze([...functional.failed_checks]),
      functional_review_required:true,
      source_revision:expectedMainSha,
      execution_permitted:false,
      reported_provider_cost:"not_measured"});
  }catch(error){
    const diagnostics=classifyPlannerProbeFailure(error);
    await persist(outputDir,"failure-diagnostics.json",diagnostics);
    throw Error("F1 real Gemini probe did not produce an authorized plan");
  }finally{
    await persist(outputDir,"research-run.json",{
      ...meta,status,
      provider_model_name:modelName,
      billable_model_inference:true,
      model_calls_maximum:12,
      token_output_limit_per_call:8192,
      provider_cost:"not_measured",
      human_review_required:true,
      source_file_contents_not_in_summary:true,
      private_r5_go:false
    });
  }
}
async function main(){
  const flag=process.argv[2];
  if(process.argv.length!==3||
     !["--dry-run","--execute"].includes(flag))
    reject("usage: --dry-run or --execute");
  const result=await runF1RealGiteaGeminiResearch({
    flag,baseUrl:process.env.DELEGATION_F1_GITEA_URL,
    readToken:process.env.DELEGATION_F1_GITEA_READ_TOKEN,
    expectedMainSha:process.env.DELEGATION_F1_EXPECTED_SOURCE_SHA,
    apiKey:process.env.GEMINI_API_KEY,
    modelName:process.env.DELEGATION_F1_GEMINI_MODEL,
    outputDir:process.env.DELEGATION_F1_OUTPUT_DIR,
    consent:process.env.DELEGATION_F1_BILLING_CONSENT
  });
  process.stdout.write(JSON.stringify(result)+"\n");
}
if(process.argv[1]&&import.meta.url===
  pathToFileURL(resolve(process.argv[1])).href){
  main().catch(()=>{
    // Never log Gitea credentials, Gemini API key, source, model output,
    // raw provider error or private artifact directory.
    process.stderr.write("F1 real Gemini Planning preflight/probe NO-GO\n");
    process.exitCode=1;
  });
}
