/**
 * R333 — three physical HMAC staging channels, one Coordinator/root and
 * one owner registry.  The local origin of a stage request is pinned
 * by its socket's owner-issued key, never by A2A or its JSON body.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
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

const roles=["backend","frontend","test"] as const;
type Role=(typeof roles)[number];
const branch="feature/account-suspension";
const taskId="r333-backend-task",runtimeTaskId="dispatch_"+"Z".repeat(22);
const file="apps/backend/src/users/account.ts";
const repository={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const permission={resource:canonicalFileUri(repository,branch,file),
 operation:"update_file" as const};
const root={
 session_id:"r333-session",repository,branch,
 authority_digest:"a".repeat(64),root_credential_id:"r333-root",
 base_revision:"b".repeat(40),requirement_sha256:"c".repeat(64),
 engineer_did:"did:thesis:engineer",
 expires_at:new Date(Date.now()+180000).toISOString(),
 root_expires_at:new Date(Date.now()+180000).toISOString(),
 root_permissions:[permission]
};
const row={
 status:"task_registered_preflight_only" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,agent_id:"backend",
 agent_did:"did:thesis:backend-agent",card_ref:"trusted:backend",
 depends_on:[],permissions:[permission],
 root_credential_id:root.root_credential_id,
 authority_digest:root.authority_digest,
 execution_authorized:false as const,child_credential_issued:false as const,
 gateway_registered:false as const
};
const child={
 status:"native_child_response_verified_staged" as const,
 session_id:root.session_id,task_id:taskId,epoch:1,
 agent_id:"backend",agent_did:row.agent_did,
 root_credential_id:root.root_credential_id,
 credential_id:"urn:r333:child:backend",
 authority_digest:root.authority_digest,permissions:[permission],
 status_list_credential:"https://issuer.invalid/r333",
 status_list_index:"3",
 expires_at:new Date(Date.now()+180000).toISOString(),
 gateway_execution_authorized:false as const
};
const gatewayProof={
 status:"gateway_owner_child_task_preflight_only" as const,
 task_id:taskId,runtime_task_id:runtimeTaskId,agent_id:"backend",
 agent_did:row.agent_did,credential_id:child.credential_id,
 authority_digest:root.authority_digest,
 gateway_execution_authorized:false as const
};
const task=()=>({
 task_id:"r333-a2a-task",context_id:"r333-context",
 role:"backend" as const,trusted_gateway_task_id:runtimeTaskId,
 subtask:{subtask_id:taskId,branch,
  instruction:"Change one owner approved Backend file",
  relevant_paths:[file],approved_file_permissions:[{
   path:file,operation:"update_file" as const
  }],approved_run_tests:false},
 delegation_evidence:{credential:"R333_FIXTURE_NOT_A_NATIVE_DC",
  credential_id:child.credential_id,presenter_id:child.agent_did}
});
async function setup(extra=false){
 const activeRoles=extra?[...roles,"reviewer"] as const:roles;
 const readOnly=extra?{...permission,operation:"read_file" as const}:permission;
 const reviewerDid="did:thesis:reviewer-agent";
 const rootFor=extra?{...root,root_permissions:[readOnly]}:root;
 const rowFor=extra?{...row,agent_id:"reviewer",agent_did:reviewerDid,
  permissions:[readOnly]}:row;
 const childFor=extra?{...child,agent_id:"reviewer",agent_did:reviewerDid,
  permissions:[readOnly]}:child;
 const receiptFor=extra?{...gatewayProof,agent_id:"reviewer",agent_did:reviewerDid}:gatewayProof;
 const dir=await mkdtemp(join(tmpdir(),"r333-"));
 const stageChannels={} as Record<string,{socketPath:string;secretFile:string}>;
 const agentBindingChannels={} as Record<string,{socketPath:string;secretFile:string}>;
 const registries={} as Record<string,TrustedEffectStagingTaskRegistry>;
 const bindServers:Awaited<ReturnType<typeof createTrustedEffectAgentBindingServer>>[]=[];
 let host:TrustedAuthorityOnlyRemoteEffectBootstrap|undefined;
 const coord=Object.assign(Object.create(
  TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:()=>rootFor,
   assertTrustedGatewayRegisteredTask:()=>rowFor
  });
 Object.defineProperty(coord,"phase",{value:"active"});
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:()=>childFor
  });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   assertTrustedOwnerRemoteEffectBinding:()=>receiptFor
  });
 Object.defineProperty(gateway,"phase",{value:"active"});
 try{
  for(const role of activeRoles){
   const sc={socketPath:join(dir,role+"-stage.sock"),
    secretFile:join(dir,role+"-stage.hex")};
   const bc={socketPath:join(dir,role+"-bind.sock"),
    secretFile:join(dir,role+"-bind.hex")};
   stageChannels[role]=sc;agentBindingChannels[role]=bc;
   for(const p of [sc.secretFile,bc.secretFile])
    await writeFile(p,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
  }
  const config={
   coordinator:coord,childIssuer:issuer,gateway,
   agentBindingChannels,stageChannels
  };
  const startBind=async()=>{
   for(const role of activeRoles){
    const reg=new TrustedEffectStagingTaskRegistry();
    registries[role]=reg;
    const ownerStageClient=await connectTrustedOwnerEffectStagingClient(
     stageChannels[role]
    );
    const bindServer=await createTrustedEffectAgentBindingServer({
     ...agentBindingChannels[role],registry:reg,
     ownerStageClient,expectedRole:role
    });
    bindServers.push(bindServer);
    await bindServer.start();
   }
  };
  const close=async()=>{
   await host?.close();
   await Promise.allSettled(bindServers.reverse().map(b=>b.close()));
   await rm(dir,{recursive:true,force:true});
  };
  return {dir,stageChannels,agentBindingChannels,registries,
   activeRoles,config,startBind,start:async()=>host=await
    TrustedAuthorityOnlyRemoteEffectBootstrap.start(config as never),
   close
  };
 }catch(error){
  await Promise.allSettled(bindServers.map(s=>s.close()));
  await rm(dir,{recursive:true,force:true});
  throw error;
 }
}
test("R333 Backend can stage once through its own HMAC socket; Frontend/Test authenticated stages deny without burning Backend slot",async()=>{
 const f=await setup();
 try{
  await f.startBind();
  const host=await f.start();
  const stages=Object.fromEntries(await Promise.all(roles.map(
   async role=>[role,await connectTrustedOwnerEffectStagingClient(
    f.stageChannels[role])]))) as Record<Role,
     Awaited<ReturnType<typeof connectTrustedOwnerEffectStagingClient>>>;
  const calls:string[]=[];
  const requestId="req_12345678-1234-4123-8123-1234567890ab";
  const result=await host.dispatchApprovedTask({
   taskId,runtimeTaskId,
   effectStager:{stage:async id=>{calls.push(id);}},
   dispatch:async()=>{
    for(const wrong of ["frontend","test"] as const){
     await assert.rejects(stages[wrong].stage(runtimeTaskId,requestId),
      /Authenticated private effect operation denied/u);
     assert.deepEqual(calls,[]);
    }
    const wrongKey=await connectTrustedOwnerEffectStagingClient({
     socketPath:f.stageChannels.backend.socketPath,
     secretFile:f.stageChannels.frontend.secretFile
    });
    await assert.rejects(wrongKey.stage(runtimeTaskId,requestId),
     /Authenticated private effect operation denied/u);
    const selected=f.registries.backend.selectFor(task());
    assert.deepEqual(await selected.stage(requestId),
     {provider_write_authorized:false});
    return {status:"bound-without-provider-authority"};
   }
  });
  assert.deepEqual(result,{status:"bound-without-provider-authority"});
  assert.deepEqual(calls,[requestId]);
  await assert.rejects(stages.backend.stage(runtimeTaskId,requestId),
   /Authenticated private effect operation denied/u);
  assert.deepEqual(calls,[requestId]);
 }finally{await f.close();}
});
test("R333 startup rejects reused staging HMAC keys before it opens any staging socket",async()=>{
 const f=await setup();
 try{
  await writeFile(f.stageChannels.frontend.secretFile,
   await readFile(f.stageChannels.backend.secretFile));
  await assert.rejects(f.start(),
   /all role-pinned stage and bind HMAC keys must differ/u);
  // Wrong-key startup has no partially opened listener or effect slot.
  await assert.rejects(connectTrustedOwnerEffectStagingClient(
   f.stageChannels.backend).then(x=>x.stage(runtimeTaskId,"r333-no")),
   /ENOENT|connect ENOENT|private effect/u);
 }finally{await f.close();}
});
test("R333 cannot downgrade three-role staging to a partially specified shared socket",async()=>{
 const f=await setup();
 try{
  await f.startBind();
  await assert.rejects(
   TrustedAuthorityOnlyRemoteEffectBootstrap.start({
    ...f.config,stageSocketPath:f.stageChannels.backend.socketPath,
    stageSecretFile:f.stageChannels.backend.secretFile
   } as never),
   /exactly one legacy stage or three role-pinned stage/u);
  await assert.rejects(
   TrustedAuthorityOnlyRemoteEffectBootstrap.start({
    ...f.config,stageChannels:{backend:f.stageChannels.backend}
   } as never),
   /exactly one legacy stage or three role-pinned stage/u);
 }finally{await f.close();}
});

test("Owner-provisioned fourth read-only specialist has a distinct signed HMAC route",async()=>{
 const f=await setup(true);
 try{
  await f.startBind();
  const owner=await f.start();
  const foreign=await connectTrustedOwnerEffectStagingClient(f.stageChannels.backend);
  const nativeRead=await connectTrustedOwnerEffectStagingClient(f.stageChannels.reviewer);
  let staged=0;
  const requestId="req_reviewer_native_read";
  const result=await owner.dispatchApprovedTask({
   taskId,runtimeTaskId,
   effectStager:{stage:async id=>{
    assert.equal(id,requestId);
    staged++;
    return {provider_write_authorized:false};
   }},
   dispatch:async()=>{
    await assert.rejects(foreign.stage(runtimeTaskId,requestId),
     /Authenticated private effect operation denied/u);
    assert.equal(staged,0);
    const original=task();
    const context={...original,role:"reviewer",
     subtask:{...original.subtask,approved_file_permissions:[
      {path:file,operation:"read_file" as const}
     ]},
     delegation_evidence:{...original.delegation_evidence,
      presenter_id:"did:thesis:reviewer-agent"}
    };
    const selected=f.registries.reviewer.selectFor(context as never);
    assert.deepEqual(await selected.stage(requestId),
     {provider_write_authorized:false});
    await assert.rejects(nativeRead.stage(runtimeTaskId,requestId),
     /Authenticated private effect operation denied/u);
    return {bound:"reviewer",attestedProviderEffect:false};
   }
  });
  assert.deepEqual(result,{bound:"reviewer",attestedProviderEffect:false});
  assert.equal(staged,1);
 }finally{await f.close();}
});
test("Extra private binder without the matching per-role staging channel is denied",async()=>{
 const f=await setup(true);
 try{
  const stageChannels={...f.stageChannels};
  delete stageChannels.reviewer;
  await assert.rejects(TrustedAuthorityOnlyRemoteEffectBootstrap.start({
   ...f.config,stageChannels
  } as never),/exactly one legacy stage or three role-pinned stage/u);
 }finally{await f.close();}
});
