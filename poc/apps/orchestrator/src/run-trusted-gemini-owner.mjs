/**
 * PRIVILEGED OWNER PROCESS ONLY: one-shot real Gemini read-only Planning
 * through the ORIGINAL Gitea-pinned Gateway/Adapter/Engineer Coordinator.
 * Requires human API billing consent provided separately at invocation,
 * protected 0600 files and an exact protected GitHub OIDC source SHA.
 *
 * This is NOT an Actions job, public HTTP endpoint, A2A/MCP tool, Engineer
 * auto-approval, operational root issuance or approved DAG execution.
 * Importing this module NEVER invokes a model, provider or DC issuer.
 */
import {constants} from "node:fs";
import {execFileSync} from "node:child_process";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,normalize,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {prepareConfiguredOwnerEngineerBootstrap}
  from "./trusted-engineer-service.mjs";
import {bindProtectedGeminiApprovedExecution}
  from "./trusted-gemini-execution-binding.mjs";
import {assertR5AuthenticSignedReviewReady}
  from "./trusted-r5-scripted-review-readiness.mjs";
import {
  MAX_PRELIMINARY_ROOT_SECONDS,DEFAULT_PLANNER_SESSION_MS,
  DEFAULT_ENGINEER_REVIEW_MS,TRUSTED_PLANNING_HANDOFF_MARGIN_MS
} from "../../../packages/plan-contracts/src/planning-limits.mjs";

const SOURCE_SHA=/^[a-f0-9]{40}$/u;
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
function checkLocalSourceSha(expected){
  try{
    const head=execFileSync("git",["rev-parse","--verify","HEAD"],{
      cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
      stdio:["ignore","pipe","ignore"]
    }).trim();
    const dirty=execFileSync("git",["status","--porcelain","--untracked-files=all"],{
      cwd:SOURCE_ROOT,encoding:"utf8",timeout:3000,
      stdio:["ignore","pipe","ignore"]
    }).trim();
    if(head!==expected||dirty)deny();
  }catch{deny();}
}
const CONFIRMATION="I AUTHORIZE GEMINI API CHARGES";
const FIELDS=["profile","snapshot","preliminaryRoot","requirement",
  "planId","agents","gatewayBaseUrl","backendPrivateKeyFile",
  "geminiApiKeyFile","modelName"];
function deny(){throw Error("Protected Gemini owner input denied");}
function record(x){return !!x&&typeof x==="object"&&!Array.isArray(x);}
function exact(x,fields){
  return record(x)&&Object.keys(x).length===fields.length&&
    Object.keys(x).every(k=>fields.includes(k));
}
async function privateFile(path,maxBytes=32768){
  if(typeof path!=="string"||!isAbsolute(path)||
     normalize(path)!==path||resolve(path)!==path)deny();
  try{
    const parent=await lstat(dirname(path));
    if(!parent.isDirectory()||parent.isSymbolicLink()||
       (parent.mode&0o077)!==0||
       (process.getuid?.()!==undefined&&parent.uid!==process.getuid()))
      deny();
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const meta=await file.stat();
      if(!meta.isFile()||(meta.mode&0o077)!==0||
         (process.getuid?.()!==undefined&&meta.uid!==process.getuid())||
         meta.size<1||meta.size>maxBytes)deny();
      return await file.readFile("utf8");
    }finally{await file.close();}
  }catch{deny();}
}
/** No billing confirmation may come from the owner JSON file itself.
 * The exact confirmation is supplied by the operator at invocation. */
export async function loadProtectedGeminiOwnerInput(inputFile,{chargeAuthorization}={}){
  if(chargeAuthorization!==CONFIRMATION)deny();
  let input;
  try{input=JSON.parse(await privateFile(inputFile));}catch{deny();}
  if(!exact(input,FIELDS)||input.profile!=="gemini_planning"||
     input.modelName!=="gemini-3.8-flash"||
     !exact(input.snapshot,["session_id","repository","base_revision","directories","files"])||
     !exact(input.preliminaryRoot,["credential_id","valid_from",
       "validity_seconds","credential_status"])||
     !exact(input.agents,["backend","frontend","test"])||
     !Array.isArray(input.snapshot.directories)||
     !Array.isArray(input.snapshot.files)||
     typeof input.requirement!=="string"||!input.requirement.trim()||
     typeof input.planId!=="string"||!input.planId.trim()||
     typeof input.gatewayBaseUrl!=="string"||
     input.backendPrivateKeyFile===input.geminiApiKeyFile||
     input.backendPrivateKeyFile===inputFile||
     input.geminiApiKeyFile===inputFile)deny();
  const root=input.preliminaryRoot;
  const notBefore=Date.parse(root.valid_from);
  const age=Date.now()-notBefore;
  const minimum=DEFAULT_PLANNER_SESSION_MS+
    DEFAULT_ENGINEER_REVIEW_MS+TRUSTED_PLANNING_HANDOFF_MARGIN_MS;
  if(!Number.isSafeInteger(root.validity_seconds)||
     root.validity_seconds<1||
     root.validity_seconds>MAX_PRELIMINARY_ROOT_SECONDS||
     !Number.isFinite(notBefore)||age< -60_000||
     root.validity_seconds*1000-Math.max(0,age)<minimum)deny();
  const backendPrivateKeyPem=await privateFile(input.backendPrivateKeyFile,8192);
  const geminiApiKey=(await privateFile(input.geminiApiKeyFile,8192)).trim();
  if(!backendPrivateKeyPem.includes("BEGIN PRIVATE KEY")||
     geminiApiKey.length<8||/\s/u.test(geminiApiKey))deny();
  const {profile,backendPrivateKeyFile,geminiApiKeyFile,...planning}=input;
  return Object.freeze({...planning,backendPrivateKeyPem,
    geminiApiKey,authorizationInput:CONFIRMATION});
}

/** OPERATOR-ONLY, potentially billable at the explicit start() call.
 * Requires a separately owned private Engineer Host, never hosted Actions.
 * This method neither approves a plan nor authorizes Execution.
 */
export async function startProtectedGeminiOwnerSession({
  configPath,expectedSourceSha,inputFile,chargeAuthorization
}={}){
  if(process.env.GITHUB_ACTIONS==="true"||
     !SOURCE_SHA.test(expectedSourceSha??"")||
     chargeAuthorization!==CONFIRMATION)deny();
  // Exact locally deployed GitHub source MUST agree with the protected
  // OIDC pin; a user-entered SHA alone is not authoritative.
  checkLocalSourceSha(expectedSourceSha);
  const prepared=await prepareConfiguredOwnerEngineerBootstrap(configPath,{
    expectedLiveSourceSha:expectedSourceSha
  });
  const params=await loadProtectedGeminiOwnerInput(inputFile,{
    chargeAuthorization
  });
  const assembly=await prepared.assembleGeminiPlanning(params);
  // ONLY this owner action can invoke Gemini; no inference during assembly.
  const host=await prepared.start(assembly.planning);
  let shutdown,closed=false,dispatchAttempted=false;
  // The owner retains identity-bound Coordinator and private API credentials
  // in closure, NEVER in public server routes, A2A, MCP or JSON.
  const signedReviewReady=()=>assertR5AuthenticSignedReviewReady({
    coordinator:assembly.coordinator,
    reviewGate:assembly.planning.reviewGate,
    checkpointStore:assembly.planning.checkpointStore,
    expectedSessionId:assembly.planning.snapshot.session_id,
    expectedBaseRevision:assembly.planning.snapshot.base_revision
  });
  return Object.freeze({
    engineerUrl:host.engineerUrl,
    oidcAdmissionEndpoint:host.oidcAdmissionEndpoint,
    status:"real_gemini_planning_staged_for_human_review_not_authorized_execution",
    get coordinatorPhase(){return assembly.coordinator.phase;},
    /** Read-only precheck; does NOT consume GitHub admission or mint a root. */
    async reviewReadiness(){
      if(closed||dispatchAttempted||
         assembly.coordinator.phase!=="planning")
        throw Error("Gemini owner signed review unavailable");
      return signedReviewReady();
    },
    /** OWNER-ONLY after genuine Engineer Ed25519 approval AND OIDC admission.
     * No caller can inject a Coordinator, review gate, provider key, Gateway
     * bearer, Engineer DID, source SHA, DAG callback or additional authority.
     * Signed permission subsets and exact roles are rechecked by the host.
     */
    runApprovedGeminiDag(input){
      if(closed||dispatchAttempted||
         assembly.coordinator.phase!=="planning")
        throw Error("Gemini owner DAG already attempted or Planning inactive");
      const bound=bindProtectedGeminiApprovedExecution(
        assembly.planning,input);
      dispatchAttempted=true; // one-use BEFORE asynchronous consent/admission
      return (async()=>{
        await signedReviewReady();
        if(closed||assembly.coordinator.phase!=="planning")
          throw Error("Gemini owner signed review changed before admission");
        return host.runReviewedApprovedDagWithGateway({
          ...bound,coordinator:assembly.coordinator,
          reviewGate:assembly.planning.reviewGate,
          checkpointStore:assembly.planning.checkpointStore,
          geminiApiKey:params.geminiApiKey,
          transports:bound.transports
        });
      })();
    },
    close(){
      if(shutdown)return shutdown;
      closed=true;
      shutdown=host.close();
      return shutdown;
    }
  });
}

if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  let active,startPromise,stopPromise,interrupted=false;
  async function stop(){
    if(stopPromise)return stopPromise;
    stopPromise=(async()=>{
      interrupted=true;
      try{await startPromise;}catch{}
      if(active)await active.close();
    })();
    return stopPromise;
  }
  for(const signal of ["SIGINT","SIGTERM"]){
    process.on(signal,()=>{
      void stop().then(()=>{process.exitCode=0;},()=>{
        process.stderr.write(
          "Gemini Owner credential retirement unconfirmed; manual reconciliation required\n");
        process.exitCode=1;
      });
    });
  }
  startPromise=startProtectedGeminiOwnerSession({
    configPath:process.env.DELEGATION_ENGINEER_SERVICE_CONFIG,
    expectedSourceSha:process.env.DELEGATION_GEMINI_EXPECTED_SOURCE_SHA,
    inputFile:process.env.DELEGATION_GEMINI_OWNER_INPUT_FILE,
    chargeAuthorization:process.env.DELEGATION_GEMINI_CHARGE_CONFIRMATION
  });
  try{
    active=await startPromise;
    if(interrupted)await stop();
    else process.stdout.write(
      "Gemini Planning completed: awaiting REAL Engineer review at "+
      active.engineerUrl+"; no operational DC or Execution admitted\n");
  }catch{
    process.stderr.write(
      "Gemini owner startup denied; reconcile Gateway/Adapter state before retry\n");
    process.exitCode=1;
  }
}
