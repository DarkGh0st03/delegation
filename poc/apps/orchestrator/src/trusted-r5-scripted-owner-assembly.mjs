/**
 * R5 owner-only assembly of the real two-root Planning runtime.
 * Receives ONLY the protected service configuration already loaded and
 * checked by the same prepared owner bootstrap. No roots, signed approvals,
 * A2A tasks or model-provider calls are issued during assembly.
 */
import {createPrivateKey,createPublicKey} from "node:crypto";
import {BaseLlm} from "@google/adk";
import {createGeminiAdkModel} from "../../../packages/agent-runtime/src/gemini-adk-model.ts";
import {isDeepStrictEqual} from "node:util";
import {TrustedPlanIpcClient}
  from "../../gateway/src/trusted-plan-ipc.ts";
import {TrustedEngineerAuthoritySession,preliminaryReadPermissions}
  from "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator}
  from "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedPlanningRecoveryStore}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {SignedEngineerApprovalFileStore}
  from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedPlanningReviewGate}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-review-gate.ts";
import {SoftwareEngineerAuthorityBootstrap}
  from "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {R5ScriptedNoProviderPlanningModel}
  from "../../../packages/orchestrator-runtime/src/trusted-r5-scripted-planning-model.ts";

function deny(reason){
  throw Error("R5 owner Planning assembly denied: "+reason);
}
function localGateway(value){
  try{
    const u=new URL(value);
    return u.protocol==="http:"&&u.hostname==="127.0.0.1"&&
      !!u.port&&Number(u.port)>0&&Number(u.port)<=65535&&
      u.pathname==="/"&&!u.search&&!u.hash&&!u.username&&!u.password;
  }catch{return false;}
}
function sameEd25519Key(privatePem,publicPem){
  try{
    const privateKey=createPrivateKey(privatePem);
    if(privateKey.asymmetricKeyType!=="ed25519")return false;
    const expected=createPublicKey(publicPem).export({type:"spki",format:"der"});
    const actual=createPublicKey(privateKey).export({type:"spki",format:"der"});
    return actual.equals(expected);
  }catch{return false;}
}
function separateHumanEngineerSigner(backendPublicPem,engineerPublicPem){
  try{
    const backend=createPublicKey(backendPublicPem);
    const engineer=createPublicKey(engineerPublicPem);
    if(backend.asymmetricKeyType!=="ed25519"||
       engineer.asymmetricKeyType!=="ed25519")return false;
    const a=backend.export({type:"spki",format:"der"});
    const b=engineer.export({type:"spki",format:"der"});
    return !a.equals(b);
  }catch{return false;}
}
function freezeDeep(value){
  if(value&&typeof value==="object"&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
/** Reusable SAME Coordinator/Gateway/approval assembly. No model inference here.
 * Only trusted owner entrypoints can select the model and fixed budgets. */
async function assembleProtectedOwnerPlanningCore({
  config,planningCheckpointStore,operationalRecovery,
  snapshot,preliminaryRoot,model,plannerLimits={},
  requirement,planId,agents,gatewayBaseUrl,backendPrivateKeyPem,
  status="owner_original_planning_assembled_not_started"
}={}){
  const approval=config?.approval,recovery=config?.recovery,
    pins=config?.ownerPlanning;
  if(!approval||!recovery||!pins||
     !planningCheckpointStore||!operationalRecovery||!snapshot||
     snapshot.session_id!==approval.expectedSessionId||
     snapshot.base_revision!==approval.expectedBaseRevision||
     !isDeepStrictEqual(snapshot.repository,approval.repository)||
     typeof requirement!=="string"||!requirement.trim()||
     typeof planId!=="string"||!planId.trim()||
     !agents||typeof agents!=="object"||Array.isArray(agents)||
     Object.keys(agents).sort().join(",")!=="backend,frontend,test"||
     Object.values(agents).some(a=>!a||typeof a.did!=="string"||
       !a.did.startsWith("did:")||typeof a.card_ref!=="string"||
       !a.card_ref.trim())||!localGateway(gatewayBaseUrl)||
     !preliminaryRoot||typeof preliminaryRoot!=="object"||
     !(model instanceof BaseLlm)||
     !sameEd25519Key(backendPrivateKeyPem,pins.backendPublicKeyPem)||
     !separateHumanEngineerSigner(pins.backendPublicKeyPem,
       approval.publicKeyPem))
    deny("original protected snapshot, source and backend signer required");
  // Protected copies cannot be mutated while the human reviews the
  // original plan or before the one-shot Planning bootstrap.
  snapshot=freezeDeep(structuredClone(snapshot));
  agents=freezeDeep(structuredClone(agents));
  preliminaryRoot=freezeDeep(structuredClone(preliminaryRoot));
  // The bound model gets a private frozen copy of the reviewed inventory,
  // but never a credential, API bearer token or Engineer signing key.
  preliminaryReadPermissions(snapshot);
  const client=await TrustedPlanIpcClient.connect({
    socketPath:recovery.gatewaySocketPath,
    secretFile:recovery.gatewaySecretFile
  });
  // Reported by the actual Gateway socket, not by owner-supplied booleans.
  if(!client.operationalLeaseConfigured()||
     !client.operationalSessionDurableConfigured()||
     !client.planningRetirementConfigured()||
     !client.planningRetirementDurableConfigured())
    deny("Gateway has no durable operational/Planning recovery and lease");
  const credentials=new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl:recovery.adapterBaseUrl,
    bearerToken:recovery.adapterToken
  });
  const signed=new SignedEngineerApprovalFileStore({
    directory:approval.receiptDirectory,
    engineerDid:approval.engineerDid,
    trustedKeys:{[approval.keyId]:{
      engineer_did:approval.engineerDid,public_key_pem:approval.publicKeyPem
    }}
  });
  let coordinator;
  const reviewGate=new TrustedPlanningReviewGate({
    snapshot,expectedWorkBranch:pins.expectedWorkBranch,
    authenticatedEngineerDid:approval.engineerDid,
    signedApprovals:signed,
    planningIsActive:()=>coordinator?.phase==="planning"
  });
  const planningRecovery=new TrustedPlanningRecoveryStore(
    recovery.planningDirectory
  );
  const authority=new TrustedEngineerAuthoritySession({
    snapshot,credentials,approvals:reviewGate,
    authenticatedEngineerDid:approval.engineerDid,
    planningRevisions:client
  });
  coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:client,credentials,
    sessionId:snapshot.session_id,baseRevision:snapshot.base_revision,
    operationalRecovery,planningRecovery
  });
  coordinator.assertOperationalRecoveryStore(operationalRecovery);
  coordinator.assertPlanningRecoveryStore(planningRecovery);
  const planning=Object.freeze({
    coordinator,snapshot,preliminaryRoot,reviewGate,
    planningRecovery,checkpointStore:planningCheckpointStore,
    backendKeyId:pins.backendKeyId,backendPrivateKeyPem,
    planner:Object.freeze({snapshot,requirement,planId,
      workBranch:pins.expectedWorkBranch,agents,model,...plannerLimits}),
    gateway:Object.freeze({gatewayBaseUrl,
      adapterBaseUrl:recovery.adapterBaseUrl,
      adapterToken:recovery.adapterToken})
  });
  return Object.freeze({planning,coordinator,gateway:client,status});
}

/** Zero-billing R5 selection is PINNED to an ADK model with no provider.
 * Never accept an arbitrary BaseLlm from the R5 runner.
 */
export async function assembleProtectedR5ScriptedOwnerPlanning(input={}){
  const {snapshot,config,edits,newTestFile}=input;
  // Early fail-closed validation and source-path checks happen BEFORE IPC.
  preliminaryReadPermissions(snapshot);
  const model=new R5ScriptedNoProviderPlanningModel({
    snapshot,workBranch:config?.ownerPlanning?.expectedWorkBranch,
    edits,newTestFile
  });
  return assembleProtectedOwnerPlanningCore({
    ...input,model,status:"owner_r5_original_planning_assembled_not_started"
  });
}

/** Owner-selected real Gemini PLANNING assembly (NOT Execution).
 * Model construction itself is non-billable; start(planning) is the
 * separate, explicit and potentially billable owner action.
 * This input is NEVER populated by GitHub workflow_dispatch, A2A, MCP or UI.
 * The original signed Engineer review remains mandatory after Planning.
 */
export async function assembleProtectedOwnerGeminiPlanning(input={}){
  if(input?.authorizationInput!=="I AUTHORIZE GEMINI API CHARGES"||
     input?.modelName!=="gemini-3.8-flash"||
     typeof input?.geminiApiKey!=="string"||
     !input.geminiApiKey.trim())
    deny("owner-selected Gemini Planning requires explicit paid consent, pinned model and private API key");
  // No inference, source reads or API request during constructor/assembly.
  // Fixed budgets match the successful isolated Gemini Planner feasibility.
  const model=createGeminiAdkModel({
    apiKey:input.geminiApiKey,model:input.modelName
  });
  return assembleProtectedOwnerPlanningCore({
    ...input,model,
    plannerLimits:{
      maxModelTurns:96,maxModelCallMs:120000,maxOutputTokens:16384,
      maxPlanningMs:900000,thinkingLevel:"MEDIUM"
    },
    status:"owner_gemini_planning_assembled_not_started"
  });
}
