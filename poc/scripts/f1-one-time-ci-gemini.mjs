#!/usr/bin/env node
/**
 * Single authorized real Gemini F1 Planning attempt on original disposable
 * Gitea, using the already existing GitHub Actions secret.
 *
 * Intended to run once, only on the owner branch, never a reusable paid CI.
 * No automatic Engineer signing, delegated execution, file edits or PR merge.
 */
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {isApprovedF1OneTimeCI}
  from "./f1-real-gitea-gemini-probe.mjs";
import {runF1OwnerGiteaSession}
  from "./f1-local-gitea-session.mjs";
import {CONSENT} from "./run-gemini-planner-fixture.mjs";

function deny(){throw Error("F1 one-time authorized Gemini CI NO-GO");}
export async function runF1OneTimePaidCI({
  env=process.env,executeOwner=runF1OwnerGiteaSession
}={}){
  // Verify GitHub-provided origin and reject all workflow reruns before a
  // Gemini key or Gitea token is read.
  if(!isApprovedF1OneTimeCI({
    githubActions:env.GITHUB_ACTIONS,ciPermit:true,runnerEnv:env
  })||env.GITHUB_ACTIONS!=="true"||
     env.DELEGATION_F1_BILLING_CONSENT!==CONSENT||
     typeof env.GEMINI_API_KEY!=="string"||
     env.GEMINI_API_KEY.trim().length<10||
     env.DELEGATION_F1_GEMINI_MODEL!=="gemini-3.8-flash"||
     typeof env.F1_SESSION!=="string"||
     !/^\/tmp\/delegation-f1-paid-[1-9][0-9]{0,19}$/u.test(env.F1_SESSION)||
     env.DELEGATION_F1_OUTPUT_DIR!==env.F1_SESSION+"-report"||
     typeof executeOwner!=="function")deny();

  const result=await executeOwner({
    mode:"--execute",sessionDirectory:env.F1_SESSION,
    apiKey:env.GEMINI_API_KEY,modelName:env.DELEGATION_F1_GEMINI_MODEL,
    outputDir:env.DELEGATION_F1_OUTPUT_DIR,
    consent:env.DELEGATION_F1_BILLING_CONSENT,
    githubActions:env.GITHUB_ACTIONS,ciPermit:true
  });
  // Source text, owner Gitea token, private API key and raw model output
  // never enter GitHub's public log. Full unsigned plan is an artifact.
  return Object.freeze({
    status:result.status,
    technical_preflight_pass:result.technical_preflight_pass??false,
    functional_design_plausible:result.functional_design_plausible??false,
    functional_review_failed_checks:
      result.functional_review_failed_checks??[],
    approved_or_executed:false,
    source_revision:result.source_revision,
    provider_cost:"not_measured"
  });
}
if(process.argv[1]&&import.meta.url===
   pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==2){
    process.stderr.write("F1 one-time authorized Gemini CI NO-GO\n");
    process.exitCode=1;
  }else{
    runF1OneTimePaidCI().then(summary=>{
      process.stdout.write("F1 real Gemini proposal observation: "+
        JSON.stringify(summary)+"\n");
    }).catch(()=>{
      process.stderr.write("F1 one-time authorized Gemini CI NO-GO\n");
      process.exitCode=1;
    });
  }
}
