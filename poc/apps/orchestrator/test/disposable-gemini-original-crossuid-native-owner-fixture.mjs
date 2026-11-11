/**
 * FREE Docker fixture: actual original R323 owner prebind, Linux UID 1001.
 * A Backend A2A specialist runs under UID 1002 and its own group.
 *
 * Root/Coordinator/Child/Gateway RETURN OFFLINE FIXTURES, NOT cryptographic
 * Rust/Engineer evidence. No real Gemini, GitHub, Gitea or provider effects.
 * This file is not a paid, production, or launchable user entrypoint.
 */
import {startDisposableOwnerModelIpcServer}
 from "../src/disposable-gemini-owner-worker-ipc.mjs";
import {createDisposableOriginalNativeIpcTaskAdmission}
 from "../src/disposable-gemini-original-ipc-task-admission.mjs";
import {TrustedAuthorityOnlyRemoteEffectOwner}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-remote-effect-owner.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../gateway/src/trusted-authority-only-admissions.ts";
import {canonicalFileUri}
 from "../../gateway/src/canonical.ts";
import {DeterministicA2AOrchestrator}
 from "../../../packages/agent-runtime/src/orchestrator.ts";
import {
 TrustedOwnerEffectStagingRegistry,
 createTrustedOwnerEffectStagingServer,
 connectTrustedEffectAgentBindingClient
} from "../../../packages/agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

const conf=JSON.parse(process.argv[2]??"null");
const scope=JSON.parse(process.argv[3]??"null");
if(process.platform!=="linux"||process.getuid?.()!==1001||
   conf?.role!=="backend"||scope?.role!=="backend"||
   scope.ownerUid!==1001||scope.workerUid!==1002||
   scope.roleGid!==2301||process.env.GEMINI_API_KEY||
   process.env.GOOGLE_API_KEY||process.env.GITHUB_TOKEN||
   process.env.DELEGATION_DISPOSABLE_LIVE_MODE)
 throw Error("offline original R323 cross-UID owner NO-GO");

const role="backend",taskId="original-real-crossuid-native-task-01";
const runtimeTaskId="dispatch_"+"N".repeat(22);
const branch="feature/account-suspension";
const file="apps/backend/account.ts";
const repository={authority:"gitea.local",owner:"thesis",
 repository:"iam-console-poc"};
const permission={resource:canonicalFileUri(repository,branch,file),
 operation:"read_file"};
const root={
 session_id:conf.task.session_id,repository,branch,
 authority_digest:"a".repeat(64),root_credential_id:"synthetic-rust-root",
 base_revision:"b".repeat(40),requirement_sha256:"c".repeat(64),
 engineer_did:"did:thesis:engineer",
 expires_at:new Date(Date.now()+60000).toISOString(),
 root_expires_at:new Date(Date.now()+60000).toISOString(),
 root_permissions:[permission]
};
const row={
 status:"task_registered_preflight_only",
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:role,agent_did:"did:thesis:backend-agent",
 card_ref:"trusted:backend",depends_on:[],permissions:[permission],
 root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,
 execution_authorized:false,child_credential_issued:false,
 gateway_registered:false
};
const child={
 status:"native_child_response_verified_staged",session_id:root.session_id,
 task_id:taskId,epoch:1,agent_id:role,agent_did:row.agent_did,
 root_credential_id:root.root_credential_id,
 credential_id:"urn:offline:original-child:crossuid-backend",
 authority_digest:root.authority_digest,permissions:[permission],
 status_list_credential:"status",status_list_index:"0",
 expires_at:new Date(Date.now()+60000).toISOString(),
 gateway_execution_authorized:false
};
const gatewayProof={
 status:"gateway_owner_child_task_preflight_only",
 task_id:taskId,runtime_task_id:runtimeTaskId,
 agent_id:role,agent_did:row.agent_did,
 credential_id:child.credential_id,
 authority_digest:root.authority_digest,
 gateway_execution_authorized:false
};
const coordinator=Object.assign(Object.create(
 TrustedAuthorityOnlyExecutionCoordinator.prototype),{
 assertTrustedGatewayAuthorityBinding:()=>root,
 assertTrustedGatewayRegisteredTask:()=>row
});
Object.defineProperty(coordinator,"phase",{value:"active"});
const issuer=Object.assign(Object.create(
 TrustedAuthorityOnlyChildIssuer.prototype),{
 assertTrustedIssuedChild:()=>child
});
const gateway=Object.assign(Object.create(
 TrustedAuthorityOnlyGatewayAdmissions.prototype),{
 assertTrustedOwnerRemoteEffectBinding:()=>gatewayProof
});
Object.defineProperty(gateway,"phase",{value:"active"});
const ledger=createDisposableOriginalNativeIpcTaskAdmission({
 role,assertOriginalRootActive:()=>root
});
const registry=new TrustedOwnerEffectStagingRegistry();
let modelCalls=0,staged=0,prebound=false,fenced=false;
let owner,model,stage,finished=false;
const shutDown=async()=>{
 ledger.retireAll();
 const outcomes=await Promise.allSettled([
  stage?.close(),model?.close()
 ].filter(Boolean));
 if(outcomes.some(x=>x.status==="rejected"))process.exitCode=1;
};
process.once("SIGTERM",()=>void shutDown().then(()=>process.exit(process.exitCode??0),
 ()=>process.exit(1)));
try{
 model=await startDisposableOwnerModelIpcServer({
  role,socketPath:conf.modelSocketPath,secretFile:conf.modelSecretFile,
  originalScopedModelRole:scope,
  authorizeSignedTask:ledger.authorizeSignedTask,
  invokeModel:async()=>{
   modelCalls++;
   return {chunks:[{content:{role:"model",
    parts:[{text:"synthetic native-bound readonly response"}]},
    usageMetadata:{promptTokenCount:5,candidatesTokenCount:3,
     totalTokenCount:8}}],
    metered_calls_started:modelCalls, metered_total_tokens:modelCalls*8,
    owner_original_signed_task_verified_here:false,
    provider_billed_amount_verified:false,
    model_generated_source_proven:false};
  }
 });
 stage=await createTrustedOwnerEffectStagingServer({
  socketPath:conf.stageSocketPath,secretFile:conf.stageSecretFile,
  expectedRole:role,registry,originalScopedEffectRole:scope
 });
 await stage.start();
 process.stdout.write("READY\n");
}catch(error){
 await shutDown();
 throw error;
}
process.on("message",async message=>{
 if(message?.type!=="run"||finished)return;
 finished=true;
 try{
  if(message.agentBaseUrl!=="http://127.0.0.1:"+conf.port)
   throw Error("unapproved A2A endpoint");
  const binder=await connectTrustedEffectAgentBindingClient({
   socketPath:conf.bindSocketPath,secretFile:conf.bindSecretFile,
   expectedRole:role,originalScopedEffectRole:scope
  });
  owner=new TrustedAuthorityOnlyRemoteEffectOwner({
   coordinator,childIssuer:issuer,gateway,
   ownerStageRegistry:registry,agentBindingClient:binder
  });
  const receipt=await owner.bindRegisteredTask({
   taskId,runtimeTaskId,effectStager:{
    async stage(){staged++;throw Error("offline no provider effect");}
   }
  });
  ledger.bindOriginalReceipt(receipt,{maxCalls:1});
  prebound=true;
  const client=new DeterministicA2AOrchestrator({
   deadlineMs:15000,initialIntervalMs:30,maxIntervalMs:100
  });
  let a2aError="";
  try{
   await client.sendProtectedTask({
    agent_base_url:message.agentBaseUrl,
    subtask:{
     subtask_id:taskId,branch,
     instruction:"Read the approved file and report only observations",
     relevant_paths:[file],
     approved_file_permissions:[{path:file,operation:"read_file"}],
     approved_run_tests:false
    },
    delegation_evidence:{
     credential:"synthetic-offline-DC-no-real-signature",
     credential_id:child.credential_id,
     presenter_id:child.agent_did
    },
    trusted_gateway_task_id:runtimeTaskId
   });
  }catch(error){a2aError=String(error.message);}
  // Terminate the owner model authorization synchronously, BEFORE
  // awaiting the original remote bind fence.
  ledger.retireTask(runtimeTaskId);
  await owner.fence(runtimeTaskId);
  fenced=true;
  let replayDenied=false;
  try{
   await ledger.authorizeSignedTask({
    role,task:{task_id:taskId,runtime_task_id:runtimeTaskId,
     credential_id:child.credential_id,session_id:root.session_id},
    callId:"crossuid-after-native-fence-01"
   });
  }catch(error){
   replayDenied=String(error.message).includes("Task admission NO-GO");
  }
  process.send?.({type:"result",report:{
   ownerUid:process.getuid(),workerUid:scope.workerUid,
   prebound,fenced,replayDenied,modelCalls,staged,
   a2aIncomplete:a2aError.includes("without completion"),
   syntheticRootOnly:true,paidInference:false
  }});
 }catch(error){
  ledger.retireAll();
  if(owner)await owner.fence(runtimeTaskId).catch(()=>{});
  process.send?.({type:"failure",error:String(error.stack??error).slice(0,1200)});
 }
});
