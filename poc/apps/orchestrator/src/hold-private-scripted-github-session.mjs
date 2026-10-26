#!/usr/bin/env node
/**
 * Operator-installed no-cost scripted GitHub runner hold.
 * Does NOT load model credentials or run paid workflows. The same
 * GitHub job stays in_progress until the host independently confirms
 * signed DAG completion and Rust/Gateway root revocation over pinned mTLS.
 */
import {loadProtectedScriptedRunnerOidcConfig,submitProtectedPrivateScriptedRunnerAdmission}
  from "./trusted-private-scripted-runner-oidc.mjs";
import {verifyProtectedScriptedInstallation}
  from "../../../scripts/r5-scripted-install-integrity.mjs";
import {verifyR5ScriptedRunnerTlsReadiness}
  from "../../../scripts/r5-scripted-runner-tls-preflight.mjs";
import {awaitTrustedScriptedPrivateRunCompletion}
  from "../../../packages/orchestrator-runtime/src/trusted-scripted-github-oidc-submit.ts";

try{
  // Re-check within THIS process, not just an earlier workflow step:
  // a direct invocation of the hold must not bypass installation proof.
  const trusted=await loadProtectedScriptedRunnerOidcConfig(
    process.env.DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG);
  await verifyProtectedScriptedInstallation({
    expectedSourceSha:trusted.expectedSourceSha
  });
  verifyR5ScriptedRunnerTlsReadiness(trusted,{
    expectedSourceSha:trusted.expectedSourceSha
  });
  const admitted=await submitProtectedPrivateScriptedRunnerAdmission();
  if(trusted.expectedSourceSha!==admitted.source_sha||
     trusted.expectedRepository!==process.env.GITHUB_REPOSITORY||
     trusted.expectedRef!==process.env.GITHUB_REF||
     process.env.GITHUB_WORKFLOW_REF!==
       trusted.expectedRepository+"/"+trusted.expectedWorkflowPath+
       "@"+trusted.expectedRef)
    throw Error("Runner pins drifted between admission and hold");
  const closed=await awaitTrustedScriptedPrivateRunCompletion({
    intakeUrl:trusted.intakeUrl,tls:trusted.tls,
    runId:admitted.run_id,sourceSha:admitted.source_sha,
    maxWaitMs:60*60*1000,pollEveryMs:5000
  });
  process.stdout.write(JSON.stringify(closed)+"\n");
}catch{
  // An interrupted/ambiguous host close cannot become GitHub Success.
  // Never print OIDC JWTs, keys, bearer values, host endpoints or plan data.
  process.stderr.write("Trusted scripted private runner did not verify complete closed DAG\n");
  process.exitCode=1;
}
