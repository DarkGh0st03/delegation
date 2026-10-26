/**
 * Owner-only R5 Planning entrypoint. No paid provider, automatic Engineer
 * approval, GitHub dispatch or A2A execution. An input from GitHub is denied.
 */
import {constants} from "node:fs";
import {open,lstat} from "node:fs/promises";
import {dirname,isAbsolute,normalize,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {prepareConfiguredR5ScriptedEngineerBootstrap}
  from "./trusted-engineer-service.mjs";
import {bindProtectedR5ScriptedExecution}
  from "./trusted-r5-scripted-execution-binding.mjs";
import {assertR5AuthenticSignedReviewReady}
  from "./trusted-r5-scripted-review-readiness.mjs";
import {assertR5EvidenceDirectory,verifyR5PostRunEvidence,
  persistR5PostRunEvidence}
  from "./trusted-r5-scripted-completion-evidence.mjs";

const SHA=/^[a-f0-9]{40}$/u;
function deny(){throw Error("R5 protected live owner input denied");}
function record(x){return !!x&&typeof x==="object"&&!Array.isArray(x);}
function exact(x,fields){
  return record(x)&&Object.keys(x).length===fields.length&&
    Object.keys(x).every(k=>fields.includes(k));
}
/** Read a bounded owner-only plain file. No symlink or group access. */
async function ownerText(path,maxBytes=32768){
  if(typeof path!=="string"||!isAbsolute(path)||
     normalize(path)!==path||resolve(path)!==path)
    deny();
  try{
    const directory=await lstat(dirname(path));
    if(!directory.isDirectory()||directory.isSymbolicLink()||
       (directory.mode&0o077)!==0||
       (process.getuid?.()!==undefined&&
        directory.uid!==process.getuid()))
      deny();
    const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const meta=await f.stat();
      if(!meta.isFile()||(meta.mode&0o077)!==0||
         (process.getuid?.()!==undefined&&
          meta.uid!==process.getuid())||
         meta.size===0||meta.size>maxBytes)
        deny();
      return await f.readFile("utf8");
    }finally{await f.close();}
  }catch{deny();}
}
const OWNER_FIELDS=["profile","snapshot","preliminaryRoot","edits",
  "newTestFile","requirement","planId","agents","gatewayBaseUrl",
  "backendPrivateKeyFile"];
/**
 * Strict owner file; the Backend Ed25519 private key is in its own 0600
 * file and is never included in JSON, model prompts or routine log output.
 */
export async function loadProtectedR5ScriptedOwnerInput(inputFile){
  let input;
  try{input=JSON.parse(await ownerText(inputFile));}catch{deny();}
  if(!exact(input,OWNER_FIELDS)||
     input.profile!=="scripted_offline"||
     !exact(input.snapshot,["session_id","repository",
       "base_revision","directories","files"])||
     !exact(input.preliminaryRoot,["credential_id","valid_from",
       "validity_seconds","credential_status"])||
     !exact(input.edits,["backend","frontend"])||
     !exact(input.agents,["backend","frontend","test"])||
     !Array.isArray(input.snapshot.directories)||
     !Array.isArray(input.snapshot.files)||
     !Array.isArray(input.edits.backend)||
     !Array.isArray(input.edits.frontend)||
     typeof input.newTestFile!=="string"||
     typeof input.requirement!=="string"||
     typeof input.planId!=="string"||
     typeof input.gatewayBaseUrl!=="string"||
     input.backendPrivateKeyFile===inputFile)
    deny();
  const signer=await ownerText(input.backendPrivateKeyFile,8192);
  if(!signer.includes("BEGIN PRIVATE KEY"))deny();
  const {profile,backendPrivateKeyFile,...params}=input;
  return Object.freeze({...params,backendPrivateKeyPem:signer});
}

/**
 * Once the original Coordinator starts, failed attempts require durable
 * Gateway and native Adapter reconciliation; never simply retry the root.
 */
export async function startProtectedR5ScriptedOwnerSession({
  configPath,expectedSourceSha,inputFile,evidenceDirectory
}={}){
  // Never start an Engineer signer, Coordinator or privileged listener
  // from a hosted/runner workflow; this is the separately owned host only.
  if(process.env.GITHUB_ACTIONS==="true"||
     !SHA.test(expectedSourceSha??""))deny();
  const prepared=await prepareConfiguredR5ScriptedEngineerBootstrap(
    configPath,{expectedSourceSha});
  const params=await loadProtectedR5ScriptedOwnerInput(inputFile);
  const assembly=await prepared.assemblePlanning(params);
  const host=await prepared.start(assembly.planning);
  let dispatchAttempted=false,dispatchPreparing=false,closed=false;
  let dispatchPromise,shutdownPromise;
  const shutdownAbort=new AbortController();
  // Verification reads the original Backend-signed checkpoint AND human
  // Ed25519 receipt. It is not itself operational authorization.
  const signedReviewReady=()=>assertR5AuthenticSignedReviewReady({
    coordinator:assembly.coordinator,
    reviewGate:assembly.planning.reviewGate,
    checkpointStore:assembly.planning.checkpointStore,
    expectedSessionId:assembly.planning.snapshot.session_id,
    expectedBaseRevision:assembly.planning.snapshot.base_revision
  });
  // Deliberately do NOT expose the raw Host/Coordinator to external
  // consumers: arbitrary callbacks must not bypass approved DAG binding.
  return Object.freeze({
    engineerUrl:host.engineerUrl,
    scriptedOidcAdmissionEndpoint:host.scriptedOidcAdmissionEndpoint,
    status:"live_original_planning_for_human_review_not_r5_go",
    get coordinatorPhase(){return assembly.coordinator.phase;},
    /**
     * OWNER PROCESS ONLY. Never wired to Engineer HTTP, A2A, MCP, ADK,
     * Actions inputs or the JWT endpoint. The host independently checks
     * an authenticated manual runner, real Ed25519 human signature,
     * approved DAG, root issuance and complete authority retirement.
     */
    /**
     * Owner-side PRE-ADMISSION readiness. A Backend checkpoint is not
     * consent: independently verify the exact authentic human signature.
     * This does not request OIDC or issue any operational root.
     */
    async reviewReadiness(){
      if(closed||dispatchPreparing||dispatchAttempted||
         assembly.coordinator.phase!=="planning")
        throw Error("R5 owner signed review unavailable");
      return signedReviewReady();
    },
    /**
     * Must not consume a ONE-USE GitHub HMAC receipt before the genuine
     * human-signed plan exists. Concurrent attempts are not permitted.
     */
    async runApprovedScriptedDag(input){
      if(closed||dispatchPreparing||dispatchAttempted||
         assembly.coordinator.phase!=="planning")
        throw Error("R5 owner scripted DAG already attempted or inactive");
      const bound=bindProtectedR5ScriptedExecution(
        assembly.planning,input);
      dispatchPreparing=true; // serialize across all awaits
      const execution=(async()=>{
        const review=await signedReviewReady();
        // R5 verified-complete evidence MUST have a protected durable
        // destination BEFORE consuming a one-shot GitHub receipt.
        await assertR5EvidenceDirectory(evidenceDirectory);
        const staged=assembly.planning.reviewGate.reviewPacket();
        const taskIds=staged.plan.tasks.map(task=>task.id);
        if(closed||assembly.coordinator.phase!=="planning")
          throw Error("R5 owner Planning closed during signature verification");
        dispatchAttempted=true; // reserve BEFORE consuming GitHub admission
        const completed=await host.runReviewedScriptedApprovedDagWithGateway(bound);
        if(closed||shutdownAbort.signal.aborted)
          throw Error("R5 owner shutdown requested during approved DAG");
        // This occurs only when the original host returned after the
        // approved DAG and its native root/Gateway close() succeeded.
        const witness=await verifyR5PostRunEvidence({
          runId:bound.runId,sourceSha:expectedSourceSha,
          sessionId:assembly.planning.snapshot.session_id,
          review,approvedTaskIds:taskIds,dagResult:completed,
          coordinator:assembly.coordinator
        });
        if(closed||shutdownAbort.signal.aborted)
          throw Error("R5 owner shutdown requested before receipt publication");
        const receipt=await persistR5PostRunEvidence(
          evidenceDirectory,witness,{signal:shutdownAbort.signal});
        if(closed||shutdownAbort.signal.aborted)
          throw Error("R5 owner shutdown raced completion publication");
        return Object.freeze({
          ...completed,owner_completion_evidence:witness,
          owner_completion_receipt:receipt
        });
      })();
      // Retain this promise until completion/rejection, so shutdown never
      // abandons a pending DAG or evidence writer.
      dispatchPromise=execution;
      try{
        return await execution;
      }finally{
        dispatchPreparing=false;
        if(dispatchPromise===execution)dispatchPromise=undefined;
      }
    },
    close(){
      if(shutdownPromise)return shutdownPromise;
      closed=true; // deny new dispatch BEFORE any async cleanup
      shutdownAbort.abort(); // cancel any pending proof publication
      shutdownPromise=(async()=>{
        let failure;
        // A running DAG must be told to retire its native authority NOW;
        // waiting for its completion before host.close could deadlock.
        try{await host.close();}catch(error){failure=error;}
        // Then wait for any in-flight dispatch/evidence writer to unwind.
        if(dispatchPromise){
          try{await dispatchPromise;}catch{/* original error is private */}
        }
        if(failure)throw failure;
      })();
      return shutdownPromise;
    }
  });
}

/** Standalone foreground process, only when explicitly invoked by owner. */
if(process.argv[1]&&import.meta.url===
    pathToFileURL(resolve(process.argv[1])).href){
  let active,startPromise,shutdownPromise,interrupted=false;
  async function stop(){
    if(shutdownPromise)return shutdownPromise;
    shutdownPromise=(async()=>{
      interrupted=true;
      try{await startPromise;}catch{}
      if(active)await active.close();
    })();
    return shutdownPromise;
  }
  for(const signal of ["SIGINT","SIGTERM"]){
    process.on(signal,()=>{
      void stop().then(()=>{process.exitCode=0;},()=>{
        process.stderr.write(
          "R5 owner shutdown/credential retirement unconfirmed; manual reconciliation required\n");
        process.exitCode=1;
      });
    });
  }
  startPromise=startProtectedR5ScriptedOwnerSession({
    configPath:process.env.DELEGATION_ENGINEER_SERVICE_CONFIG,
    expectedSourceSha:process.env.DELEGATION_R5_EXPECTED_SOURCE_SHA,
    inputFile:process.env.DELEGATION_R5_OWNER_INPUT_FILE,
    evidenceDirectory:process.env.DELEGATION_R5_EVIDENCE_DIRECTORY
  });
  try{
    active=await startPromise;
    if(interrupted)await stop();
    else process.stdout.write(
      "R5 original Planning staged for genuine Engineer review at "+
      active.engineerUrl+"; no GitHub OIDC, approved DAG or R5 GO established\n");
  }catch{
    process.stderr.write(
      "R5 owner startup denied; reconcile durable Gateway/Adapter before retry\n");
    process.exitCode=1;
  }
}
