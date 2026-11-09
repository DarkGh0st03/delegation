#!/usr/bin/env node
/**
 * R463 read-only ORIGINAL paid-Gemini Engineer Host pre-deployment preflight.
 * No listeners, model construction, credentials, OIDC, approval, Root, Task,
 * Gateway I/O, GitHub dispatch or merge. A passing local config is NOT R5 GO.
 *
 * The strict original service loader checks protected 0700 directories,
 * 0600 files, no symlinks and absence of a preexisting signed plan.
 * This additional gate checks the PAID identity, source pins and mTLS.
 */
import {X509Certificate,createPrivateKey,createPublicKey} from "node:crypto";
import {isIP} from "node:net";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const PAID=".github/workflows/trusted-gemini-private-session-hold.yml";
const SCRIPTED=".github/workflows/trusted-scripted-offline-session-hold.yml";
const SUBJECT="repo:DarkGh0st03@150908952/delegation@1374168963:ref:"+REF;
const SHA=/^[a-f0-9]{40}$/u;
const FP=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u;
function deny(){throw Error("R463 paid private Engineer Host NO-GO");}
function ipv4(addr){
 if(isIP(addr)!==4)return false;
 const [a,b]=addr.split(".").map(Number);
 return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
function fixedPort(p){return Number.isSafeInteger(p)&&p>0&&p<=65535;}
function verifyHostTls(tls,hostIp,nowMs){
 if(!tls||!FP.test(tls.expectedClientFingerprint256??""))deny();
 let ca,leaf,key;
 try{
  ca=new X509Certificate(tls.ca);
  leaf=new X509Certificate(tls.cert);
  key=createPrivateKey(tls.key);
 }catch{deny();}
 if(!ca.ca||leaf.ca||!leaf.checkIssued(ca)||
    !leaf.verify(ca.publicKey)||!leaf.checkIP(hostIp))deny();
 for(const cert of [ca,leaf]){
  const from=Date.parse(cert.validFrom),until=Date.parse(cert.validTo);
  if(!Number.isFinite(from)||!Number.isFinite(until)||
     nowMs<from||nowMs>=until)deny();
 }
 try{
  const signer=createPublicKey(key).export({format:"der",type:"spki"});
  const subject=leaf.publicKey.export({format:"der",type:"spki"});
  if(!signer.equals(subject))deny();
 }catch{deny();}
}
/**
 * Pure validation of ALREADY locally authenticated service config.
 * Never return source TLS keys, API bearer values or signing identities.
 */
export function verifyR463PaidEngineerHostReadiness(config,{
 expectedSourceSha,nowMs=Date.now()
}={}){
 if(!SHA.test(expectedSourceSha??"")||
    !Number.isSafeInteger(nowMs)||nowMs<0)deny();
 const paid=config?.oidc,offline=config?.scriptedOidc;
 if(!paid?.pinned||paid.pinned.repository!==REPO||
    paid.pinned.ref!==REF||paid.pinned.workflowPath!==PAID||
    paid.pinned.sourceSha!==expectedSourceSha)deny();
 const trust=paid.trust;
 if(!trust||trust.expectedSubject!==SUBJECT||
    String(trust.expectedOwnerId)!=="150908952"||
    String(trust.expectedRepositoryId)!=="1374168963"||
    typeof trust.expectedAudience!=="string"||
    trust.expectedAudience.length<16)deny();
 const bind=paid.bindAddress??"127.0.0.1";
 if(!(ipv4(bind)||bind==="127.0.0.1")||
    !fixedPort(config.approvalPort)||!fixedPort(config.oidcPort)||
    config.approvalPort===config.oidcPort||
    (offline&&(!fixedPort(config.scriptedOidcPort)||
      new Set([config.approvalPort,config.oidcPort,
        config.scriptedOidcPort]).size!==3)))deny();
 if(offline&&(
    offline.pinned?.sourceSha!==expectedSourceSha||
    offline.pinned.repository!==REPO||offline.pinned.ref!==REF||
    offline.pinned.workflowPath!==SCRIPTED||
    offline.trust?.expectedAudience===trust.expectedAudience||
    offline.tls?.expectedClientFingerprint256===
      paid.tls?.expectedClientFingerprint256))deny();
 // A protected original Rust issue/revoke socket, not legacy HTTP Adapter.
 if(typeof config.recovery?.nativeEngineerSocketPath!=="string"||
    !config.recovery.nativeEngineerSocketPath.startsWith("/")||
    typeof config.recovery.gatewaySocketPath!=="string"||
    !config.recovery.gatewaySocketPath.startsWith("/")||
    config.planningMode!=="original")deny();
 verifyHostTls(paid.tls,bind,nowMs);
 return Object.freeze({
  status:"paid_engineer_host_config_verified_not_deployed",
  source_sha:expectedSourceSha,
  original_planning_mode:true,private_runner_connected:false,
  oidc_job_seen:false,engineer_signature_seen:false,
  signed_root_issued:false,model_api_calls:0,r5_go:false
 });
}
/** A fresh-owner dry run. Never use the cold recovery mode here. */
export async function verifyProtectedR463PaidHostConfig({
 configPath,expectedSourceSha
}={}){
 if(process.env.GITHUB_ACTIONS==="true")deny();
 const {loadTrustedEngineerServiceConfig}=await import(
  "../apps/orchestrator/src/trusted-engineer-service.mjs");
 const config=await loadTrustedEngineerServiceConfig(configPath,{
  pendingPlanningOutput:true
 });
 return verifyR463PaidEngineerHostReadiness(config,{expectedSourceSha});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const proof=await verifyProtectedR463PaidHostConfig({
   configPath:process.env.DELEGATION_ENGINEER_SERVICE_CONFIG,
   expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA
  });
  process.stdout.write("R463 paid Engineer Host local config checked at "+
   proof.source_sha+"; deployment, signed approval and R5 GO NOT proven\n");
 }catch{
  process.stderr.write("R463 paid Engineer Host preflight NO-GO\n");
  process.exitCode=1;
 }
}
