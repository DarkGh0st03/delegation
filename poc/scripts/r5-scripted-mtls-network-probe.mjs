/**
 * R5 no-charge transport smoke: a REAL read-only mutually authenticated TLS
 * request to the protected, private Engineer Host status listener. This sends
 * neither GitHub OIDC, Engineer approval, model input nor DC credentials.
 * A successful 404 denial of an intentionally INVALID run ID proves ONLY
 * that this runner reached a pinned TLS host through the guarded endpoint.
 */
import {request as httpsRequest} from "node:https";
import {checkServerIdentity} from "node:tls";
import {timingSafeEqual} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {loadProtectedScriptedRunnerOidcConfig}
  from "../apps/orchestrator/src/trusted-private-scripted-runner-oidc.mjs";
import {verifyR5ScriptedRunnerTlsReadiness}
  from "./r5-scripted-runner-tls-preflight.mjs";

const STATUS="/v1/trusted/github/scripted-offline-admission-status";
const BASE="/v1/trusted/github/scripted-offline-oidc-admission";
const FP=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u;
const SHA=/^[a-f0-9]{40}$/u;
function deny(){
  throw Error("R5 private scripted mTLS network probe NO-GO");
}
/** Does not load source data, does not authorize a runner run. */
export async function probeR5PrivateScriptedMtlsReadOnly({
  intakeUrl,tls,expectedSourceSha,timeoutMs=7000
}={}){
  if(!SHA.test(expectedSourceSha??"")||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>12000||
     !tls||!FP.test(tls.expectedServerFingerprint256??"")||
     ["ca","cert","key"].some(k=>typeof tls[k]!=="string"||
       !tls[k].length||tls[k].length>131072))
    deny();
  let url;
  try{url=new URL(intakeUrl);}catch{deny();}
  if(url.protocol!=="https:"||url.pathname!==BASE||
     url.search||url.hash||url.username||url.password||!url.port)
    deny();
  url.pathname=STATUS;
  // run_id 0 is intentionally invalid. The host MUST deny before
  // consulting any admission receipt or granting any root capability.
  url.searchParams.set("run_id","0");
  url.searchParams.set("source_sha",expectedSourceSha);
  return await new Promise((resolve,reject)=>{
    let finished=false;
    function rejected(){
      if(finished)return;
      finished=true;
      reject(Error("R5 private scripted mTLS network probe NO-GO"));
    }
    const req=httpsRequest(url,{
      agent:false,method:"GET",
      ca:tls.ca,cert:tls.cert,key:tls.key,
      rejectUnauthorized:true,minVersion:"TLSv1.2",
      timeout:timeoutMs,
      headers:{accept:"application/json"},
      checkServerIdentity:(host,cert)=>{
        const err=checkServerIdentity(host,cert);
        if(err)return err;
        if(typeof cert.fingerprint256!=="string"||
           !FP.test(cert.fingerprint256)||
           !timingSafeEqual(
             Buffer.from(cert.fingerprint256.replaceAll(":",""),"hex"),
             Buffer.from(tls.expectedServerFingerprint256.replaceAll(":",""),"hex")
           ))return Error("R5 pinned host leaf mismatch");
        return undefined;
      }
    },res=>{
      let response="",bytes=0;
      res.on("data",chunk=>{
        bytes+=chunk.length;
        if(bytes>512){req.destroy();rejected();return;}
        response+=chunk.toString("utf8");
      });
      res.on("end",()=>{
        if(finished)return;
        try{
          const body=JSON.parse(response);
          if(res.statusCode!==404||
             body?.status!=="denied"||
             Object.keys(body).length!==1)rejected();
          else{
            finished=true;
            resolve(Object.freeze({
              status:"private_mtls_negative_status_probe_only",
              source_sha:expectedSourceSha,
              real_mtls_http_denial_observed:true,
              oidc_authenticated:false,
              signed_engineer_approval:false,
              approved_dag_complete:false,
              delegated_root_retired:false
            }));
          }
        }catch{rejected();}
      });
      res.on("error",rejected);
    });
    req.on("timeout",()=>{req.destroy();rejected();});
    req.on("error",rejected);
    req.end();
  });
}

/** Owner-installed runner CLI only: source pins come from its locked config. */
export async function probeProtectedR5ScriptedMtlsNetwork({
  configPath,expectedSourceSha
}={}){
  const pins=await loadProtectedScriptedRunnerOidcConfig(configPath);
  verifyR5ScriptedRunnerTlsReadiness(pins,{expectedSourceSha});
  return probeR5PrivateScriptedMtlsReadOnly({
    intakeUrl:pins.intakeUrl,tls:pins.tls,expectedSourceSha
  });
}
if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  try{
    const r=await probeProtectedR5ScriptedMtlsNetwork({
      configPath:process.env.DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG,
      expectedSourceSha:process.env.GITHUB_ACTIONS==="true"
        ?process.env.GITHUB_SHA
        :process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA
    });
    process.stdout.write("R5 pinned mTLS negative probe verified at "+
      r.source_sha+"; real signed DAG and root retirement NOT established\n");
  }catch{
    process.stderr.write("R5 private scripted mTLS network probe NO-GO\n");
    process.exitCode=1;
  }
}
