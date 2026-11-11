import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {TrustedAuthorityOnlyRemoteEffectBootstrap}
 from "../src/trusted-authority-only-remote-effect-bootstrap.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {
 TrustedEffectStagingTaskRegistry,createTrustedEffectAgentBindingServer,
 connectTrustedOwnerEffectStagingClient
} from "../../agent-runtime/src/index.ts";
import type {AgentTaskContext}
 from "../../agent-runtime/src/contracts.ts";

const taskId="r324-backend",runtimeTaskId="dispatch_"+"U".repeat(22);
const branch="feature/account-suspension";
const path="apps/backend/src/users/account.ts";
const repo={authority:"gitea.local",owner:"thesis",
 repository:"iam-console-poc"};
const permission={resource:canonicalFileUri(repo,branch,path),
 operation:"update_file" as const};
const root={session_id:"session-r324",repository:repo,branch,
 authority_digest:"a".repeat(64),
 root_credential_id:"root-r324",
 base_revision:"b".repeat(40),requirement_sha256:"c".repeat(64),
 engineer_did:"did:thesis:engineer",
 expires_at:new Date(Date.now()+60000).toISOString(),
 root_expires_at:new Date(Date.now()+60000).toISOString(),
 root_permissions:[permission]};
const row={status:"task_registered_preflight_only" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,agent_id:"backend",
 agent_did:"did:thesis:backend-agent",card_ref:"trusted:backend",
 depends_on:[],permissions:[permission],root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,execution_authorized:false as const,
 child_credential_issued:false as const,gateway_registered:false as const};
const child={status:"native_child_response_verified_staged" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:row.agent_did,
 root_credential_id:root.root_credential_id,credential_id:"urn:r324:child",
 authority_digest:root.authority_digest,permissions:[permission],
 status_list_credential:"status",status_list_index:"0",
 expires_at:new Date(Date.now()+60000).toISOString(),
 gateway_execution_authorized:false as const};
const gatewayProof={status:"gateway_owner_child_task_preflight_only" as const,
 task_id:taskId,runtime_task_id:runtimeTaskId,agent_id:"backend",
 agent_did:row.agent_did,credential_id:child.credential_id,
 authority_digest:root.authority_digest,
 gateway_execution_authorized:false as const};
const context=():AgentTaskContext=>({
 task_id:"r324-a2a-task",context_id:"r324-context",role:"backend",
 trusted_gateway_task_id:runtimeTaskId,
 subtask:{subtask_id:taskId,branch,
  instruction:"Update authorized file",relevant_paths:[path],
  approved_file_permissions:[{path,operation:"update_file"}],
  approved_run_tests:false},
 delegation_evidence:{credential:"PRIVATE_CHILD_NOT_TO_MODEL",
  credential_id:child.credential_id,presenter_id:child.agent_did}
});

async function fixture(options?:{remoteBindFailure?:boolean;
 badChild?:boolean;sameKeys?:boolean}){
 const dir=await mkdtemp(join(tmpdir(),"r324-"));
 const bindSecret=join(dir,"bind.hex"),stageSecret=join(dir,"stage.hex");
 const a=randomBytes(32).toString("hex");
 await writeFile(stageSecret,a+"\n",{mode:0o600,flag:"wx"});
 await writeFile(bindSecret,
  (options?.sameKeys?a:randomBytes(32).toString("hex"))+"\n",
  {mode:0o600,flag:"wx"});
 const bindSocket=join(dir,"bind.sock"),stageSocket=join(dir,"stage.sock");
 const agentRegistry=new TrustedEffectStagingTaskRegistry();
 const coordinator=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:()=>root,
   assertTrustedGatewayRegisteredTask:()=>row
  });
 Object.defineProperty(coordinator,"phase",{value:"active"});
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:()=>options?.badChild
    ?{...child,credential_id:"urn:forged:child"}:child
  });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   assertTrustedOwnerRemoteEffectBinding:()=>gatewayProof
  });
 Object.defineProperty(gateway,"phase",{value:"active"});
 const server=await createTrustedEffectAgentBindingServer({
  socketPath:bindSocket,secretFile:bindSecret,
  registry:agentRegistry,
  ownerStageClient:{
   async stage(rt:string,req:string){
    const owner=await connectTrustedOwnerEffectStagingClient({
     socketPath:stageSocket,secretFile:stageSecret});
    await owner.stage(rt,req);
   }
  }
 });
 if(!options?.remoteBindFailure)await server.start();
 const config={coordinator,childIssuer:issuer,gateway,
  stageSocketPath:stageSocket,stageSecretFile:stageSecret,
  agentBindingSocketPath:bindSocket,agentBindingSecretFile:bindSecret};
 let host:TrustedAuthorityOnlyRemoteEffectBootstrap|undefined;
 const start=async()=>host=await TrustedAuthorityOnlyRemoteEffectBootstrap.start(
  config as never);
 const close=async()=>{
  try{await host?.close();}finally{
   await server.close();
   await rm(dir,{recursive:true,force:true});
  }
 };
 return {dir,agentRegistry,start,close,config};
}
test("R324 owner startup binds one native-proven Task through real private sockets and fences after A2A",async()=>{
 const x=await fixture();
 try{
  const owner=await x.start(),calls:string[]=[];
  const result=await owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async req=>{
    calls.push("owner_stage:"+req);
   }},
   dispatch:async()=>{
    const effect=x.agentRegistry.selectFor(context());
    await effect.stage("r324-request-001");
    calls.push("agent_completed");
    return {status:"a2a-dispatched-not-evidence"};
   }
  });
  assert.deepEqual(result,{status:"a2a-dispatched-not-evidence"});
  assert.deepEqual(calls,["owner_stage:r324-request-001","agent_completed"]);
  assert.throws(()=>x.agentRegistry.selectFor(context()),/already dispatched/u);
  await assert.rejects(owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async()=>{}},
   dispatch:async()=>null
  }),/duplicate or invalid owner dispatch/u);
 }finally{await x.close();}
});
test("R324 wrong native Child denies remote binding before running A2A",async()=>{
 const x=await fixture({badChild:true});
 try{
  const owner=await x.start();
  let called=false;
  await assert.rejects(owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async()=>{called=true;}},
   dispatch:async()=>{called=true;}
  }),/Coordinator, native Child and Gateway disagree/u);
  assert.equal(called,false);
  assert.throws(()=>x.agentRegistry.selectFor(context()),/not prebound/u);
 }finally{await x.close();}
});
test("R324 missing agent binding socket is a terminal one-shot denial",async()=>{
 const x=await fixture({remoteBindFailure:true});
 try{
  const owner=await x.start();
  await assert.rejects(owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async()=>{}},
   dispatch:async()=>{throw Error("must not dispatch");}
  }));
  await assert.rejects(owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async()=>{}},
   dispatch:async()=>null
  }),/duplicate or invalid owner dispatch/u);
 }finally{await x.close();}
});
test("R324 closed owner fences even a task currently in a blocked A2A callback",async()=>{
 const x=await fixture();
 try{
  const owner=await x.start();
  let entered!:()=>void,release!:()=>void;
  const hasEntered=new Promise<void>(resolve=>entered=resolve);
  const suspended=new Promise<void>(resolve=>release=resolve);
  const attempt=owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async()=>{
    throw Error("effect must remain fenced");
   }},
   dispatch:async()=>{
    entered();
    await suspended;
    const effect=x.agentRegistry.selectFor(context());
    await effect.stage("r324-too-late");
   }
  });
  await hasEntered;
  await owner.close();
  release();
  await assert.rejects(attempt,/NO-GO|not prebound|retired|already dispatched/u);
 }finally{await x.close();}
});
test("R324 identical IPC keys are denied before staging listener startup",async()=>{
 const x=await fixture({sameKeys:true});
 try{
  await assert.rejects(x.start(),/stage and bind HMAC keys must differ/u);
 }finally{await x.close();}
});

test("R324 explicit cancellation fences a Task before a suspended A2A callback can stage",async()=>{
 const x=await fixture();
 try{
  const owner=await x.start();
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve);
  const pending=new Promise<void>(resolve=>release=resolve);
  const attempt=owner.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{stage:async()=>{
    throw Error("a cancelled Task must never reach the owner port");
   }},
   dispatch:async()=>{
    entered();
    await pending;
    const port=x.agentRegistry.selectFor(context());
    await port.stage("r324-after-cancel");
   }
  });
  await started;
  await owner.cancelTask(runtimeTaskId);
  release();
  await assert.rejects(attempt,/already dispatched|retired|NO-GO/u);
 }finally{await x.close();}
});

test("R324 original native prebind callback binds role-specific model calls and retires them BEFORE private native fence",async()=>{
 const {createDisposableOriginalNativeIpcTaskAdmission}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-original-ipc-task-admission.mjs");
 const x=await fixture();
 try{
  const host=await x.start();
  const ledger=createDisposableOriginalNativeIpcTaskAdmission({
   role:"backend",assertOriginalRootActive:()=>root
  });
  let admittedBeforeDispatch=false;
  const actual={task_id:taskId,runtime_task_id:runtimeTaskId,
   session_id:root.session_id,credential_id:child.credential_id};
  const result=await host.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{async stage(){}},
   onNativeOriginalTaskPrebound:receipt=>{
    ledger.bindOriginalReceipt(receipt,{maxCalls:1});
    admittedBeforeDispatch=ledger.boundTaskCount===1;
    return ()=>ledger.retireTask(runtimeTaskId);
   },
   dispatch:async()=>{
    assert.equal(await ledger.authorizeSignedTask({
     role:"backend",task:actual,callId:"r324-original-model-call-001"
    }),true);
    return "original-dispatch-completed";
   }
  });
  assert.equal(result,"original-dispatch-completed");
  assert.equal(admittedBeforeDispatch,true);
  await assert.rejects(ledger.authorizeSignedTask({
   role:"backend",task:actual,callId:"r324-original-model-call-002"
  }),/Disposable original signed IPC Task admission NO-GO/u);
 }finally{await x.close();}
});
test("R324 a failed original model prebind callback cannot dispatch A2A or retry signed Child",async()=>{
 const x=await fixture();
 try{
  const host=await x.start();
  let a2aCalled=false;
  await assert.rejects(host.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{async stage(){}},
   onNativeOriginalTaskPrebound:()=>{
    throw Error("no model IPC admission available");
   },
   dispatch:async()=>{a2aCalled=true;}
  }),/no model IPC admission available/u);
  assert.equal(a2aCalled,false);
  await assert.rejects(host.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{async stage(){}},
   dispatch:async()=>{a2aCalled=true;}
  }),/duplicate or invalid owner dispatch/u);
 }finally{await x.close();}
});

test("same original Stage Bind and model HMAC RPC consume one prebound Child fixture (zero inference)",async()=>{
 // This is a single free, same-session three-direction Unix socket test.
 // Root/Child/Gateway are offline fixtures; no Rust signer, paid model,
 // real provider effects or proof of cross-UID isolation.
 const {createDisposableOriginalNativeIpcTaskAdmission}=await import(
  "../../../apps/orchestrator/src/disposable-gemini-original-ipc-task-admission.mjs");
 const {startDisposableOwnerModelIpcServer,
  connectDisposableWorkerModelIpcClient}=await import(
   "../../../apps/orchestrator/src/disposable-gemini-owner-worker-ipc.mjs");
 const x=await fixture();
 let modelServer:Awaited<ReturnType<typeof startDisposableOwnerModelIpcServer>>|undefined;
 try{
  const socketPath=join(x.dir,"model.sock");
  const secretFile=join(x.dir,"model.hex");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
  const gate=createDisposableOriginalNativeIpcTaskAdmission({
   role:"backend",assertOriginalRootActive:()=>root
  });
  let modelInvocations=0;
  modelServer=await startDisposableOwnerModelIpcServer({
   role:"backend",socketPath,secretFile,
   authorizeSignedTask:gate.authorizeSignedTask,
   // The real R323 one-use prebind runs against offline Root/Child fixtures.
   invokeModel:async({role,task,payload}:{
    role:string;task:{runtime_task_id:string};payload:{contents:unknown[]}
   })=>{
    assert.equal(role,"backend");
    assert.equal(task.runtime_task_id,runtimeTaskId);
    assert.equal(payload.contents.length,1);
    modelInvocations++;
    return {
     chunks:[{content:{role:"model",parts:[{text:"offline-only-answer"}]}}],
     metered_calls_started:modelInvocations,
     metered_total_tokens:12*modelInvocations,
     owner_original_signed_task_verified_here:false,
     provider_billed_amount_verified:false,
     model_generated_source_proven:false
    };
   }
  });
  const worker=await connectDisposableWorkerModelIpcClient({
   role:"backend",socketPath,secretFile
  });
  const host=await x.start();
  const claim={task_id:taskId,runtime_task_id:runtimeTaskId,
   session_id:root.session_id,credential_id:child.credential_id};
  const payload={contents:[{role:"user",parts:[{text:"read signed task only"}]}]};
  let prebound=0,staged=0;
  const result=await host.dispatchApprovedTask({
   taskId,runtimeTaskId,effectStager:{
    async stage(){staged++;}
   },
   onNativeOriginalTaskPrebound:receipt=>{
    prebound++;
    gate.bindOriginalReceipt(receipt,{maxCalls:1});
    return ()=>gate.retireTask(runtimeTaskId);
   },
   dispatch:async()=>{
    // Dispatch starts only AFTER the original owner Stage+Bind ACK;
    // the role HMAC alone cannot authorize model execution.
    const response=await worker.call({task:claim,
     callId:"r324-authenticated-model-call-001",payload});
    const port=x.agentRegistry.selectFor(context());
    await port.stage("r324-authorized-model-stage-001");
    return response;
   }
  });
  assert.equal(prebound,1);
  assert.equal(modelInvocations,1);
  assert.equal(staged,1);
  assert.equal(result.chunks[0].content.parts[0].text,"offline-only-answer");
  assert.equal(gate.boundTaskCount,1);
  // The R324 model gate is fenced on terminal A2A dispatch. Its second
  // call cannot be replayed under the previously approved Child/Root.
  await assert.rejects(worker.call({task:claim,
   callId:"r324-authenticated-model-call-002",payload}),
   /Disposable owner-worker model IPC NO-GO/u);
  assert.equal(modelInvocations,1);
 }finally{
  await modelServer?.close();
  await x.close();
 }
});
