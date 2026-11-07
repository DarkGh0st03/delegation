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
import {createGeminiAdkModel}
  from "../../../packages/agent-runtime/src/gemini-adk-model.ts";
import {bindProtectedCanonicalGeminiOwner}
  from "./trusted-authority-only-gemini-owner-binding.mjs";
import {createProtectedGeminiOwnerDispatch}
  from "./trusted-gemini-owner-dispatch.mjs";
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
  // R382.6: never start the obsolete Signed DAG Coordinator when the
  // original authority-only architecture is selected. No automatic
  // conversion, provider billing or permission downgrade is possible.
  // Legacy Planning is available ONLY by explicitly selecting its
  // historical architecture. Unset/unknown mode is not an implicit
  // fallback and cannot silently incur Gemini API charges.
  if(process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="legacy-signed-dag")deny();
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
  const dispatch=createProtectedGeminiOwnerDispatch({
    assembly,host,geminiApiKey:params.geminiApiKey,
    verifySignedReview:()=>assertR5AuthenticSignedReviewReady({
      coordinator:assembly.coordinator,
      reviewGate:assembly.planning.reviewGate,
      checkpointStore:assembly.planning.checkpointStore,
      expectedSessionId:assembly.planning.snapshot.session_id,
      expectedBaseRevision:assembly.planning.snapshot.base_revision
    })
  });
  return Object.freeze({
    engineerUrl:host.engineerUrl,
    oidcAdmissionEndpoint:host.oidcAdmissionEndpoint,
    status:"real_gemini_planning_staged_for_human_review_not_authorized_execution",
    get coordinatorPhase(){return assembly.coordinator.phase;},
    reviewReadiness:dispatch.reviewReadiness,
    runApprovedGeminiDag:dispatch.runApprovedGeminiDag,
    close:dispatch.close
  });
}

/**
 * R382.6 — explicit, potentially BILLABLE owner-only Gemini Planning
 * entrypoint using the ORIGINAL authority-only Review Host.
 *
 * The privileged operator must separately pass: (1) a clean GitHub SHA
 * pinned to the checked-out source, (2) the unchanged 0600 JSON/key
 * files and the exact billing consent, (3) original in-process Review
 * Host stores/native Rust ports, and (4) private operational provision
 * callback. No CLI/env/HTTP/ADK/A2A/MCP data may construct authority.
 *
 * Planning starts inside startTrustedAuthorityOnlyReviewHost() only
 * AFTER all non-billable preconditions pass. The returned methods never
 * bypass the ORIGINAL Ed25519 Engineer review; the owner chooses when
 * to invoke one-shot runApprovedCanonical(). No paid model used until
 * an operator calls this function with explicit confirmation.
 */
export async function startProtectedCanonicalGeminiOwnerSession({
 authority,expectedSourceSha,inputFile,chargeAuthorization,provision
}={}){
 if(process.env.GITHUB_ACTIONS==="true"||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    !SOURCE_SHA.test(expectedSourceSha??"")||
    chargeAuthorization!==CONFIRMATION||
    typeof provision!=="function"||
    !authority||typeof authority!=="object"||Array.isArray(authority))
  deny();
 // This source pin must be verified BEFORE reading model keys or
 // constructing the potentially billable ADK Planner.
 checkLocalSourceSha(expectedSourceSha);
 const input=await loadProtectedGeminiOwnerInput(inputFile,{
  chargeAuthorization
 });
 const model=createGeminiAdkModel({
  apiKey:input.geminiApiKey,model:input.modelName
 }); // constructor only; no provider request at assembly
 const options=bindProtectedCanonicalGeminiOwner({
  authority,input,model
 });
 const {startTrustedAuthorityOnlyReviewHost}=await import(
  "./trusted-authority-only-review-host.mjs");
 const host=await startTrustedAuthorityOnlyReviewHost(options);
 try{
  const handoff=host.createReviewedCanonicalHandoff({provision});
  return Object.freeze({
   engineerUrl:host.engineerUrl,
   status:"canonical_gemini_planning_awaiting_independent_engineer_review",
   get phase(){return host.phase;},
   reviewReadiness:()=>handoff.reviewReadiness(),
   runApprovedCanonical:()=>handoff.runApprovedCanonical(),
   close:()=>handoff.close()
  });
 }catch(error){
  // A failed post-Planning bind must retire the original preliminary
  // Root; never return a loose listener or a legacy Executor.
  try{await host.close();}catch{
   deny(); // retirement unconfirmed: never report a successful bind
  }
  throw error;
 }
}

/**
 * R382.7 — executable trusted owner *API* with all concrete Review Host
 * classes loaded from 0600, source-pinned metadata and the sole Rust Core.
 * The operator supplies approved paths, billing consent and trusted
 * operational capabilities. An explicit private provision is also accepted. No JSON may supply a callable tool, Root port, or
 * approved Task permission. This is still not a GitHub Actions or HTTP
 * endpoint and no inferencing occurs unless the operator invokes it.
 */
export async function startProtectedCanonicalGeminiOwnerFromPrivateConfig({
 configPath,expectedSourceSha,inputFile,chargeAuthorization,provision,operational
}={}){
 if(process.env.GITHUB_ACTIONS==="true"||
    process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    process.env.ENGINEER_CORE_NATIVE_MODE!=="1"||
    !SOURCE_SHA.test(expectedSourceSha??"")||
    chargeAuthorization!==CONFIRMATION||
    (operational===undefined?typeof provision!=="function":provision!==undefined))
  deny();
 // Check clean checkout and the expected SHA BEFORE owner manifest,
 // native Rust transport, Gateway IPC or any potentially billable model.
 checkLocalSourceSha(expectedSourceSha);
 const {loadProtectedCanonicalOwnerManifest,
  assembleProtectedCanonicalOwnerAuthority,
  createProtectedCanonicalOperationalProvision}=await import(
  "./trusted-authority-only-owner-bootstrap.mjs");
 const loaded=await loadProtectedCanonicalOwnerManifest(configPath,{
  expectedSourceSha
 });
 const authority=await assembleProtectedCanonicalOwnerAuthority(loaded);
 const prepare=operational===undefined?provision:
  await createProtectedCanonicalOperationalProvision(authority,operational);
 // The second check in the existing API and its independent owner-JSON
 // source/Root/roles binding remain mandatory. No Signed DAG fallback.
 return startProtectedCanonicalGeminiOwnerSession({
  authority,expectedSourceSha,inputFile,chargeAuthorization,provision:prepare
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
