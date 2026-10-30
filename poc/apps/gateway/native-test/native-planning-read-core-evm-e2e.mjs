/**
 * Native, offline pre-approval Planning integration. This runs only after
 * Anvil, EVM trust, the actual Rust Adapter and native Core addon are online.
 *
 * REAL: Rust-issued EVM-root DC, signed JWT VP, independent Core Rust verifier,
 * live OPA policy, Planning revision registry, Google ADK/A2A-independent
 * read-only Planner, and on-chain root revocation.
 * FIXTURE mode: pinned Gitea read snapshot.
 * DISPOSABLE mode: real read-only Gitea from existing isolated Docker test.
 * Both use a controlled ADK model and embedded Gateway HTTP transport.
 * No external LLM, user approval, writes to main or persistent Gitea.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt,generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {canonicalFileUri} from "../src/canonical.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedPlanningReviewGate} from
  "../../../packages/orchestrator-runtime/src/trusted-planning-review-gate.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {TrustedOperationalSessionStore} from "../src/trusted-operational-session-store.ts";
import {TrustedGatewaySignedEpochInspector} from "../src/trusted-gateway-signed-epoch-inspector.ts";
import {TrustedGatewayNativeRootStatusReader} from "../src/trusted-gateway-native-root-status.ts";
import {TrustedGatewayRootVpVerifier} from "../src/trusted-root-vp-verification.ts";
import {createTrustedPlanIpcServer,TrustedPlanIpcClient} from "../src/trusted-plan-ipc.ts";
import {armTrustedOwnerOperationalRecovery} from
  "../../../packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts";
import {dispatchTrustedAdmittedRepairA2A,
  confirmTrustedAdmittedRepairA2A} from
  "../../../packages/orchestrator-runtime/src/trusted-admitted-repair-a2a.ts";
import {TrustedChildIssuanceJournal} from
  "../../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {TrustedRetiredRepairAcceptanceWitness} from
  "../../../packages/orchestrator-runtime/src/trusted-retired-repair-acceptance.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {GatewayCorroboratedTaskAttestor} from
  "../src/trusted-task-observation.ts";
import {runNativePositiveApprovedDag} from "./native-approved-planner-dag-positive.mjs";
import {preflightApprovedPilotDag} from "./approved-dag-preflight.mjs";
import {OfflineApprovedAdkModel} from "./offline-approved-adk-model.mjs";
import {SourceWitnessedOfflineAdkModel}
  from "./source-witnessed-offline-adk-model.mjs";
import {SourceDerivedRouteOfflineAdkModel}
  from "./source-derived-route-offline-adk-model.mjs";
import {selectSourceDerivedTargetsFromApprovedPlan}
  from "./approved-plan-source-target-selection.mjs";
import {buildOfflineAdkScriptsFromApprovedPlan}
  from "./approved-plan-offline-adk-call-scripts.mjs";
import {getApprovedOfflineScenario} from
  "../../test-runner-controller/fixtures/approved-scenarios.mjs";
import {makeOfflineReviewableDag} from
  "../../../packages/orchestrator-runtime/test/fixtures/offline-planning-dag.mjs";
import {BaseLlm} from "@google/adk";
import {SIGNED_GEMINI_PILOT,verifySignedGeminiPilotConsent}
  from "../../../scripts/signed-gemini-pilot-consent.mjs";
import {createGeminiAdkModel} from "../../../packages/agent-runtime/src/gemini-adk-model.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {GiteaReadOnlyExecutor} from "../src/gitea-read-executor.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {TrustedPlanningRevisions} from "../src/planning-revisions.ts";
import {InMemoryAuditSink} from "../src/prepare.ts";
import {SoftwareEngineerAuthorityBootstrap} from
  "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {TrustedEngineerAuthoritySession} from
  "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from
  "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedPlanningGatewayReadPort} from
  "../../../packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts";
import {TrustedAdkReadOnlyPlanner} from
  "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";

if(process.env.ADAPTER_TRUST_PROFILE!=="evm" ||
   process.env.GATEWAY_VERIFIER_MODE!=="core-rust")
  throw Error("This test requires live EVM trust and native Core Rust verification");
const token=process.env.ADAPTER_CALLER_ORCHESTRATOR;
const engineerToken=process.env.ADAPTER_CALLER_ENGINEER;
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
for(const v of [token,engineerToken,engineerDid]){
  if(typeof v!=="string"||!v)throw Error("Missing trusted EVM fixture setting");
}
// Strict opt-in: normal signed-DAG CI stays zero-billing and byte-identical.
const geminiPilot=process.env.DELEGATION_SIGNED_GEMINI_PILOT==="1";
const signedOfflineRecovery=process.env.APPROVED_RUNNER_SIGNED_DAG_RECOVERY==="1"&&
  process.env.PLANNING_NATIVE_POSITIVE_DAG==="1";
const signedOfflineTypecheckProbe=
  process.env.APPROVED_RUNNER_SIGNED_DAG_TYPECHECK_PROBE==="1";
if(signedOfflineRecovery&&geminiPilot)
  throw Error("Offline scripted recovery must never use a paid Gemini model");
if(geminiPilot){
  verifySignedGeminiPilotConsent(process.env,{requireApiKey:true});
  if(process.env.APPROVED_RUNNER_SCENARIO!=="account-suspension"||
     process.env.PLANNING_NATIVE_SIGNED_HANDOFF!=="1"||
     process.env.PLANNING_NATIVE_POSITIVE_DAG!=="1")
    throw Error("One-use signed Account Suspension Gemini pilot not authorized");
}
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const scenario=getApprovedOfflineScenario(process.env.APPROVED_RUNNER_SCENARIO);
const referenceFiles=scenario.files;
const file="apps/backend/src/users/user.service.ts";
const frontendFile="apps/frontend/src/pages/UserDetailPage.tsx";
const disposableBase=process.env.PLANNING_DISPOSABLE_GITEA_URL;
const disposableToken=process.env.PLANNING_DISPOSABLE_GITEA_READ_TOKEN;
const disposableSha=process.env.PLANNING_DISPOSABLE_GITEA_MAIN_SHA;
const realGitea=[disposableBase,disposableToken,disposableSha]
  .some(v=>v!==undefined);
const signedHandoff=process.env.PLANNING_NATIVE_SIGNED_HANDOFF==="1";
const positiveDag=process.env.PLANNING_NATIVE_POSITIVE_DAG==="1";
const ownerD1Probe=process.env.APPROVED_RUNNER_NATIVE_OWNER_REPAIR_D1==="1";
const signedOfflineMultiTest=positiveDag&&
  process.env.APPROVED_RUNNER_SIGNED_DAG_MULTI_TEST_TASKS==="1";
if(ownerD1Probe&&(!signedOfflineTypecheckProbe||geminiPilot||
   !positiveDag||!signedHandoff||!realGitea))
  throw Error("Native owner D1 admission requires a zero-billing real TypeScript FAIL");
if(signedOfflineTypecheckProbe&&
   (geminiPilot||signedOfflineRecovery||signedOfflineMultiTest||
    !positiveDag||!signedHandoff||!realGitea||
    process.env.APPROVED_RUNNER_HOST_SELECTED_ADK_MODELS!=="1"||
    scenario.id!=="account-suspension"))
  throw Error("Typecheck fault injection requires a nonbillable signed fixture");
if(signedOfflineMultiTest&&
   (!signedOfflineRecovery||geminiPilot||
    process.env.APPROVED_RUNNER_HOST_SELECTED_ADK_MODELS!=="1"))
  throw Error("Multi-Test A2A is a nonbillable, signed recovery fixture only");
const writerToken=process.env.PLANNING_DISPOSABLE_GITEA_WRITE_TOKEN;
if(positiveDag&&(!signedHandoff||!realGitea||!writerToken||
   !process.env.ADAPTER_CALLER_BACKEND))
  throw Error("Native positive DAG requires signed handoff and disposable writer");
if(signedHandoff&&!realGitea)
  throw Error("Native signed handoff requires verified disposable Gitea");
if(realGitea&&[disposableBase,disposableToken,disposableSha]
  .some(v=>typeof v!=="string"||!v))
  throw Error("Disposable Planning Gitea requires URL, read token and immutable SHA");
if(realGitea&&!/^http:\/\/127\.0\.0\.1:\d+$/u.test(disposableBase))
  throw Error("Disposable Planning Gitea must use temporary localhost port");
if(realGitea&&!/^[a-f0-9]{40}$/u.test(disposableSha))
  throw Error("Disposable Planning Gitea needs a full trusted SHA");
const liveClient=realGitea?new GiteaClient({
  baseUrl:disposableBase,token:disposableToken,owner:"thesis",
  repository:"iam-console-poc",timeoutMs:10000
}):undefined;
const originalMain=liveClient?await liveClient.readRepository():undefined;
if(liveClient&&(originalMain?.default_branch!=="main"||
    originalMain?.revision!==disposableSha||
    originalMain?.full_name!=="thesis/iam-console-poc"))
  throw Error("Actual disposable Gitea main SHA/identity does not match fixture bootstrap");
const baseSha=originalMain?.revision??"a".repeat(40);
const originalFeature=liveClient?
  (await liveClient.getBranchMetadata(scenario.fixtureBranch)).commit_sha:undefined;
const session="native-read-plan-"+randomBytes(5).toString("hex");
const rootId="urn:native:planning-only-"+randomBytes(7).toString("hex");
// The 11-file deterministic reference fixture is NEVER a source of
// authority; the signed plan and the snapshot explicitly enumerate every
// permitted path. One E2E spec is absent on main and must be created by the
// separately scoped Test role, not by Backend/Frontend.
const roleFiles=scenario.planning_intent.edits;
const newTestFile=scenario.planning_intent.newTestFile;
// Fixture-only recovery target: derive from existing discovered test files.
const testRepairFile=signedOfflineRecovery
  ?roleFiles.backend.find(path=>path.startsWith("tests/")):undefined;
if(signedOfflineRecovery&&(!positiveDag||!signedHandoff||
   scenario.id!=="account-suspension"||!testRepairFile))
  throw Error("Signed offline recovery requires isolated Account Suspension DAG");
const existingFiles=[...roleFiles.backend,...roleFiles.frontend];
assert.deepEqual([...existingFiles,newTestFile].sort(),
  Object.keys(referenceFiles).sort());
const approvedDirectories=new Set([""]);
for(const path of [...existingFiles,newTestFile]){
  const parts=path.split("/");
  for(let i=1;i<parts.length;i++)
    approvedDirectories.add(parts.slice(0,i).join("/"));
}
const snapshot={
  session_id:session,repository:repo,base_revision:baseSha,
  directories:positiveDag?[...approvedDirectories]:[
    "","apps","apps/backend","apps/backend/src","apps/backend/src/users",
    "apps/frontend","apps/frontend/src","apps/frontend/src/pages"
  ],
  files:positiveDag?existingFiles:[file,frontendFile]
};
const agentDids={
  backend:process.env.ADAPTER_ID_BACKEND,
  frontend:process.env.ADAPTER_ID_FRONTEND,
  test:process.env.ADAPTER_ID_TEST
};
for(const did of Object.values(agentDids)){
  if(typeof did!=="string"||!did.startsWith("did:"))throw Error("Missing Agent DID");
}
const agents=Object.fromEntries(Object.entries(agentDids).map(([role,did])=>
  [role,{did,card_ref:"trusted:"+role}]));
const workBranch=positiveDag?scenario.workBranch:"feature/native-planning-read";
const legacyPlanSketch={
  tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create isolated work branch",
      description:"Keep all changes out of main",depends_on:[],
      permissions:[{operation:"create_branch",path:null,reason:"Separate workflow"}]},
    {id:"backend",agent_id:"backend",title:"Update approved service",
      description:"Implement the bounded requirement",depends_on:["branch"],
      permissions:[
        {operation:"read_file",path:file,reason:"Inspect existing code"},
        {operation:"update_file",path:file,reason:"Apply the approved edit"}
      ]},
    {id:"frontend",agent_id:"frontend",title:"Update approved page",
      description:"Implement approved Frontend behavior",depends_on:["backend"],
      permissions:[
        {operation:"read_file",path:frontendFile,reason:"Inspect existing page"},
        {operation:"update_file",path:frontendFile,reason:"Apply approved page edit"}
      ]},
    ...(positiveDag?[{id:"test",agent_id:"test",title:"Run pinned Docker acceptance",
      description:"Verify final Frontend SHA through the real controlled Runner",
      depends_on:["frontend"],
      permissions:[{operation:"run_tests",path:null,
        reason:"Execute tests and independent acceptance on approved branch"}]}]:[])
  ],assumptions:[],uncertainties:[]
};
const planSketch=positiveDag?
  makeOfflineReviewableDag({
    snapshot,edits:roleFiles,newTestFile,
    taskInstructions:scenario.planning_intent.taskInstructions,
    ...(testRepairFile?{testRepairFile}:{}),
    ...(signedOfflineMultiTest?{splitTestTasks:true}:{})
  }):legacyPlanSketch;
class ScriptedReadPlanner extends BaseLlm{
  turns=0; requests=[];
  constructor(){super({model:"native-planning-offline-script"});}
  async *generateContentAsync(req){
    this.requests.push(req);this.turns++;
    // Exercise the same bounded, read-only repository discovery tools that
    // a real Planner may use. No scripted source write or approval occurs.
    // The original negative/handoff fixture keeps its single pinned read.
    const exploration=positiveDag?[
      // Gemini requires the repository selector in its tool declaration.
      // Runtime still authorizes an argument-free, pinned read_repository.
      {name:"read_repository",args:{repository:repo.repository}},
      {name:"list_directory",args:{branch:"main",path:""}},
      {name:"read_file",args:{branch:"main",path:file}},
      {name:"read_file",args:{branch:"main",path:frontendFile}}
    ]:[{name:"read_file",args:{branch:"main",path:file}}];
    if(this.turns<=exploration.length){
      const call=exploration[this.turns-1];
      yield {content:{role:"model",parts:[{functionCall:{
        id:"planning-discovery-"+this.turns,
        name:call.name,args:call.args
      }}]}};
      return;
    }
    yield {content:{role:"model",parts:[{text:JSON.stringify(planSketch)}]}};
  }
  connect(){return Promise.reject(Error("Live LLM forbidden in offline test"));}
}
const adapterUrl="http://127.0.0.1:8090";
const opaUrl=process.env.OPA_URL??"http://127.0.0.1:8181";
const log={giteaReads:0,adapterPresentations:0,prepares:0,executions:0};
const fixtureGitea={
  async readRepository(pinned){
    log.giteaReads++;
    return {full_name:"thesis/iam-console-poc",default_branch:"main",
      revision:pinned??baseSha};
  },
  async readTextFile(branch,path,revision){
    log.giteaReads++;
    assert.equal(branch,"main");
    assert.ok([file,frontendFile].includes(path));
    assert.equal(revision,baseSha);
    return {path,branch,revision,blob_sha:"b".repeat(40),
      last_commit_sha:baseSha,size:32,encoding:"utf-8",
      content:"export const authorizedSource = true;\n"};
  },
  async listDirectory(branch,path,revision){
    log.giteaReads++;
    assert.equal(branch,"main");assert.equal(revision,baseSha);
    return {branch,path,revision,entries:[]};
  }
};
const gitea=liveClient?{
  async readRepository(pinned){
    log.giteaReads++;
    return liveClient.readRepository(pinned);
  },
  async readTextFile(branch,path,revision){
    log.giteaReads++;
    return liveClient.readTextFile(branch,path,revision);
  },
  async listDirectory(branch,path,revision){
    log.giteaReads++;
    return liveClient.listDirectory(branch,path,revision);
  }
}:fixtureGitea;
const revisions=new TrustedPlanningRevisions(gitea);
const audit=new InMemoryAuditSink();
// This offline-only fixture provisions an ephemeral Engineer signing key.
// Production code must use a separately authenticated Engineer with a
// protected signer; the Planner never receives or invokes the private key.
const receiptDir=signedHandoff?
  await mkdtemp(join(tmpdir(),"native-planning-engineer-review-")):undefined;
const signer=signedHandoff?generateKeyPairSync("ed25519"):undefined;
const keyId="isolated-native-review-key";
const signerPublic=signer?.publicKey.export({
  format:"pem",type:"spki"
}).toString();
const signerPrivate=signer?.privateKey.export({
  format:"pem",type:"pkcs8"
}).toString();
const signedStore=receiptDir?new SignedEngineerApprovalFileStore({
  directory:receiptDir,engineerDid,trustedKeys:{
    [keyId]:{engineer_did:engineerDid,public_key_pem:signerPublic}
  }
}):undefined;
/* R150.5: the SAME Gateway receiving protected A2A tool operations
 * independently verifies the original EVM-issued Rust root, its fresh
 * multi-permission VP and the owner's durable signed-epoch journal.
 * This is opt-in ZERO-BILLING integration, not a model/agent permission. */
const ownerDir=ownerD1Probe?
  await mkdtemp(join(tmpdir(),"delegation-native-owner-d1-")):undefined;
const ownerEpochDir=ownerDir?join(ownerDir,"epochs"):undefined;
const ownerOpsDir=ownerDir?join(ownerDir,"operational"):undefined;
if(ownerDir){
  await mkdir(ownerEpochDir,{mode:0o700});
  await mkdir(ownerOpsDir,{mode:0o700});
}
const ownerGatewayInspector=ownerDir?new TrustedGatewaySignedEpochInspector({
  directory:ownerEpochDir,approvals:signedStore,
  trustedOrchestratorDid:process.env.ADAPTER_ID_ORCHESTRATOR,
  nativeRootStatus:new TrustedGatewayNativeRootStatusReader({
    baseUrl:adapterUrl,gatewayToken:process.env.ADAPTER_CALLER_GATEWAY
  }),
  rootVpVerifier:new TrustedGatewayRootVpVerifier({
    audience:"urn:thesis:gateway:r133",
    verifier:loadDirectCoreRustVerifier(),
    signer:{async present(input){
      const response=await fetch(adapterUrl+"/v1/presentations",{
        method:"POST",headers:{
          authorization:"Bearer "+token,"content-type":"application/json"
        },
        body:JSON.stringify({
          credential_id:input.credential_id,
          disclosed_permissions:input.disclosed_permissions,
          audience:input.audience,challenge:input.challenge
        })
      });
      if(!response.ok)throw Error("Native owner original root VP signing failed");
      const payload=await response.json();
      if(typeof payload.signed_vp!=="string"||payload.signed_vp.length<16)
        throw Error("Native owner original root VP missing");
      return payload.signed_vp;
    }}
  })
}):undefined;

let coordinator;
const reviewGate=signedStore?new TrustedPlanningReviewGate({
  snapshot,expectedWorkBranch:workBranch,
  authenticatedEngineerDid:engineerDid,signedApprovals:signedStore,
  planningIsActive:()=>coordinator?.phase==="planning"
}):undefined;
const approvedPlans=reviewGate?new TrustedApprovedExecutionPlans({
  repository:repo,engineerDid,approvals:reviewGate,
  ...(ownerD1Probe?{
    remoteEpochInspector:ownerGatewayInspector,
    operationalSessionStore:new TrustedOperationalSessionStore(ownerOpsDir),
    operationalLeaseMs:120000
  }:{}),
  completionAttestor:positiveDag?new GatewayCorroboratedTaskAttestor():{
    async confirmCompleted(){
      // Negative suite never accepts a remote completion claim.
      return false;
    }
  }
}):undefined;
const config={bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
  opa_url:opaUrl,opa_timeout_ms:15000,
  provider_mode:"mock",gitea_timeout_ms:15000};
const runtime=new GatewayRuntime(config,{
  planningRevisions:revisions,audit,
  ...(approvedPlans?{approvedPlans}:{}),
  verifier:loadDirectCoreRustVerifier(),
  policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
  // This read-only Gitea provider remains intentionally INCAPABLE of writes
  // even after genuine operational authority is issued by Rust.
  executor:new GiteaReadOnlyExecutor(gitea)
});
const authorityClient=new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl:adapterUrl,bearerToken:engineerToken,timeoutMs:60000
});
const authority=new TrustedEngineerAuthoritySession({
  snapshot,credentials:authorityClient,
  approvals:reviewGate??{async loadAuthenticatedApproval(){
    throw Error("An unapproved Planning proposal must never activate Execution");
  }},
  authenticatedEngineerDid:engineerDid,
  planningRevisions:revisions
});
coordinator=new TrustedExecutionCoordinator({
  authority,credentials:authorityClient,
  sessionId:session,baseRevision:baseSha,
  approvedGatewayPlans:approvedPlans??{
    async activate(){throw Error("Execution prohibited before Engineer approval");},
    bindTask(){throw Error("Execution prohibited");},
    async confirmTaskCompletion(){throw Error("Execution prohibited");},
    closeSession(){throw Error("Execution prohibited");}
  }
});
const json=(object,status=200)=>new Response(JSON.stringify(object),{
  status,headers:{"content-type":"application/json"}
});
const transport=async(url,options)=>{
  const endpoint=String(url);
  if(endpoint.startsWith(adapterUrl+"/")){
    if(endpoint.endsWith("/v1/presentations"))log.adapterPresentations++;
    return fetch(url,options);
  }
  const body=JSON.parse(String(options.body));
  try{
    if(endpoint==="http://native-planning-gateway/v1/authorization/prepare"){
      log.prepares++;
      return json(runtime.prepare(body),201);
    }
    if(endpoint==="http://native-planning-gateway/v1/authorization/execute"){
      log.executions++;
      return json(await runtime.execute(body));
    }
  }catch{
    return json({error:"protected_operation_denied"},403);
  }
  throw Error("Unexpected Planning transport destination");
};
const root={
  credential_id:rootId,valid_from:new Date(Date.now()-1000).toISOString(),
  validity_seconds:600,
  credential_status:{type:"BitstringStatusListEntry",
    statusPurpose:"revocation",statusListIndex:String(randomInt(51000,61000)),
    statusListCredential:"https://status.example/lists/native-planning-read"}
};
let issued=false,revoked=false;
let pilotStage="setup",pilotModelTurns=0,pilotModelFailure="none";
let nativeOwnerIpcServer,ownerD1ReviewEvidence;
let pilotDelegatedPhase="not_started",pilotDelegatedFailure="none";
let pilotPlanningRejection=null,pilotTaskCounts=null;
try{
  const started=await coordinator.beginPlanning(root);
  issued=true;
  assert.equal(started.phase,"planning");
  assert.equal(started.credential_id,rootId);
  assert.equal(coordinator.trustedPlanningAuthority().permissions.length,
    1+snapshot.directories.length+snapshot.files.length);
  const port=new TrustedPlanningGatewayReadPort({
    coordinator,snapshot,
    gatewayBaseUrl:"http://native-planning-gateway",
    adapterBaseUrl:adapterUrl,adapterToken:token,
    fetchFn:transport,timeoutMs:60000
  });
  const noWrite=log.adapterPresentations;
  await assert.rejects(port.invoke("update_file",{
    branch:"main",path:file,content:"malicious"
  }));
  await assert.rejects(port.invoke("read_file",{
    branch:"main",path:"private/credentials.env"
  }));
  assert.equal(log.adapterPresentations,noWrite);
  // Gemini receives the SAME trusted Gitea-backed read-only Gateway tools.
  // No offline planSketch is passed to the model in the consented pilot.
  const model=geminiPilot
    ?createGeminiAdkModel({
      apiKey:process.env.GEMINI_API_KEY,
      model:process.env.DELEGATION_GEMINI_MODEL
    })
    :new ScriptedReadPlanner();
  if(geminiPilot)pilotStage="gemini_planning";
  const proposed=await new TrustedAdkReadOnlyPlanner({
    model,snapshot,workBranch,
    requirement:positiveDag?scenario.requirement:"Improve authorized backend behavior",
    planId:"native-planning-proposal",agents,readPort:port,
    ...(geminiPilot?{
      maxModelTurns:SIGNED_GEMINI_PILOT.maxTurnsPerTask.planner,
      // Reserve a bounded second revision after invalid JSON for DAG shape.
      maxProposalRevisions:2,
      validateProposedPlan:proposal=>{
        // These proposed rows are NOT signed grants or execution authority.
        preflightApprovedPilotDag({
          plan:proposal.plan,
          grants:proposal.plan.requested_permissions,
          repo,branch:workBranch
        });
      },
      maxOutputTokens:SIGNED_GEMINI_PILOT.maxOutputTokensPerCall,
      thinkingLevel:SIGNED_GEMINI_PILOT.thinkingLevel,
      maxModelCallMs:SIGNED_GEMINI_PILOT.maxModelCallMs,
      maxPlanningMs:SIGNED_GEMINI_PILOT.maxPlanningMs,
      onObservation:observation=>{
        if(observation?.kind==="plan_rejection"){
          pilotPlanningRejection={stage:observation.stage,
            reason:observation.reason};
        }
        if(observation?.kind==="model_turn"&&
           observation.status==="started"){
          pilotModelTurns++;
          process.stdout.write("[signed-gemini-pilot] "+JSON.stringify({
            event:"gemini_pilot_planner_turn",turn:observation.turn
          })+"\n");
        }
        if(observation?.kind==="model_usage")
          process.stdout.write("[signed-gemini-pilot] "+JSON.stringify({
            event:"gemini_pilot_planner_usage",turn:observation.turn,
            input_tokens:observation.input_tokens??null,
            output_tokens:observation.output_tokens??null,
            thinking_tokens:observation.thought_tokens??null
          })+"\n");
        if(observation?.kind==="model_failure"&&
           ["authentication","permission_or_billing","quota_or_rate_limit",
             "model_or_endpoint_not_found","invalid_request_or_tool_schema",
             "provider_server_error","transport_or_timeout","unknown"]
            .includes(observation.category))
          pilotModelFailure=observation.category;
      }
    }:{})
  }).propose();
  if(geminiPilot){
    // Earlier proposal rejections are recovery history, not the reason a
    // later accepted DAG failed in A2A/Docker. Report them only when
    // Planning itself is unsuccessful.
    pilotPlanningRejection=null;
    pilotStage="gemini_plan_proposed";
  }
  assert.equal(proposed.status,"unapproved_proposal");
  if(geminiPilot){
    // Aggregated role counts only; no Task text, file paths, approval IDs
    // or model content may escape the private child on a failed pilot.
    pilotTaskCounts=Object.fromEntries(
      ["orchestrator","backend","frontend","test"].map(role=>[
        role,proposed.plan.tasks.filter(t=>t.agent_id===role).length
      ])
    );
  }
  // The Planner already enforces trusted read-only exploration. A fixed
  // number of reads is not an architecture invariant and would reject an
  // otherwise valid model-generated plan for choosing a different path.
  if(!geminiPilot)
    assert.equal(proposed.verified_source_reads,positiveDag?2:1);
  assert.equal(proposed.plan.base_revision,baseSha);
  assert.equal(proposed.plan.repository.repository,"iam-console-poc");
  // Exact permission cardinalities belong to deterministic offline fixtures.
  // The live model proposes its own valid, Engineer-reviewed permission set.
  if(!geminiPilot)
    assert.equal(proposed.plan.requested_permissions.length,
      positiveDag?(2*existingFiles.length+4+
        (signedOfflineRecovery?2:0)):5); // signed fixture grants only
  if(geminiPilot){
    // Every actual preliminary read must pass the trusted Gateway and native
    // verifier. The count is whatever the model legitimately needed.
    assert.equal(log.prepares,log.adapterPresentations);
    assert.equal(log.executions,log.adapterPresentations);
  }else{
    assert.equal(log.adapterPresentations,positiveDag?4:1);
    assert.equal(log.prepares,positiveDag?4:1);
    assert.equal(log.executions,positiveDag?4:1);
    assert.equal(log.giteaReads,positiveDag?5:2);
  }
  // Trusted SHA bootstrap plus bounded real read-only model discovery.
  if(liveClient){
    // Read-only PAT and the provider are backed by the disposable Gitea,
    // never the public baseline or an in-memory repository emulator.
    const fileAtSha=await liveClient.readTextFile("main",file,baseSha);
    assert.ok(fileAtSha.content.includes("listUsers"));
    assert.equal(fileAtSha.revision,baseSha);
  }
  const executed=audit.events.filter(e=>e.event==="authorization_executed");
  assert.equal(executed.length,geminiPilot
    ?log.adapterPresentations:(positiveDag?4:1));
  for(const effect of executed){
    assert.equal(effect.decision,"allow");
    assert.equal(effect.policy_decision,"allow");
    assert.equal(effect.pinned_revision,baseSha);
    assert.equal(effect.provider_result,"success");
  }
  if(positiveDag&&!geminiPilot){
    assert.deepEqual(executed.map(e=>e.tool),[
      "read_repository","list_directory","read_file","read_file"
    ]);
    assert.deepEqual(proposed.plan.tasks.find(t=>t.id==="frontend")?.depends_on,
      ["branch"]);
    assert.deepEqual(proposed.plan.tasks.find(t=>t.id==="test")?.depends_on,
      signedOfflineMultiTest?["test-preparation"]:["backend","frontend"]);
    if(signedOfflineMultiTest){
      assert.deepEqual(proposed.plan.tasks.find(t=>
        t.id==="test-preparation")?.depends_on,["backend","frontend"]);
      assert.equal(proposed.plan.tasks.filter(t=>
        t.agent_id==="test").length,2);
    }
  }
  if(!geminiPilot){
    const visible=JSON.stringify(model.requests);
    for(const secret of [rootId,token,engineerToken,
      "signed_vp","delegation_evidence","credential_status"]){
      assert.ok(!visible.includes(secret),"Planner leaked private authority");
    }
  }
  // Obtain a second bounded challenge and JWT BEFORE revocation, so the
  // post-revocation failure exercises the native Rust verifier directly,
  // not merely the Adapter refusing to issue another JWT.
  const waiting=runtime.prepare({task_id:session,agent_role:"orchestrator",
    tool:"read_file",arguments:{branch:"main",path:file}});
  const jwtResponse=await fetch(adapterUrl+"/v1/presentations",{
    method:"POST",
    headers:{authorization:"Bearer "+token,"content-type":"application/json"},
    body:JSON.stringify({
      credential_id:rootId,
      disclosed_permissions:[waiting.required_permission],
      audience:waiting.audience,challenge:waiting.challenge
    })
  });
  assert.equal(jwtResponse.status,200);
  const signedBeforeRevoke=(await jwtResponse.json()).signed_vp;
  assert.ok(typeof signedBeforeRevoke==="string"&&signedBeforeRevoke.length>100);
  let operationalRootId,revocationChecked=false;
  if(signedHandoff){
    if(geminiPilot)pilotStage="signed_test_review";
    const packet=reviewGate.stageTrustedProposal(proposed);
    assert.equal(packet.status,"awaiting_engineer_signature");
    assert.equal(packet.plan_digest,proposed.digest);
    assert.equal(packet.base_revision,baseSha);
    assert.equal(packet.work_branch,workBranch);
    // The isolated Engineer fixture explicitly signs only a SUBSET:
    // create_branch and update_file, but NOT read_file. A model-proposed
    // permission without Engineer consent must never appear in the new root.
    const selected=positiveDag
      ?proposed.plan.requested_permissions.map(p=>p.id)
      :["permission-1","permission-3","permission-5"];
    const now=new Date(),approvedAt=now.toISOString();
    const approval=makeApproval(packet.plan,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"isolated-human-review-fixture",
      approved_by:engineerDid,approved_at:approvedAt,
      approved_permission_ids:selected
    });
    const receipt=signEngineerApproval({
      plan:packet.plan,approval,engineerDid,keyId,
      privateKeyPem:signerPrivate,issuedAt:approvedAt,
      expiresAt:new Date(now.getTime()+600_000).toISOString()
    });
    await writeFile(join(receiptDir,session+".json"),
      JSON.stringify(receipt),{mode:0o600});
    const trustedReceipt=await reviewGate.loadAuthenticatedApproval(session);
    assert.deepEqual(trustedReceipt.approval.approved_permission_ids,selected);
    assert.equal(trustedReceipt.authenticated_engineer_did,engineerDid);
    const opId="urn:native:operational-"+randomBytes(7).toString("hex");
    if(geminiPilot)pilotStage="activation_dc_vp";
    const active=await coordinator.beginExecution({
      credential_id:opId,
      valid_from:new Date(Date.now()-1000).toISOString(),
      validity_seconds:geminiPilot
        ?SIGNED_GEMINI_PILOT.operationalRootValiditySeconds:600,
      credential_status:{
        type:"BitstringStatusListEntry",
        statusPurpose:"revocation",
        statusListIndex:String(randomInt(61001,65000)),
        statusListCredential:"https://status.example/lists/native-planning-read"
      }
    });
    revoked=true; // Coordinator confirmed EVM revocation before activation
    // Test the PRE-revocation signed VP immediately while its challenge
    // is still live. Docker can exceed the short Prepare TTL; checking after
    // the full E2E would only prove request expiry (410), not EVM revocation.
    const revocationReadCount=log.giteaReads;
    await assert.rejects(
      runtime.execute({request_id:waiting.request_id,
        signed_vp:signedBeforeRevoke}),
      e=>e?.code==="verification_rejected"
    );
    assert.equal(log.giteaReads,revocationReadCount);
    revocationChecked=true;
    operationalRootId=active.credential_id;
    assert.equal(active.plan_digest,packet.plan_digest);
    assert.equal(coordinator.phase,"execution");
    const operational=coordinator.trustedOperationalAuthority();
    assert.equal(operational.credential_id,opId);
    // One operational root holds an authorization SET, not a per-task
    // multiset: independent approved Tasks may legitimately require the
    // same (resource,operation). Compare EXACT canonical grants, while
    // rejecting unexpected, missing or duplicate operational permissions.
    const reviewedRows=assertApprovedPlanScope(
      trustedReceipt.plan,trustedReceipt.approval,{
        allowedOperations:new Set(RUST_OPERATIONS),
        expectedEngineerDid:engineerDid
      });
    const grantKey=p=>JSON.stringify([p.resource,p.operation]);
    const expectedGrants=[...new Set(reviewedRows.map(grantKey))].sort();
    const actualGrants=operational.permissions.map(grantKey).sort();
    assert.equal(new Set(actualGrants).size,actualGrants.length,
      "Operational root contains duplicate permission grants");
    assert.deepEqual(actualGrants,expectedGrants,
      "Operational root must match the exact approved resource/operation set");
    if(positiveDag){
      let trustedOwnerRecovery;
      let ownerD1ChildEvidence,ownerD1Gateway,ownerD1Witness;
      if(ownerD1Probe){
        // The *existing* approvedPlans instance is shared by this Gateway,
        // the issued Rust root's Coordinator and owner-private HMAC IPC.
        // No replacement plan, parallel test-root or model-controlled token.
        const secretFile=join(ownerDir,"owner-hmac-secret.hex");
        const socketPath=join(ownerDir,"gateway-owner.sock");
        await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
          {mode:0o600});
        nativeOwnerIpcServer=await createTrustedPlanIpcServer({
          socketPath,secretFile,plans:approvedPlans,
          signedEpochInspector:ownerGatewayInspector
        });
        await nativeOwnerIpcServer.start();
        const gatewayOwner=await TrustedPlanIpcClient.connect({
          socketPath,secretFile
        });
        ownerD1Gateway=gatewayOwner;
        assert.equal(gatewayOwner.operationalLeaseConfigured(),true);
        assert.equal(gatewayOwner.operationalSessionDurableConfigured(),true);
        const currentPlan=trustedReceipt.plan;
        const grants=assertApprovedPlanScope(
          currentPlan,trustedReceipt.approval,{
            allowedOperations:new Set(RUST_OPERATIONS),
            expectedEngineerDid:engineerDid
          });
        // Match the same signed, non-derived Backend source that the
        // zero-billing TypeScript fault probe actually modifies.
        const sourceDerived=process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1"||
          process.env.APPROVED_RUNNER_SOURCE_DERIVED_ROUTES==="1";
        const derivedPaths=sourceDerived?
          selectSourceDerivedTargetsFromApprovedPlan({
            plan:currentPlan,approvedRows:grants,repo,branch:workBranch
          }):[];
        const target=roleFiles.backend.find(path=>
          path.startsWith("apps/backend/src/")&&path.endsWith(".ts")&&
          !derivedPaths.includes(path)&&
          grants.some(g=>g.agent_id==="backend"&&g.operation==="read_file"&&
            g.resource===canonicalFileUri(repo,workBranch,path))&&
          grants.some(g=>g.agent_id==="backend"&&g.operation==="update_file"&&
            g.resource===canonicalFileUri(repo,workBranch,path)));
        assert.ok(target,"R150.5 must derive the error target from the signed Backend grants");
        const fileResource=canonicalFileUri(repo,workBranch,target);
        const branchResource="gitea://"+repo.authority+"/"+repo.owner+"/"+
          repo.repository+"/branches/"+encodeURIComponent(workBranch);
        const operationalId=coordinator.trustedOperationalAuthority().credential_id;
        const armed=await armTrustedOwnerOperationalRecovery({
          gateway:gatewayOwner,coordinator,signedApprovals:signedStore,
          epochDirectory:ownerEpochDir,
          running:{readiness:{
            session_id:session,base_revision:baseSha,
            plan_digest:packet.plan_digest,
            authenticated_engineer_did:engineerDid
          },operational_root_id:operationalId},
          verifyLiveRun:async()=>{
            assert.equal(coordinator.phase,"execution");
            await gatewayOwner.renewLease(session,packet.plan_digest);
          },
          planRepairEpoch:{
            giteaClient:liveClient,
            proposeRepairPlan:async input=>{
              // The zero-billing test selects existing grants, not a new
              // capability. A future model may propose a different bounded
              // plan, which still faces the same Rust + Gateway admission.
              assert.equal(input.feedback.failed_phase,"typecheck");
              assert.ok(input.feedback.typecheck_error_codes.includes("TS2820"));
              assert.equal(input.feedback.remaining_repair_epochs,2);
              return {tasks:[
                {id:"r150-owner-backend-repair",agent_id:"backend",
                 title:"Fix real observed Backend typecheck regression",
                 description:"Correct the signed Backend source only",
                 depends_on:[],permissions:[
                   {resource:fileResource,operation:"read_file",
                    reason:"Inspect already approved source"},
                   {resource:fileResource,operation:"update_file",
                    reason:"Repair only the original approved file"}]},
                {id:"r150-owner-test-fresh",agent_id:"test",
                 title:"Run new independent Test task",
                 description:"Verify the repaired exact Gitea SHA in Docker",
                 depends_on:["r150-owner-backend-repair"],
                 permissions:[{resource:branchResource,
                   operation:"run_tests",
                   reason:"Independent new-epoch Docker validation"}]}
              ]};
            },admitReservedEpoch:true
          }
        });
        let originalA2APorts;
        trustedOwnerRecovery={
          ...armed,
          // Owner-private bridge to the live Agent Card endpoints already
          // created by the ORIGINAL native A2A executor. No agent/model
          // supplies a URL, signer, Task ID, permission or credential.
          async bindOriginalA2APorts(ports){
            if(originalA2APorts||coordinator.phase!=="execution"||
               !ports?.a2a||
               typeof ports.a2a.sendProtectedTask!=="function"||
               !ports.agentBaseUrls||
               typeof ports.armVerifiedD1BackendRepair!=="function"||
               typeof ports.armVerifiedD1TestRun!=="function"||
               !["backend","test"].every(role=>
                 /^http:\/\/127\.0\.0\.1:\d+$/u.test(
                   ports.agentBaseUrls[role]??"")))
              throw Error("R150.7 owner A2A original ports missing or stale");
            originalA2APorts=Object.freeze({
              agentBaseUrls:Object.freeze({...ports.agentBaseUrls}),
              a2a:ports.a2a,
              armVerifiedD1BackendRepair:ports.armVerifiedD1BackendRepair,
              armVerifiedD1TestRun:ports.armVerifiedD1TestRun
            });
          },
          async continueWithinActiveRoot(signal){
            // A real admitted D1 must reuse live, owner-pinned A2A ports.
            // R150.7.0 only makes them available: dispatch still requires
            // a separate real Child DC and Gateway predecessor attestation.
            if(!originalA2APorts)
              throw Error("R150.7 original protected A2A ports not bound");
            await armed.continueWithinActiveRoot(signal);
            const epochs=await armed.intake.verifiedEpochHistory();
            assert.deepEqual(epochs.map(e=>e.epoch),[1,2]);
            assert.equal(epochs[0].root_credential_id,operationalId);
            assert.equal(epochs[1].root_credential_id,operationalId);
            assert.deepEqual(epochs[1].plan.tasks.map(t=>t.id),
              ["r150-owner-backend-repair","r150-owner-test-fresh"]);
            // R150.6: ask the ORIGINAL Rust issuer for a genuinely
            // attenuated first repair Child DC, after the SAME Gateway's
            // independent epoch admission. No A2A dispatch or Gitea write
            // is attributed to this credential issuance.
            const journalDir=join(ownerDir,"repair-child-issuance");
            await mkdir(journalDir,{mode:0o700});
            const journal=new TrustedChildIssuanceJournal({
              directory:journalDir,sessionId:session,
              baseRevision:baseSha,planDigest:packet.plan_digest,
              parentCredentialId:operationalId
            });
            // R150.8: the existing native Rust issuer mints the child,
            // THEN the owner pins that credential to the already-running
            // Backend ADK/A2A server before any protected Task is submitted.
            // All source writes must go through this SAME Gateway and OPA.
            const dispatched=await dispatchTrustedAdmittedRepairA2A({
              sessionId:session,epoch:2,
              planDigest:epochs[1].plan_digest,
              taskId:"r150-owner-backend-repair",role:"backend",
              coordinator,intake:armed.intake,gateway:gatewayOwner,
              journal,engineerDid,adapterBaseUrl:adapterUrl,
              orchestratorToken:token,
              credential:{
                credential_id:"urn:native:r150-d1-backend-"+randomBytes(7).toString("hex"),
                valid_from:new Date(Date.now()-1000).toISOString(),
                validity_seconds:300,
                credential_status:{
                  type:"BitstringStatusListEntry",
                  statusPurpose:"revocation",
                  statusListIndex:String(randomInt(70001,74000)),
                  statusListCredential:"https://status.example/lists/native-owner-d1"
                }
              },
              agentBaseUrls:originalA2APorts.agentBaseUrls,
              a2a:originalA2APorts.a2a,
              beforeProtectedSend:async issued=>{
                assert.equal(issued.task_id,"r150-owner-backend-repair");
                assert.equal(issued.epoch,2);
                await originalA2APorts.armVerifiedD1BackendRepair({
                  taskId:issued.task_id,role:issued.role,
                  runtimeTaskId:issued.runtime_task_id,
                  credentialId:issued.credential_id,
                  path:target,failedSha:signal.tested_commit_sha
                });
              }
            });
            assert.equal(dispatched.status,"a2a_artifact_unconfirmed");
            assert.equal(dispatched.epoch,2);
            const confirmed=await confirmTrustedAdmittedRepairA2A({
              receipt:dispatched,gateway:gatewayOwner,
              intake:armed.intake,coordinator,sessionId:session,
              planDigest:epochs[1].plan_digest,epoch:2
            });
            assert.equal(confirmed.gateway_task_completed,true);
            assert.equal(confirmed.task_id,"r150-owner-backend-repair");
            const observedRepair=await liveClient.getBranchMetadata(workBranch);
            assert.match(observedRepair.commit_sha,/^[a-f0-9]{40}$/u);
            assert.notEqual(observedRepair.commit_sha,signal.tested_commit_sha,
              "R150.8 genuine D1 Backend must produce a different Gitea SHA");
            // R150.9: after Backend's independent Gateway completion, a
            // NEW signed Test Task receives a NEW Rust Child DC. Its A2A
            // worker uses the same original protected Test Agent endpoint.
            // Neither the old terminal Test DC nor its failed Task is reused.
            const testDispatched=await dispatchTrustedAdmittedRepairA2A({
              sessionId:session,epoch:2,
              planDigest:epochs[1].plan_digest,
              taskId:"r150-owner-test-fresh",role:"test",
              coordinator,intake:armed.intake,gateway:gatewayOwner,
              journal,engineerDid,adapterBaseUrl:adapterUrl,
              orchestratorToken:token,
              credential:{
                credential_id:"urn:native:r150-d1-test-"+randomBytes(7).toString("hex"),
                valid_from:new Date(Date.now()-1000).toISOString(),
                validity_seconds:300,
                credential_status:{
                  type:"BitstringStatusListEntry",
                  statusPurpose:"revocation",
                  statusListIndex:String(randomInt(74001,78000)),
                  statusListCredential:"https://status.example/lists/native-owner-d1"
                }
              },
              agentBaseUrls:originalA2APorts.agentBaseUrls,
              a2a:originalA2APorts.a2a,
              beforeProtectedSend:async issued=>{
                assert.equal(issued.task_id,"r150-owner-test-fresh");
                assert.equal(issued.epoch,2);
                await originalA2APorts.armVerifiedD1TestRun({
                  taskId:issued.task_id,role:issued.role,
                  runtimeTaskId:issued.runtime_task_id,
                  credentialId:issued.credential_id,
                  repairedSha:observedRepair.commit_sha
                });
              }
            });
            const testConfirmed=await confirmTrustedAdmittedRepairA2A({
              receipt:testDispatched,gateway:gatewayOwner,
              intake:armed.intake,coordinator,sessionId:session,
              planDigest:epochs[1].plan_digest,epoch:2
            });
            assert.equal(testConfirmed.gateway_task_completed,true);
            assert.equal(testConfirmed.task_id,"r150-owner-test-fresh");
            const observedAfterTest=await liveClient.getBranchMetadata(workBranch);
            assert.equal(observedAfterTest.commit_sha,observedRepair.commit_sha,
              "New signed Docker Test may not silently mutate the repaired SHA");
            // R150.10: capture signed D1 Test/root identity BEFORE shutdown.
            // No model, A2A or PR endpoint gets this witness or Gitea writer.
            // The witness will later re-check actual Gateway Runner effects,
            // durable retirement, native Rust revocation and fresh Gitea HEAD.
            const reviewerGitea=new GiteaClient({
              baseUrl:disposableBase,token:writerToken,owner:"thesis",
              repository:"iam-console-poc",timeoutMs:20000
            });
            ownerD1Witness=await TrustedRetiredRepairAcceptanceWitness.capture({
              gateway:gatewayOwner,gitea:reviewerGitea,
              coordinator,intake:armed.intake
            });
            const records=await journal.records();
            assert.equal(records.length,2);
            assert.notEqual(testDispatched.credential_id,dispatched.credential_id);
            assert.deepEqual(records.map(r=>r.task_id).sort(),
              ["r150-owner-backend-repair","r150-owner-test-fresh"]);
            assert.equal(records[0].observation,"adapter_response_verified");
            assert.equal(records[0].parent_credential_id,operationalId);
            ownerD1ChildEvidence={
              original_rust_parent:operationalId,
              new_test_child_issued:true,
              test_gateway_task_completed:true,
              test_a2a_dispatched:true,
              test_sha:observedAfterTest.commit_sha,
              child_issued:true,
              gateway_task_bound:true,
              a2a_dispatched:true,
              provider_executed:true,
              gateway_task_completed:true,
              repaired_sha:observedRepair.commit_sha
            };
          }
        };
      }
      let approvedAgentModelFactory;
      if(geminiPilot||
         process.env.APPROVED_RUNNER_HOST_SELECTED_ADK_MODELS==="1"){
        // The MODEL FACTORY is now separate from the signed native runner.
        // This CI producer still uses deterministic implementation fixtures,
        // but only inside this owner test host, NOT as an agent permission
        // source or as data supplied to the model binding.
        const reviewed=await reviewGate.loadAuthenticatedApproval(session);
        const approvedRows=assertApprovedPlanScope(
          reviewed.plan,reviewed.approval,{
            allowedOperations:new Set(RUST_OPERATIONS),
            expectedEngineerDid:engineerDid
          });
        // In route mode, no final implementation bytes for user.routes.ts
        // enter the script compiler OR the Backend model constructor.
        // In the signed-DAG source-witness CI profile, also require a
        // real source-derived functional Backend route (not a mere comment).
        const deriveRoutes=!geminiPilot&&(
          process.env.APPROVED_RUNNER_SOURCE_DERIVED_ROUTES==="1"||
          process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1");
        const derivedPaths=deriveRoutes
          ?selectSourceDerivedTargetsFromApprovedPlan({
            plan:reviewed.plan,approvedRows,repo,branch:workBranch
          }):[];
        const otherImplementations={...referenceFiles};
        for(const path of derivedPaths)delete otherImplementations[path];
        if(signedOfflineTypecheckProbe){
          // Test fault location is selected from ACTUAL signed Backend
          // update grants. It never chooses or widens authorization.
          const target=roleFiles.backend.find(path=>
            path.startsWith("apps/backend/src/")&&path.endsWith(".ts")&&
            !derivedPaths.includes(path)&&
            approvedRows.some(g=>g.agent_id==="backend"&&
              g.operation==="update_file"&&
              g.resource===canonicalFileUri(repo,workBranch,path)));
          if(!target||typeof otherImplementations[target]!=="string")
            throw Error("No approved Backend TypeScript target for fault probe");
          otherImplementations[target]+=
            '\nconst __delegation_typecheck_probe: "ACTIVE" | "SUSPENDED" = "SUSPEND";\n';
        }
        // Not even the scripted call compiler is invoked for real Gemini.
        const offlineCalls=geminiPilot?null:
          buildOfflineAdkScriptsFromApprovedPlan({
            plan:reviewed.plan,approvedRows,repo,branch:workBranch,
            implementationContents:derivedPaths.length
              ?otherImplementations:referenceFiles,
            ...(derivedPaths.length?{sourceDerivedPaths:derivedPaths}:{}),
            ...(signedOfflineRecovery?{recoveryFixture:{
              path:testRepairFile,
              failedContent:referenceFiles[testRepairFile]+
                '\nthrow new Error("signed DAG offline recovery regression");\n'
            }}:{})
          });
        approvedAgentModelFactory=context=>{
          const expected=approvedRows.filter(g=>
            g.agent_id===context.role).map(g=>({
              task_id:g.task_id,operation:g.operation,resource:g.resource
            }));
          assert.deepEqual(context.approved_permissions,expected);
          assert.equal(Object.hasOwn(context,"implementationContents"),false);
          if(geminiPilot)
            return createGeminiAdkModel({
              apiKey:process.env.GEMINI_API_KEY,
              model:process.env.DELEGATION_GEMINI_MODEL
            });
          if(context.role==="backend"&&deriveRoutes)
            return new SourceDerivedRouteOfflineAdkModel({
              context,calls:offlineCalls[context.role]
            });
          if(context.role==="frontend"&&
             process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1")
            return new SourceWitnessedOfflineAdkModel({
              context,calls:offlineCalls[context.role]
            });
          return new OfflineApprovedAdkModel(
            context.role,offlineCalls[context.role]);
        };
      }
      if(geminiPilot)pilotStage="delegated_agents_gitea_docker";
      globalThis.__nativeDagPositive=await runNativePositiveApprovedDag({
        coordinator,reviewGate,approvedPlans,
        ...(approvedAgentModelFactory?{approvedAgentModelFactory}:{}),
        sessionId:session,planDigest:packet.plan_digest,baseSha,
        operationalRootId,branch:workBranch,planningFiles:snapshot.files,
        referenceFiles:approvedAgentModelFactory?undefined:referenceFiles,
        realGeminiPilot:geminiPilot,
        ...(trustedOwnerRecovery?{trustedOwnerRecovery}:{}),
        ...(geminiPilot?{
          onPilotPhase:phase=>{pilotDelegatedPhase=phase;},
          onPilotError:category=>{pilotDelegatedFailure=category;}
        }:{}),
        offlineRecovery:signedOfflineRecovery,
        offlineTypecheckProbe:signedOfflineTypecheckProbe,
        offlineMultiTest:signedOfflineMultiTest,
        scenarioId:scenario.id,repo,
        giteaBase:disposableBase,readerToken:disposableToken,
        writerToken,opaUrl,engineerDid,orchestratorToken:token,
        agentTokens:{
          backend:process.env.ADAPTER_CALLER_BACKEND,
          frontend:process.env.ADAPTER_CALLER_FRONTEND,
          test:process.env.ADAPTER_CALLER_TEST
        }
      });
      if(signedOfflineTypecheckProbe){
        const proof=globalThis.__nativeDagPositive;
        if(ownerD1Probe){
          assert.equal(proof.status,"trusted_owner_repair_handoff_retired");
          assert.equal(proof.original_dag_completed,false);
          assert.equal(proof.repair_epoch_handoff,true);
          assert.equal(proof.final_runner_pass_verified,false);
          assert.equal(proof.original_root_revoked,true);
          assert.equal(proof.pull_request_created,false);
          assert.equal(proof.failed_phase,"typecheck");
          assert.equal(coordinator.phase,"closed");
          assert.equal(ownerD1ChildEvidence?.original_rust_parent,
            operationalRootId);
          assert.equal(ownerD1ChildEvidence?.child_issued,true);
          assert.equal(ownerD1ChildEvidence?.gateway_task_bound,true);
          assert.equal(ownerD1ChildEvidence?.a2a_dispatched,true);
          assert.equal(ownerD1ChildEvidence?.provider_executed,true);
          assert.equal(ownerD1ChildEvidence?.gateway_task_completed,true);
          assert.equal(ownerD1ChildEvidence?.new_test_child_issued,true);
          assert.equal(ownerD1ChildEvidence?.test_gateway_task_completed,true);
          assert.equal(ownerD1ChildEvidence?.test_a2a_dispatched,true);
          assert.equal(ownerD1ChildEvidence?.test_sha,
            ownerD1ChildEvidence?.repaired_sha);
          assert.match(ownerD1ChildEvidence?.repaired_sha,/^[a-f0-9]{40}$/u);
          // R150.10: closeExecution already confirmed Rust revocation.
          // A plain Gateway close is NOT an independently persisted tombstone:
          // the authenticated OWNER must now durably retire this same session.
          if(!ownerD1Gateway||!ownerD1Witness)
            throw Error("R150.10 original-root signed Test witness missing");
          await coordinator.assertOperationalClosureConfirmed();
          await ownerD1Gateway.retireSession(session);
          const revoked=await ownerD1Witness.verifyRevokedRetiredExactSha();
          assert.equal(revoked.status,
            "r142_retired_runner_gitea_native_revoked_no_pr_authority");
          assert.equal(revoked.tested_commit_sha,ownerD1ChildEvidence.repaired_sha);
          assert.equal(revoked.root_revoked,true);
          assert.equal(revoked.pull_request_authorized,false);
          // Only the original Engineer-approved PR permission, verified
          // independently by R145, can open a REVIEW-ONLY draft AFTER
          // revocation and exact-SHA Runner PASS. Never merge.
          const draft=await ownerD1Witness.openSignedReviewOnlyDraft({
            title:"Review repaired account-suspension TypeScript regression",
            body:"Signed Engineer-approved repair epoch D1.\n"+
              "Independent Gateway/Runner Docker PASS on exact Gitea SHA: "+
              revoked.tested_commit_sha+"\n"+
              "Original Rust root revoked. Human review required. No auto-merge."
          });
          assert.equal(draft.status,"r145_signed_review_only_draft_open_unmerged");
          assert.equal(draft.draft,true);
          assert.equal(draft.merged,false);
          assert.equal(draft.merge_authorized,false);
          assert.equal(draft.tested_commit_sha,revoked.tested_commit_sha);
          ownerD1ReviewEvidence=Object.freeze({
            status:"signed_d1_real_docker_pass_retired_draft_review",
            tested_commit_sha:draft.tested_commit_sha,
            root_revoked:true,draft:true,merged:false,
            merge_authorized:false,real_runner_pass_verified:true,
            draft_pr_number:draft.draft_pr_number
          });
          assert.notEqual(ownerD1ChildEvidence?.repaired_sha,proof.original_test_sha);
        }else{
        assert.equal(proof.typecheck_probe_verified,true);
        assert.equal(proof.signed_dag_completed,false);
        assert.equal(proof.status,"expected_typecheck_failure");
        assert.equal(proof.project_tests,"fail");
        assert.equal(proof.first_failed_phase,"typecheck");
        assert.equal(proof.pr_created,false);
        assert.equal(proof.operational_root_revoked,true);
        assert.equal(proof.main_unchanged,true);
        assert.deepEqual(proof.typecheck_error_codes,["TS2820"]);
        }
      }else{
      assert.equal(globalThis.__nativeDagPositive.signed_dag_completed,true);
      const sourceWitnessMode=
        process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1";
      const derivedRoutesMode=
        process.env.APPROVED_RUNNER_SOURCE_DERIVED_ROUTES==="1"||
        sourceWitnessMode;
      assert.equal(globalThis.__nativeDagPositive.model_source,
        geminiPilot?"real_gemini_four_models_signed_test_approval":
        derivedRoutesMode
          ? "host_supplied_source_derived_routes_with_remaining_fixtures"
          : sourceWitnessMode
            ? "host_supplied_hybrid_source_witness_and_fixture"
            : approvedAgentModelFactory
              ? "host_supplied_scripted_tool_calls"
              : "inline_scripted_tool_calls");
      if(!geminiPilot)
        assert.equal(globalThis.__nativeDagPositive
          .source_derived_functional_route_verified,derivedRoutesMode);
      if(!geminiPilot)assert.equal(globalThis.__nativeDagPositive
        .source_derived_functional_file_count,derivedRoutesMode
          ? (scenario.id==="account-suspension"?4:1):0);
      if(derivedRoutesMode&&scenario.id==="account-suspension"){
        assert.equal(globalThis.__nativeDagPositive
          .source_derived_controller_verified,true);
        assert.equal(globalThis.__nativeDagPositive
          .source_derived_status_verified,true);
        assert.equal(globalThis.__nativeDagPositive
          .source_derived_frontend_api_verified,true);
      }
      assert.equal(globalThis.__nativeDagPositive
        .source_witnessed_native_dag_verified,sourceWitnessMode);
      // A host-selected BaseLlm can still encapsulate golden implementation
      // bytes. Do not let a provider-green E2E claim model independence.
      assert.equal(globalThis.__nativeDagPositive.scripted_adk_no_paid_model,
        !geminiPilot);
      assert.equal(globalThis.__nativeDagPositive
        .fixture_scripted_payloads_reach_adk_runner,!geminiPilot);
      assert.equal(globalThis.__nativeDagPositive
        .independent_model_software_output_verified,geminiPilot);
      if(geminiPilot){
        assert.ok(globalThis.__nativeDagPositive.source_writes>=0&&
          globalThis.__nativeDagPositive.source_writes<=
            proposed.plan.requested_permissions.filter(p=>
              p.operation==="update_file").length,
          "Actual source writes must be a subset of granted operations");
      }else assert.equal(globalThis.__nativeDagPositive.source_writes,
        existingFiles.length+(signedOfflineRecovery?1:0));
      assert.equal(globalThis.__nativeDagPositive.manifest_source,
        "engineer_signed_approved_plan");
      if(geminiPilot){
        assert.ok(globalThis.__nativeDagPositive.created_test_files>=0&&
          globalThis.__nativeDagPositive.created_test_files<=
            proposed.plan.requested_permissions.filter(p=>
              p.operation==="create_file"&&p.agent_id==="test").length,
          "Actual Test creations must be within signed grant scope");
      }else assert.equal(globalThis.__nativeDagPositive.created_test_files,1);
      if(geminiPilot){
        const runs=globalThis.__nativeDagPositive.test_runner_runs;
        assert.ok(Number.isSafeInteger(runs)&&runs>=1&&runs<=6,
          "Live signed Test may repair after a failed Docker run");
      }else assert.equal(globalThis.__nativeDagPositive.test_runner_runs,
        signedOfflineRecovery?2:1);
      if(signedOfflineRecovery){
        assert.equal(globalThis.__nativeDagPositive.recovery_verified,true);
        assert.notEqual(globalThis.__nativeDagPositive.failed_test_sha,
          globalThis.__nativeDagPositive.tested_commit_sha);
      }
      if(signedOfflineMultiTest){
        assert.equal(globalThis.__nativeDagPositive.a2a_tasks_dispatched,4);
        assert.equal(globalThis.__nativeDagPositive
          .multi_test_a2a_independent_authority_verified,true);
      }
      assert.equal(globalThis.__nativeDagPositive.tested_commit_sha,
        globalThis.__nativeDagPositive.approved_branch_sha);
      }
    }else{
    // Load the ACTUAL production-style approved DAG dispatcher from the
    // same signed review gate, operational root, and immutable base SHA.
    // A read-only provider cannot create a branch, so this stage deliberately
    // proves fail-closed BEFORE any specialized A2A send/child DC issuance.
    let a2aSends=0,childAllocations=0;
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:reviewGate,coordinator,sessionId:session,
      expectedPlanDigest:packet.plan_digest,baseRevision:baseSha,
      expectedEngineerDid:engineerDid,
      agentBaseUrls:{
        backend:"http://127.0.0.1:18861",
        frontend:"http://127.0.0.1:18862",
        test:"http://127.0.0.1:18863"
      },
      a2a:{async sendProtectedTask(){
        a2aSends++;
        throw Error("A2A dispatch before verified branch provider effect");
      }},
      adapter:{adapterBaseUrl:adapterUrl,bearerToken:token,timeoutMs:60000},
      async authorityForTask(){
        childAllocations++;
        throw Error("Cannot allocate a child before verified branch creation");
      }
    });
    assert.equal(dispatcher.approvedBranch,workBranch);
    await assert.rejects(dispatcher.dispatch("backend"),/dependencies/);
    assert.equal(a2aSends,0);
    assert.equal(childAllocations,0);
    let branchRequestId;
    const countBefore=log.giteaReads;
    await assert.rejects(dispatcher.executeApprovedDag({
      async invokeOrchestratorTask(taskId,gatewayTaskId){
        assert.equal(taskId,"branch");
        assert.match(gatewayTaskId,/^dispatch_[A-Za-z0-9_-]{22}$/u);
        await assert.rejects(async()=>runtime.prepare({
          task_id:gatewayTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:"feature/not-approved"
          }
        }),e=>e?.code==="approved_plan_denied");
        await assert.rejects(async()=>runtime.prepare({
          task_id:gatewayTaskId,agent_role:"orchestrator",
          tool:"update_file",arguments:{
            branch:"main",path:file,content:"malicious"
          }
        }));
        // Correct signed plan action: real EVM-root JWT and native Rust VP
        // verification, live OPA, then read-only Gitea provider DENIAL.
        const prepared=runtime.prepare({
          task_id:gatewayTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:workBranch
          }
        });
        branchRequestId=prepared.request_id;
        const signed=await fetch(adapterUrl+"/v1/presentations",{
          method:"POST",
          headers:{authorization:"Bearer "+token,
            "content-type":"application/json"},
          body:JSON.stringify({
            credential_id:opId,
            disclosed_permissions:[prepared.required_permission],
            audience:prepared.audience,challenge:prepared.challenge
          })
        });
        assert.equal(signed.status,200);
        const jwt=(await signed.json()).signed_vp;
        assert.ok(typeof jwt==="string"&&jwt.length>100);
        await runtime.execute({request_id:prepared.request_id,signed_vp:jwt});
      }
    }),e=>e?.code==="provider_operation_unavailable");
    assert.equal(dispatcher.completedTaskIds.length,0);
    assert.equal(coordinator.phase,"closed"); // dispatcher closed and revoked root
    assert.equal(a2aSends,0);
    assert.equal(childAllocations,0);
    assert.equal(log.giteaReads,countBefore);
    const blocked=audit.events.filter(e=>e.event==="authorization_executed"&&
      e.request_id===branchRequestId);
    assert.equal(blocked.length,1);
    assert.equal(blocked[0].policy_decision,"allow");
    assert.equal(blocked[0].provider_result,"error");
    assert.equal(blocked[0].approved_plan_digest,packet.plan_digest);
    }
  }else{
    await authorityClient.revokeRoot(rootId);
    revoked=true;
  }
  const before=log.giteaReads;
  if(!revocationChecked){
    // Standalone Planning-only test revokes shortly before this point.
    await assert.rejects(
      runtime.execute({request_id:waiting.request_id,
        signed_vp:signedBeforeRevoke}),
      e=>e?.code==="verification_rejected"
    );
  }
  assert.equal(log.giteaReads,before);
  // A stale Planning read port must never
  // let any caller bypass status revocation or obtain new effective access.
  await assert.rejects(port.invoke("read_file",{branch:"main",path:file}));
  assert.equal(log.giteaReads,before);
  if(!signedHandoff)revisions.end(session);
  await assert.rejects(port.invoke("read_file",{branch:"main",path:file}));
  assert.equal(log.giteaReads,before);
  if(signedHandoff){
    assert.equal(coordinator.phase,"closed");
    // The newly bound dispatcher cannot continue its signed DAG after
    // provider refusal, and the former operational root is EVM-revoked.
    await assert.rejects(async()=>runtime.prepare({
      task_id:"dispatch_expired_native_handoff",agent_role:"orchestrator",
      tool:"create_branch",arguments:{base_branch:"main",branch:workBranch}
    }),e=>e?.code==="approved_plan_denied");
  }
  if(liveClient){
    assert.equal((await liveClient.getBranchMetadata("main")).commit_sha,baseSha);
    assert.equal((await liveClient.getBranchMetadata(scenario.fixtureBranch)).commit_sha,
      originalFeature);
  }
  if(geminiPilot)pilotStage="complete";
  console.log(JSON.stringify({
    event:"native_preliminary_adk_planning",
    status:"pass",
    rust_evm_root_issued:true,
    native_rust_vp_verified:true,
    live_opa:true,
    model_calls_paid:geminiPilot,
    model_source:geminiPilot?"real_gemini_four_models":"offline_scripted",
    engineer_review_type:geminiPilot?"signed_test_fixture_not_human":"signed_test_fixture",
    pinned_gitea_fixture:!realGitea,
    real_disposable_gitea_pinned_reads:realGitea,
    real_gitea_main_unchanged:realGitea,
    independent_revocation_denial:true,
    source_reads:proposed.verified_source_reads,
    approval_created:signedHandoff,
    trusted_planning_review:signedHandoff,
    signed_ed25519_fixture:signedHandoff,
    native_operational_root_and_activation:signedHandoff,
    operational_root_closed:signedHandoff,
    dispatcher_bound_signed_dag:signedHandoff,
    dispatcher_stopped_before_a2a_on_provider_denial:signedHandoff&&!positiveDag,
    a2a_tasks_dispatched:positiveDag
      ?globalThis.__nativeDagPositive.a2a_tasks_dispatched:0,
    child_dc_issued:positiveDag
      ?globalThis.__nativeDagPositive.native_rust_child_credentials:0,
    real_provider_mutations:positiveDag?
      globalThis.__nativeDagPositive.source_writes+
      globalThis.__nativeDagPositive.created_test_files:0,
    provider_writes:positiveDag?
      globalThis.__nativeDagPositive.source_writes+
      globalThis.__nativeDagPositive.created_test_files:0,
    ...(positiveDag?{positive_dag:globalThis.__nativeDagPositive}:{}),
    ...(ownerD1Probe?{owner_repair_review:ownerD1ReviewEvidence}:{})
  }));
}catch(error){
  if(geminiPilot){
    // A fixed-vocabulary diagnostic only; never forward provider exception
    // text, model prompts, repository source, tool args, or authorization.
    const category=error?.code==="ERR_ASSERTION"?"test_assertion":
      typeof error?.message==="string"&&
      error.message.startsWith("Unapproved Planning:")?
        "planner_contract_rejected":
        pilotModelFailure!=="none"?"model_provider_failure":
          "unclassified_failure";
    // The only stack information permitted outside the private child is a
    // numeric line of OUR public harness, never the exception message or
    // stack text (which could contain source or credentials).
    const location=error?.code==="ERR_ASSERTION"&&
      typeof error.stack==="string"
        ?error.stack.match(/(?:native-approved-planner-dag-positive|native-planning-read-core-evm-e2e)\.mjs:(\d+):\d+/u)
        :null;
    const at=location?Number(location[1]):null;
    const assertionLocation=Number.isSafeInteger(at)&&at>0&&at<2000
      ?Object.freeze({
        module:location[0].startsWith("native-approved")
          ?"signed_dag_harness":"planning_harness",
        line:at
      }):null;
    process.stderr.write("[signed-gemini-pilot] "+JSON.stringify({
      stage:pilotStage,category,
      ...(pilotStage==="delegated_agents_gitea_docker"?{
        delegated_phase:pilotDelegatedPhase,
        delegated_failure:pilotDelegatedFailure
      }:{}),
      ...(assertionLocation?{assertion_location:assertionLocation}:{}),
      model_failure:pilotModelFailure,
      ...(pilotPlanningRejection
        ?{planning_rejection:pilotPlanningRejection}:{}),
      model_turns_started:pilotModelTurns,
      ...(pilotTaskCounts?{approved_task_counts:pilotTaskCounts}:{}),
      signature_type:"ed25519_test_fixture_not_human",
      completed:false
    })+"\n");
  }
  throw error;
}finally{
  try{
    if(issued&&!revoked)await authorityClient.revokeRoot(rootId);
  }finally{
    try{if(nativeOwnerIpcServer)await nativeOwnerIpcServer.close();}
    finally{
      if(ownerDir)await rm(ownerDir,{recursive:true,force:true});
      if(receiptDir)await rm(receiptDir,{recursive:true,force:true});
    }
  }
}
