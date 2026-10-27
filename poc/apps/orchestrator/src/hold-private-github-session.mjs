#!/usr/bin/env node
/**
 * Operator-installed, NON-BILLABLE self-hosted GitHub Actions worker.
 * Submit one authenticated OIDC job, then KEEP THIS SAME JOB alive
 * through the private mTLS read-only rendezvous. Neither this process
 * nor the status endpoint can approve a plan, invoke ADK, issue a DC,
 * execute a DAG, or obtain the Gemini API key.
 *
 * Deployment must separately PIN this workflow path and exact source SHA
 * both on the isolated runner and on the trusted Engineer host. No repo
 * checkout, workflow-input secrets, public reverse proxy or model call.
 */
import {loadProtectedRunnerOidcConfig,submitProtectedPrivateRunnerAdmission}
  from "./trusted-private-runner-oidc.mjs";
import {awaitTrustedPrivateRunCompletion}
  from "../../../packages/orchestrator-runtime/src/trusted-github-oidc-submit.ts";
import {verifyProtectedScriptedInstallation}
  from "../../../scripts/r5-scripted-install-integrity.mjs";

try{
  // Both paid and scripted runners verify the exact locally installed
  // root-owned, non-runner-writable source SHA INSIDE the OIDC process.
  // A previous check or a GitHub-approved dispatch is not sufficient.
  const trusted=await loadProtectedRunnerOidcConfig(
    process.env.DELEGATION_RUNNER_OIDC_CONFIG);
  await verifyProtectedScriptedInstallation({
    expectedSourceSha:trusted.expectedSourceSha
  });
  const admitted=await submitProtectedPrivateRunnerAdmission();
  if(trusted.expectedSourceSha!==admitted.source_sha||
     trusted.expectedRepository!==process.env.GITHUB_REPOSITORY||
     trusted.expectedRef!==process.env.GITHUB_REF||
     process.env.GITHUB_WORKFLOW_REF!==
       trusted.expectedRepository+"/"+trusted.expectedWorkflowPath+
       "@"+trusted.expectedRef)
    throw Error("Runner pins drifted between admission and hold");
  const closed=await awaitTrustedPrivateRunCompletion({
    intakeUrl:trusted.intakeUrl,tls:trusted.tls,
    runId:admitted.run_id,sourceSha:admitted.source_sha,
    maxWaitMs:60*60*1000,pollEveryMs:5000
  });
  process.stdout.write(JSON.stringify(closed)+"\n");
}catch{
  // An interrupted/ambiguous host close cannot become GitHub Success.
  // Never print OIDC JWTs, keys, bearer values, host endpoints or plan data.
  process.stderr.write("Trusted private runner did not verify complete closed DAG\n");
  process.exitCode=1;
}
