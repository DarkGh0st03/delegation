/**
 * R5 read-only OWNER preflight for one actual scripted_offline Engineer Host.
 * Uses the existing strictly protected service-file loader. It starts NO
 * Planning, listeners, OIDC, Gateway operations, credentials or models.
 * Passing is configuration readiness ONLY, never a distributed R5 E2E.
 */
import {X509Certificate,createPrivateKey,createPublicKey} from "node:crypto";
import {isIP} from "node:net";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {loadTrustedEngineerServiceConfig}
  from "../apps/orchestrator/src/trusted-engineer-service.mjs";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const SCRIPTED=".github/workflows/trusted-scripted-offline-session-hold.yml";
const SUBJECT="repo:DarkGh0st03@150908952/delegation@1374168963:ref:"+REF;
const SHA=/^[a-f0-9]{40}$/u;
const FP=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u;
function deny(reason){
  throw Error("R5 scripted host deployment NO-GO: "+reason);
}
function privateIp(value){
  if(typeof value!=="string"||isIP(value)!==4)return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||
    (a===192&&b===168);
}
function validPort(p){return Number.isSafeInteger(p)&&p>0&&p<=65535;}
function verifyScriptedTls({tls,bindAddress,nowMs}){
  if(!tls||!FP.test(tls.expectedClientFingerprint256??""))
    deny("independent runner leaf pin is required");
  let leaf,ca,privateKey;
  try{
    leaf=new X509Certificate(tls.cert);
    ca=new X509Certificate(tls.ca);
    privateKey=createPrivateKey(tls.key);
  }catch{deny("invalid protected mTLS certificate or private key");}
  if(!ca.ca||leaf.ca||!leaf.checkIssued(ca)||
     !leaf.verify(ca.publicKey))
    deny("server certificate must be issued by the pinned direct CA");
  const dates=[leaf,ca].map(c=>[
    Date.parse(c.validFrom),Date.parse(c.validTo)
  ]);
  if(dates.some(([start,end])=>
    !Number.isFinite(start)||!Number.isFinite(end)||
    nowMs<start||nowMs>=end))
    deny("scripted mTLS certificate is not currently valid");
  if(!leaf.checkIP(bindAddress))
    deny("server certificate is not valid for pinned private IPv4");
  try{
    const keyPublic=createPublicKey(privateKey).export({
      type:"spki",format:"der"
    });
    const certPublic=leaf.publicKey.export({
      type:"spki",format:"der"
    });
    if(!keyPublic.equals(certPublic))
      deny("server certificate and protected private key mismatch");
  }catch(error){
    if(error?.message?.startsWith("R5 scripted host deployment NO-GO:"))
      throw error;
    deny("unusable scripted server TLS signing key");
  }
}
/** A pure, no-network assertion over the already owner-verified config. */
export function verifyR5ScriptedEngineerHostReadiness(config,{
  expectedSourceSha,nowMs=Date.now()
}={}){
  if(!SHA.test(expectedSourceSha??""))
    deny("independent exact source SHA pin missing");
  if(!Number.isSafeInteger(nowMs)||nowMs<0)
    deny("trusted preflight date missing");
  const paid=config?.oidc,offline=config?.scriptedOidc;
  const p=offline?.pinned;
  if(!p||p.repository!==REPO||p.ref!==REF||
     p.workflowPath!==SCRIPTED||p.sourceSha!==expectedSourceSha)
    deny("scripted workflow/repository/ref/source pins disagree");
  if(paid?.pinned?.sourceSha!==expectedSourceSha||
     paid.pinned.repository!==REPO||paid.pinned.ref!==REF)
    deny("separate paid and scripted source identity mismatch");
  if(!offline.trust||offline.trust.expectedSubject!==SUBJECT||
     String(offline.trust.expectedRepositoryId)!=="1374168963"||
     String(offline.trust.expectedOwnerId)!=="150908952"||
     typeof offline.trust.expectedAudience!=="string"||
     offline.trust.expectedAudience.length<16||
     offline.trust.expectedAudience===paid.trust?.expectedAudience)
    deny("scripted OIDC trust is missing or overlaps paid identity");
  if(!privateIp(offline.bindAddress)||
     paid.bindAddress!==undefined&&paid.bindAddress!=="127.0.0.1"||
     !validPort(config.scriptedOidcPort)||
     !validPort(config.oidcPort)||
     !validPort(config.approvalPort)||
     new Set([config.scriptedOidcPort,config.oidcPort,
       config.approvalPort]).size!==3)
    deny("R5 needs distinct fixed listener ports and private scripted bind");
  if(!FP.test(paid.tls?.expectedClientFingerprint256??"")||
     offline.tls?.expectedClientFingerprint256===
       paid.tls.expectedClientFingerprint256)
    deny("paid and scripted client certificate pins must be distinct");
  verifyScriptedTls({
    tls:offline.tls,bindAddress:offline.bindAddress,nowMs
  });
  return Object.freeze({
    status:"scripted_host_config_verified_only_not_deployed",
    source_sha:expectedSourceSha,model_api_calls:0,
    active_planning_proven:false,private_runner_connected:false
  });
}

/** Reads private 0600 service config; no ports, tokens or models opened. */
export async function verifyProtectedR5EngineerHostConfig({
  configPath,expectedSourceSha
}={}){
  // This preflight is expressly PRE-Planning. The review plan MUST NOT
  // exist yet: the original Coordinator and backend signer will produce
  // that file exclusively after the read-only Planning checkpoint.
  // Cold-recovery uses the default loader mode, which instead REQUIRES
  // an already signed plan. Never conflate the two stages.
  const config=await loadTrustedEngineerServiceConfig(configPath,{
    pendingPlanningOutput:true
  });
  return verifyR5ScriptedEngineerHostReadiness(config,{expectedSourceSha});
}

if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  try{
    const r=await verifyProtectedR5EngineerHostConfig({
      configPath:process.env.DELEGATION_ENGINEER_SERVICE_CONFIG,
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA
    });
    process.stdout.write("R5 owner config preflight verified at "+
      r.source_sha+"; no E2E or authority established\n");
  }catch{
    // Never echo keys, service config or private IPs in operator logs.
    process.stderr.write("R5 scripted Engineer Host configuration NO-GO\n");
    process.exitCode=1;
  }
}
