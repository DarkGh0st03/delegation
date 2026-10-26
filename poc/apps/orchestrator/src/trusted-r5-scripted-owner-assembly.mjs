/**
 * R5 owner-only assembly of the real two-root Planning runtime.
 * Receives ONLY the protected service configuration already loaded and
 * checked by the same prepared owner bootstrap. No roots, signed approvals,
 * A2A tasks or model-provider calls are issued during assembly.
 */
import {createPrivateKey,createPublicKey} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {TrustedPlanIpcClient}
  from "../gateway/src/trusted-plan-ipc.ts";
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
function freezeDeep(value){
  if(value&&typeof value==="object"&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
/** Read-only network handshake with actual owner-only Gateway socket. */
export async function assembleProtectedR5ScriptedOwnerPlanning({
  config,planningCheckpointStore,operationalRecovery,
  snapshot,preliminaryRoot,edits,newTestFile,
  requirement,planId,agents,gatewayBaseUrl,backendPrivateKeyPem
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
     !sameEd25519Key(backendPrivateKeyPem,pins.backendPublicKeyPem))
    deny("original protected snapshot, source and backend signer required");
  // Protected copies cannot be mutated while the human reviews the
  // original plan or before the one-shot Planning bootstrap.
  snapshot=freezeDeep(structuredClone(snapshot));
  agents=freezeDeep(structuredClone(agents));
  preliminaryRoot=freezeDeep(structuredClone(preliminaryRoot));
  edits=freezeDeep(structuredClone(edits));
  // Validate canonical Gitea inventory and role file intentions BEFORE
  // touching a socket or issuing a preliminary root.
  preliminaryReadPermissions(snapshot);
  const model=new R5ScriptedNoProviderPlanningModel({
    snapshot,workBranch:pins.expectedWorkBranch,edits,newTestFile
  });
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
      workBranch:pins.expectedWorkBranch,agents,model}),
    gateway:Object.freeze({gatewayBaseUrl,
      adapterBaseUrl:recovery.adapterBaseUrl,
      adapterToken:recovery.adapterToken})
  });
  return Object.freeze({planning,coordinator,gateway:client,
    status:"owner_r5_original_planning_assembled_not_started"});
}
