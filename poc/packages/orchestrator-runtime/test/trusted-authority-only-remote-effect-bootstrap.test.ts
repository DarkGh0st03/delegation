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
   phase:"active",assertTrustedGatewayAuthorityBinding:()=>root,
   assertTrustedGatewayRegisteredTask:()=>row
  });
 const issuer=Object.assign(Object.create(
  TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:()=>options?.badChild
    ?{...child,credential_id:"urn:forged:child"}:child
  });
 const gateway=Object.assign(Object.create(
  TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   phase:"active",assertTrustedOwnerRemoteEffectBinding:()=>gatewayProof
  });
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
