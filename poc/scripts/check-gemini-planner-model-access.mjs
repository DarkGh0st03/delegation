#!/usr/bin/env node
/**
 * Manual, NON-GENERATIVE Gemini Developer API access check.
 * GET model metadata only; NEVER call :generateContent or log API keys,
 * provider response body, complete request objects or source files.
 */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {SIGNED_GEMINI_PILOT} from "./signed-gemini-pilot-consent.mjs";

export const MODEL_ID="gemini-3.8-flash";
const REQUIRED_OUTPUT_TOKENS=Math.max(SIGNED_GEMINI_PILOT.maxOutputTokensPerCall,
  ...Object.values(SIGNED_GEMINI_PILOT.maxOutputTokensPerRole));
const METADATA_URL="https://generativelanguage.googleapis.com/v1beta/models/"+MODEL_ID;
export async function checkModelMetadataAccess({apiKey,request=fetch}){
  if(typeof apiKey!=="string"||!apiKey.trim())
    throw Error("Gemini API Secret unavailable; no remote request made");
  let status=null,network_error=false,outputTokenLimit=null;
  try{
    const response=await request(METADATA_URL,{
      method:"GET",
      headers:{"x-goog-api-key":apiKey,"accept":"application/json"},
      signal:AbortSignal.timeout(20000),
      redirect:"error",
      cache:"no-store"
    });
    // Only read successful model metadata and retain its bounded numeric
    // output capacity. Never return provider JSON, error bodies or secrets.
    status=Number.isInteger(response?.status)?response.status:null;
    if(status===200){
      try{
        const metadata=await response.json();
        const n=metadata?.outputTokenLimit;
        if(Number.isSafeInteger(n)&&n>0&&n<=1000000)
          outputTokenLimit=n;
      }catch{
        // Malformed/absent metadata fails closed; no inference fallback.
      }
    }
  }catch{
    network_error=true;
  }
  const result=status===200
    ?outputTokenLimit===null?"model_output_limit_unverified"
      :outputTokenLimit<REQUIRED_OUTPUT_TOKENS
        ?"model_output_limit_insufficient":"model_metadata_accessible":
    status===401?"authentication_failure":
    status===403?"permission_or_billing_failure":
    status===404?"model_not_found_or_not_accessible":
    status===429?"quota_or_rate_limit":
    typeof status==="number"&&status>=500?"provider_server_error":
    network_error?"network_or_timeout":"unexpected_http_response";
  return Object.freeze({
    schema_version:"1.0.0",
    model:MODEL_ID,
    operation:"GET model metadata (non-generative)",
    http_status:status,
    result,
    required_output_tokens_per_call:REQUIRED_OUTPUT_TOKENS,
    provider_output_token_limit:outputTokenLimit,
    output_capacity_verified:status===200&&outputTokenLimit!==null&&
      outputTokenLimit>=REQUIRED_OUTPUT_TOKENS,
    content_generation_requests:0,
    token_usage:"not_applicable",
    provider_invoice:"not_measured",
    model_generation_permission:"not_proven_by_metadata_only"
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==3||process.argv[2]!=="--check-model-access")
    throw Error("usage: --check-model-access (no inference)");
  const check=await checkModelMetadataAccess({apiKey:process.env.GEMINI_API_KEY});
  process.stdout.write(JSON.stringify(check,null,2)+"\n");
  if(check.result!=="model_metadata_accessible")process.exitCode=1;
}
