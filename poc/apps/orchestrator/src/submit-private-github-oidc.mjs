#!/usr/bin/env node
// Manual, non-billable private-runner admission. Never handles Gemini keys.
import {submitProtectedPrivateRunnerAdmission}
  from "./trusted-private-runner-oidc.mjs";
try{
  const result=await submitProtectedPrivateRunnerAdmission();
  process.stdout.write(JSON.stringify(result)+"\n");
}catch{
  // Do not print bearer, OIDC JWT, filesystem secrets or host fingerprint.
  process.stderr.write("Trusted private runner OIDC admission denied\n");
  process.exitCode=1;
}
