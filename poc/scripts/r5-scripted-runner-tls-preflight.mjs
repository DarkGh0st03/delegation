/**
 * R5 ZERO-MODEL protected runner mTLS readiness. Read-only: does not
 * connect to the Engineer Host, request OIDC, approve Planning or issue
 * delegated authority. The trusted host leaf fingerprint remains unproven
 * until the real mutually authenticated TLS handshake.
 */
import {X509Certificate,createPrivateKey,createPublicKey} from "node:crypto";
import {isIP} from "node:net";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {loadProtectedScriptedRunnerOidcConfig}
  from "../apps/orchestrator/src/trusted-private-scripted-runner-oidc.mjs";

const REPO="DarkGh0st03/delegation";
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WORKFLOW=".github/workflows/trusted-scripted-offline-session-hold.yml";
const ADMISSION_PATH="/v1/trusted/github/scripted-offline-oidc-admission";
const SHA=/^[a-f0-9]{40}$/u;
const FP=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u;
const CLIENT_AUTH="1.3.6.1.5.5.7.3.2";
function deny(reason){throw Error("R5 private runner TLS NO-GO: "+reason);}
function privateIpv4(value){
  if(isIP(value)!==4)return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||
    (a===192&&b===168);
}
function validAt(cert,now){
  const a=Date.parse(cert.validFrom),b=Date.parse(cert.validTo);
  return Number.isFinite(a)&&Number.isFinite(b)&&now>=a&&now<b;
}

/** The caller must already have loaded private, owner-validated 0600 files. */
export function verifyR5ScriptedRunnerTlsReadiness(pins,{
  expectedSourceSha,nowMs=Date.now()
}={}){
  if(!SHA.test(expectedSourceSha??"")||
     !Number.isSafeInteger(nowMs)||nowMs<0)
    deny("trusted source pin and current timestamp required");
  if(!pins||pins.expectedSourceSha!==expectedSourceSha||
     pins.expectedRepository!==REPO||pins.expectedRef!==REF||
     pins.expectedWorkflowPath!==WORKFLOW||
     typeof pins.audience!=="string"||pins.audience.length<16)
    deny("private scripted OIDC identity pins disagree");
  let url;
  try{url=new URL(pins.intakeUrl);}catch{deny("invalid pinned Engineer endpoint");}
  if(url.protocol!=="https:"||!privateIpv4(url.hostname)||
     !url.port||url.pathname!==ADMISSION_PATH||
     url.username||url.password||url.search||url.hash)
    deny("pinned mTLS endpoint must be private IPv4 with fixed port");
  const tls=pins.tls;
  if(!tls||!FP.test(tls.expectedServerFingerprint256??""))
    deny("independently trusted Engineer server fingerprint required");
  let ca,leaf,privateKey;
  try{
    ca=new X509Certificate(tls.ca);
    leaf=new X509Certificate(tls.cert);
    privateKey=createPrivateKey(tls.key);
  }catch{deny("invalid protected runner certificate or private key");}
  if(!ca.ca||leaf.ca||!leaf.checkIssued(ca)||
     !leaf.verify(ca.publicKey))
    deny("runner leaf must be directly signed by pinned client CA");
  if(!validAt(ca,nowMs)||!validAt(leaf,nowMs))
    deny("runner mTLS certificate is not currently valid");
  if(!Array.isArray(leaf.keyUsage)||!leaf.keyUsage.includes(CLIENT_AUTH))
    deny("runner certificate lacks clientAuth extended key usage");
  try{
    const fromKey=createPublicKey(privateKey).export({
      format:"der",type:"spki"
    });
    const fromCert=leaf.publicKey.export({
      format:"der",type:"spki"
    });
    if(!fromKey.equals(fromCert))
      deny("runner certificate and protected private key mismatch");
  }catch(error){
    if(error?.message?.startsWith("R5 private runner TLS NO-GO:"))
      throw error;
    deny("unusable protected runner signing key");
  }
  if(leaf.fingerprint256===tls.expectedServerFingerprint256)
    deny("server and runner leaf certificates must be distinct");
  return Object.freeze({
    status:"runner_tls_config_verified_only_not_connected",
    source_sha:expectedSourceSha,model_api_calls:0,
    server_handshake_proven:false,engineer_approval_proven:false
  });
}

export async function verifyProtectedR5ScriptedRunnerTls({
  configPath,expectedSourceSha
}={}){
  const pins=await loadProtectedScriptedRunnerOidcConfig(configPath);
  return verifyR5ScriptedRunnerTlsReadiness(pins,{expectedSourceSha});
}

if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  try{
    const r=await verifyProtectedR5ScriptedRunnerTls({
      configPath:process.env.DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG,
      expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA
    });
    process.stdout.write("R5 runner TLS preflight verified at "+
      r.source_sha+"; handshake and E2E NOT established\n");
  }catch{
    // No certificate, private key, host address or bearer in logs.
    process.stderr.write("R5 scripted runner TLS configuration NO-GO\n");
    process.exitCode=1;
  }
}
