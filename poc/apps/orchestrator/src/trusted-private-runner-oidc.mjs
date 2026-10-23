/**
 * NON-BILLABLE, trusted self-hosted GitHub runner -> private Engineer OIDC.
 *
 * All trust pins and mutual-TLS material are provisioned out of band on the
 * isolated runner in owner-only local files, NOT GitHub Actions inputs,
 * artifacts or repository secrets. Never expose this to arbitrary PR code.
 * An authenticated GitHub run is NOT an Engineer approval or Gemini consent.
 */
import {open,lstat,readFile} from "node:fs/promises";
import {constants} from "node:fs";
import {dirname,isAbsolute} from "node:path";
import {isIP} from "node:net";
import {submitTrustedGithubOidcFromRunner}
  from "../../../packages/orchestrator-runtime/src/trusted-github-oidc-submit.ts";

const CONFIG_KEYS=[
  "expectedRepository","expectedRef","expectedWorkflowPath",
  "expectedSourceSha","intakeUrl","audience",
  "expectedServerFingerprint256","caFile","clientCertFile","clientKeyFile"
];
const ENV_KEYS=[
  "GITHUB_ACTIONS","GITHUB_EVENT_NAME","GITHUB_RUN_ATTEMPT",
  "GITHUB_REPOSITORY","GITHUB_REF","GITHUB_WORKFLOW_REF",
  "GITHUB_SHA","GITHUB_RUN_ID"
];
const SHA=/^[a-f0-9]{40}$/u;
const FINGERPRINT=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const REF=/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const WORKFLOW=/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u;
const RUN=/^[1-9]\d{0,19}$/u;
function reject(){
  throw Error("Trusted private runner OIDC admission denied");
}
function privateIpv4(address){
  if(isIP(address)!==4)return false;
  const [first,second]=address.split(".").map(Number);
  return first===10||first===172&&second>=16&&second<=31||
    first===192&&second===168;
}
async function protectedFile(path,maxBytes){
  if(typeof path!=="string"||!isAbsolute(path)||path.includes("\0"))
    reject();
  const parent=await lstat(dirname(path));
  if(!parent.isDirectory()||parent.isSymbolicLink()||
     (parent.mode&0o077)!==0||
     (typeof process.getuid==="function"&&parent.uid!==process.getuid()))
    reject();
  // O_NOFOLLOW prevents replacing the last component with a symlink.
  // Stat the open inode rather than checking a possibly changed pathname.
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const st=await handle.stat();
    if(!st.isFile()||(st.mode&0o077)!==0||
       (typeof process.getuid==="function"&&st.uid!==process.getuid())||
       st.size<1||st.size>maxBytes)reject();
    return await handle.readFile({encoding:"utf8"});
  }finally{await handle.close();}
}
function privateSettings(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).length!==CONFIG_KEYS.length||
     CONFIG_KEYS.some(k=>typeof raw[k]!=="string"||!raw[k].trim())||
     !REPO.test(raw.expectedRepository)||!REF.test(raw.expectedRef)||
     !WORKFLOW.test(raw.expectedWorkflowPath)||
     !SHA.test(raw.expectedSourceSha)||
     !FINGERPRINT.test(raw.expectedServerFingerprint256)||
     raw.audience.length<16||raw.audience.length>512)
    reject();
  let url;
  try{url=new URL(raw.intakeUrl);}catch{reject();}
  if(url.protocol!=="https:"||!privateIpv4(url.hostname)||
     url.pathname!=="/v1/trusted/github/oidc-admission"||
     url.username||url.password||url.search||url.hash)
    reject();
  return raw;
}
export async function loadProtectedRunnerOidcConfig(configPath){
  const config=privateSettings(JSON.parse(
    await protectedFile(configPath,8192)));
  const [ca,cert,key]=await Promise.all([
    protectedFile(config.caFile,128*1024),
    protectedFile(config.clientCertFile,128*1024),
    protectedFile(config.clientKeyFile,128*1024)
  ]);
  return Object.freeze({
    expectedRepository:config.expectedRepository,
    expectedRef:config.expectedRef,
    expectedWorkflowPath:config.expectedWorkflowPath,
    expectedSourceSha:config.expectedSourceSha,
    intakeUrl:config.intakeUrl,
    audience:config.audience,
    tls:Object.freeze({ca,cert,key,
      expectedServerFingerprint256:config.expectedServerFingerprint256})
  });
}
export async function submitProtectedPrivateRunnerAdmission({
  environment,submit=submitTrustedGithubOidcFromRunner
}={}){
  const env=environment??process.env;
  if(!env||typeof env!=="object"||
     typeof env.DELEGATION_RUNNER_OIDC_CONFIG!=="string"||
     typeof env.GITHUB_EVENT_PATH!=="string"||
     typeof env.ACTIONS_ID_TOKEN_REQUEST_URL!=="string"||
     typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN!=="string"||
     !RUN.test(env.GITHUB_RUN_ID??"")||
     ENV_KEYS.some(k=>typeof env[k]!=="string")||
     env.GITHUB_ACTIONS!=="true"||
     env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
     env.GITHUB_RUN_ATTEMPT!=="1")
    reject();
  const trusted=await loadProtectedRunnerOidcConfig(
    env.DELEGATION_RUNNER_OIDC_CONFIG);
  if(env.GITHUB_REPOSITORY!==trusted.expectedRepository||
     env.GITHUB_REF!==trusted.expectedRef||
     env.GITHUB_SHA!==trusted.expectedSourceSha||
     env.GITHUB_WORKFLOW_REF!==trusted.expectedRepository+"/"+
       trusted.expectedWorkflowPath+"@"+trusted.expectedRef)
    reject();
  const eventPath=env.GITHUB_EVENT_PATH;
  if(!isAbsolute(eventPath))reject();
  const metadata=await lstat(eventPath);
  if(!metadata.isFile()||metadata.isSymbolicLink()||
     metadata.size<1||metadata.size>65536)reject();
  const event=JSON.parse(await readFile(eventPath,"utf8"));
  const reported=await submit({
    tokenRequestUrl:env.ACTIONS_ID_TOKEN_REQUEST_URL,
    tokenRequestBearer:env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    audience:trusted.audience,intakeUrl:trusted.intakeUrl,
    tls:trusted.tls,
    env:Object.fromEntries(ENV_KEYS.map(k=>[k,env[k]])),
    event
  });
  if(reported?.status!=="authenticated_only_not_engineer_approved"||
     reported.run_id!==env.GITHUB_RUN_ID||
     reported.source_sha!==env.GITHUB_SHA)reject();
  // Never return the JWT, private-key bytes, bearer or Engineer approval.
  return Object.freeze({
    status:"authenticated_only_not_engineer_approved",
    run_id:reported.run_id,
    source_sha:reported.source_sha,
    engineer_approval:"not_checked",
    operational_credential:"not_issued",
    gemini_calls:0
  });
}
