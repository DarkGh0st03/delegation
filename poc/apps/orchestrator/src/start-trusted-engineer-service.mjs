#!/usr/bin/env node
/**
 * Operator-owned service entrypoint; run under a supervised service user,
 * not a GitHub Actions job. It never receives an API/model key.
 */
import {startConfiguredTrustedEngineerService}
  from "./trusted-engineer-service.mjs";

let closing=false,host;
async function close(){
  if(closing)return;
  closing=true;
  try{await host?.close();}
  catch{process.exitCode=1;}
}
try{
  const path=process.env.DELEGATION_ENGINEER_SERVICE_CONFIG;
  if(typeof path!=="string"||!path.trim())
    throw Error("Private service config path required");
  host=await startConfiguredTrustedEngineerService(path);
  process.once("SIGINT",()=>{void close();});
  process.once("SIGTERM",()=>{void close();});
  // Only a readiness marker is logged, never mTLS keys, bearer, JWT,
  // approved plan, Engineer DID or private endpoint.
  process.stdout.write("Trusted Engineer service ready; Gemini disabled\n");
}catch{
  process.stderr.write("Trusted Engineer service startup denied\n");
  process.exitCode=1;
}
