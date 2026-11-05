/**
 * R328: three real A2A HTTP agents, three actual scripted Google ADK
 * LlmAgent/Runner instances, three role-pinned owner->agent HMAC channels,
 * one owner authority/staging socket, and independent completion gates.
 *
 * Rust credentials, Gateway HTTP/OPA/provider outcomes are fixtures here:
 * this is an offline transport/authorization-shape proof, NOT native E2E.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm,type LlmRequest,type LlmResponse,type BaseLlmConnection}
 from "@google/adk";
import {createServer} from "node:net";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {
 TrustedEffectStagingTaskRegistry,
 createTrustedEffectAgentBindingServer,
 connectTrustedOwnerEffectStagingClient,
 connectTrustedEffectAgentBindingClient
} from "../../agent-runtime/src/index.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {canonicalFileUri,canonicalBranchUri}
 from "../../../apps/gateway/src/canonical.ts";
import type {SpecializedAgentRole}
 from "../../agent-runtime/src/contracts.ts";

const roles=["backend","frontend","test"] as const;
type Role=(typeof roles)[number];
const branch="feature/account-suspension";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const PATHS={
 backend:"apps/backend/src/users/account.ts",
 frontend:"apps/frontend/src/pages/UserDetailPage.tsx"
} as const;
const contents={
 backend:"export const accountSuspended=true;\n",
 frontend:"export const pendingActions=[];\n"
} as const;
const SHAS={
 backend:"b".repeat(40),frontend:"c".repeat(40),test:"c".repeat(40)
} as const;
const configs=Object.fromEntries(roles.map((role,i)=>{
 const taskId="r328-"+role;
 const runtimeTaskId="dispatch_"+(i+1).toString().repeat(22);
 const did="did:thesis:"+role+"-agent";
 const credentialId="urn:r328:child:"+role;
 const permission=role==="test"
  ?{resource:canonicalBranchUri(repo,branch),operation:"run_tests"}
  :{resource:canonicalFileUri(repo,branch,PATHS[role]),
    operation:"update_file"};
 return [role,{role,taskId,runtimeTaskId,did,credentialId,
  permission,requestId:"r328-request-"+role,
  vp:"R328_PRIVATE_VP_"+role,
  secret:"R328_PRIVATE_SIGNER_"+role,
  path:role==="test"?undefined:PATHS[role],
  dependsOn:i===0?[]:[roles[i-1]+"-task"]
 }];
})) as Record<Role,{
 role:Role;taskId:string;runtimeTaskId:string;did:string;
 credentialId:string;permission:{resource:string;operation:string};
 requestId:string;vp:string;secret:string;path?:string;dependsOn:string[]
}>;
const root={
 session_id:"r328-session",repository:repo,branch,
 authority_digest:"e".repeat(64),root_credential_id:"r328-root",
 base_revision:"a".repeat(40),requirement_sha256:"f".repeat(64),
 engineer_did:"did:thesis:engineer",
 root_expires_at:new Date(Date.now()+180_000).toISOString(),
 expires_at:new Date(Date.now()+180_000).toISOString(),
 root_permissions:roles.map(r=>configs[r].permission)
};
class ScriptedAgent extends BaseLlm{
 readonly requests:LlmRequest[]=[];
 constructor(readonly role:Role){super({model:"r328-scripted-"+role+"-no-api"});}
 override async *generateContentAsync(req:LlmRequest):
 AsyncGenerator<LlmResponse,void>{
  this.requests.push(req);
  if(this.requests.length===1){
   const action=configs[this.role];
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r328-"+this.role,name:this.role==="test"?"run_tests":"update_file",
    args:this.role==="test"?{branch,profile:"poc-default"}:
     {branch,path:action.path,content:contents[this.role as "backend"|"frontend"]}
   }}]}};
  }else yield {content:{role:"model",parts:[{
   text:"Completed one owner-bound operation"
  }]}};
 }
 override connect(_request:LlmRequest):Promise<BaseLlmConnection>{
  return Promise.reject(Error("No paid model transport in R328"));
 }
}
async function port():Promise<number>{
 const s=createServer();
 await new Promise<void>((ok,bad)=>{
  s.once("error",bad);s.listen(0,"127.0.0.1",ok);
 });
 const addr=s.address();
 if(!addr||typeof addr==="string")throw Error("no A2A port");
 await new Promise<void>((ok,bad)=>s.close(e=>e?bad(e):ok()));
 return addr.port;
}
function roleFromRequestId(id:string):Role{
 const role=roles.find(r=>configs[r].requestId===id);
 if(!role)throw Error("foreign Gateway request_id");
 return role;
}
test("R328 Backend -> Frontend -> Test: independent ADK/A2A agents, per-role binding and staged completion",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"r328-"));
 const stageSecret=join(dir,"owner.hex"),stageSocket=join(dir,"owner.sock");
 await writeFile(stageSecret,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 const binds={} as Record<Role,{socketPath:string;secretFile:string}>;
 const registries={} as Record<Role,TrustedEffectStagingTaskRegistry>;
 const agents={} as Record<Role,Awaited<ReturnType<typeof startSpecializedAgentServer>>>;
 const models={} as Record<Role,ScriptedAgent>;
 const bindingServers:Awaited<ReturnType<typeof createTrustedEffectAgentBindingServer>>[]=[];
 const events:string[]=[];
 const staged=new Set<Role>(),completed=new Set<Role>();
 const transferred=new Set<Role>();
 let owner:Awaited<ReturnType<typeof startTrustedAuthorityOnlySdkA2AOwner>>|undefined;
 const rootAuthority=()=>root;
 try{
  const ownerStage=await connectTrustedOwnerEffectStagingClient({
   socketPath:stageSocket,secretFile:stageSecret
  });
  for(const role of roles){
   const secretFile=join(dir,role+".hex");
   const socketPath=join(dir,role+".sock");
   await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
    {mode:0o600,flag:"wx"});
   binds[role]={socketPath,secretFile};
   registries[role]=new TrustedEffectStagingTaskRegistry();
   const binding=await createTrustedEffectAgentBindingServer({
    socketPath,secretFile,registry:registries[role],
    ownerStageClient:ownerStage,expectedRole:role
   });
   await binding.start();bindingServers.push(binding);
   models[role]=new ScriptedAgent(role);
   const fetchFn=(async(url:unknown,opts?:RequestInit)=>{
    const target=String(url);
    const body=JSON.parse(String(opts?.body));
    const c=configs[role];
    if(target.endsWith("/v1/authorization/prepare")){
     events.push("prepare:"+role);
     const operation=role==="test"?"run_tests":"update_file";
     assert.equal(body.task_id,c.runtimeTaskId);
     assert.equal(body.agent_role,role);
     assert.equal(body.tool,operation);
     assert.equal(body.arguments.branch,branch);
     if(role==="test")assert.equal(body.arguments.profile,"poc-default");
     else{
      assert.equal(body.arguments.path,c.path);
      assert.equal(body.arguments.content,contents[role as "backend"|"frontend"]);
     }
     return Response.json({
      request_id:c.requestId,audience:"cloud-access-gateway",
      challenge:"challenge-"+role,
      expires_at:new Date(Date.now()+60_000).toISOString(),
      required_permission:c.permission
     },{status:201});
    }
    if(target.endsWith("/v1/presentations")){
     events.push("vp:"+role);
     assert.equal(new Headers(opts?.headers).get("authorization"),
      "Bearer "+c.secret);
     assert.equal(body.credential_id,c.credentialId);
     assert.equal(body.challenge,"challenge-"+role);
     assert.deepEqual(body.disclosed_permissions,[c.permission]);
     return Response.json({signed_vp:c.vp});
    }
    if(target.endsWith("/v1/authorization/execute")){
     events.push("execute:"+role);
     assert.equal(body.request_id,c.requestId);
     assert.equal(body.signed_vp,c.vp);
     assert.ok(staged.has(role),"owner staging before Gateway execute");
     return Response.json({
      request_id:c.requestId,decision:"allow",
      execution:role==="test"?{
       provider:"docker-runner",performed:true,tool:"run_tests",
       status:"pass",tested_commit_sha:SHAS.test,
       runner_profile:"poc-default",project_tests:"pass",
       researcher_acceptance:"pass"
      }:{
       provider:"gitea",performed:true,tool:"update_file",
       branch,path:c.path,commit_sha:SHAS[role]
      }
     });
    }
    throw Error("Forbidden R328 service "+target);
   }) as typeof fetch;
   agents[role]=await startSpecializedAgentServer({
    role,port:await port(),host:"127.0.0.1",
    capabilityProfile:"approved-plan",delegatedAuthorization:true,
    adk:{model:models[role],gatewayBaseUrl:"http://gateway.r328.invalid",
     adapterBaseUrl:"http://signer.r328.invalid",adapterToken:c.secret,
     fetchFn,scopeModelPaths:true,maxModelTurns:4,maxModelCallMs:5000,
     trustedEffectTaskRegistry:registries[role]}
   });
  }
  const coordinator=Object.assign(Object.create(
   TrustedAuthorityOnlyExecutionCoordinator.prototype),{
   assertTrustedGatewayAuthorityBinding:rootAuthority,
   assertTrustedGatewayRegisteredTask:(taskId:string)=>{
    const role=roles.find(r=>configs[r].taskId===taskId);
    if(!role)throw Error("unknown signed Task");
    const idx=roles.indexOf(role);
    if(idx>0&&!completed.has(roles[idx-1]!))
     throw Error("dependent Task has no independent Gateway completion");
    const c=configs[role];
    return {
     status:"task_registered_preflight_only",
     session_id:root.session_id,task_id:c.taskId,epoch:idx+1,
     agent_id:role,agent_did:c.did,card_ref:"trusted:"+role,
     depends_on:idx? [configs[roles[idx-1]!].taskId]:[],
     permissions:[c.permission],root_credential_id:root.root_credential_id,
     authority_digest:root.authority_digest,
     execution_authorized:false,child_credential_issued:false,
     gateway_registered:false
    };
   }
  });
  Object.defineProperty(coordinator,"phase",{value:"active"});
  const nativeChild=(role:Role)=>{
   const c=configs[role];
   return {status:"native_child_response_verified_staged",
    session_id:root.session_id,task_id:c.taskId,epoch:roles.indexOf(role)+1,
    agent_id:role,agent_did:c.did,
    root_credential_id:root.root_credential_id,
    credential_id:c.credentialId,
    authority_digest:root.authority_digest,permissions:[c.permission],
    status_list_credential:"https://status.invalid/r328",
    status_list_index:String(roles.indexOf(role)+1),
    expires_at:new Date(Date.now()+120_000).toISOString(),
    gateway_execution_authorized:false
   };
  };
  const issuer=Object.assign(Object.create(
   TrustedAuthorityOnlyChildIssuer.prototype),{
   assertTrustedIssuedChild:(taskId:string)=>{
    const role=roles.find(r=>configs[r].taskId===taskId);
    if(!role)throw Error("unknown native Child");
    return nativeChild(role);
   },
   takeTrustedIssuedChildCredential:(taskId:string)=>{
    const role=roles.find(r=>configs[r].taskId===taskId);
    if(!role||transferred.has(role))throw Error("signed Child replay");
    transferred.add(role);
    events.push("child:"+role);
    const c=configs[role],ch=nativeChild(role);
    return {"@context":["https://www.w3.org/ns/credentials/v2"],
     type:["VerifiableCredential","DelegationCredential"],
     id:c.credentialId,issuer:"did:thesis:rust",
     credentialSubject:{sub:c.did,per:[c.permission]},
     credentialStatus:{type:"BitstringStatusListEntry",
      statusPurpose:"revocation",
      statusListCredential:ch.status_list_credential,
      statusListIndex:ch.status_list_index},
     proof:{type:"Ed25519Signature2020",proofValue:"OFFLINE_ONLY"}
    };
   }
  });
  const gateway=Object.assign(Object.create(
   TrustedAuthorityOnlyGatewayAdmissions.prototype),{
   assertTrustedOwnerRemoteEffectBinding:(taskId:string,runtimeTaskId:string)=>{
    const role=roles.find(r=>configs[r].taskId===taskId);
    if(!role||runtimeTaskId!==configs[role].runtimeTaskId)
     throw Error("mismatched native Gateway child");
    const c=configs[role];
    return {status:"gateway_owner_child_task_preflight_only",
     task_id:taskId,runtime_task_id:runtimeTaskId,
     agent_id:role,agent_did:c.did,credential_id:c.credentialId,
     authority_digest:root.authority_digest,
     gateway_execution_authorized:false};
   },
   attestTrustedTaskCompletion:async(taskId:string,runtimeTaskId:string)=>{
    const role=roles.find(r=>configs[r].taskId===taskId);
    if(!role||configs[role].runtimeTaskId!==runtimeTaskId||
       !staged.has(role)||completed.has(role))
     throw Error("native Gateway observer lacks exact protected flight");
    events.push("attest:"+role);
    completed.add(role);
    return {status:"task_completion_observed_staged",task_id:taskId,
     runtime_task_id:runtimeTaskId,gateway_execution_authorized:false};
   }
  });
  Object.defineProperty(gateway,"phase",{value:"active"});
  const urls=Object.fromEntries(roles.map(r=>[r,agents[r].baseUrl]))
   as Record<Role,string>;
  owner=await startTrustedAuthorityOnlySdkA2AOwner({
   coordinator,childIssuer:issuer,gateway,agentBaseUrls:urls,
   stageSocketPath:stageSocket,stageSecretFile:stageSecret,
   agentBindingChannels:binds,
   a2aPolling:{deadlineMs:16000,initialIntervalMs:25,maxIntervalMs:80}
  } as never);
  // A signer of Frontend does not acquire the Backend binding channel.
  const wrongBinder=await connectTrustedEffectAgentBindingClient({
   socketPath:binds.frontend.socketPath,
   secretFile:binds.frontend.secretFile
  });
  await assert.rejects(wrongBinder.bindTask({
   runtimeTaskId:configs.backend.runtimeTaskId,
   planTaskId:configs.backend.taskId,role:"backend",
   childCredentialId:configs.backend.credentialId,
   presenterId:configs.backend.did,branch,
   operation:"update_file",path:configs.backend.path
  }),/Authenticated private effect operation denied/u);
  assert.equal(transferred.size,0);
  for(const role of roles){
   const c=configs[role];
   const report=await owner.dispatchIssuedTask({
    taskId:c.taskId,runtimeTaskId:c.runtimeTaskId,
    instruction:"Perform exactly one approved "+role+" Task",
    effectStager:{async stage(id:string){
     assert.equal(id,c.requestId);
     assert.equal(staged.has(role),false);
     events.push("stage:"+role);
     staged.add(role);
     return {provider_write_authorized:false};
    }}
   });
   assert.equal(report.status,"a2a_report_not_gateway_completed");
   assert.equal(report.provider_completion_attested,false);
   assert.equal(report.role,role);
   assert.equal(report.artifact.commit_sha,SHAS[role]);
   if(role==="test"){
    assert.equal(report.artifact.test_outcome,"pass");
    assert.equal(report.artifact.tested_commit_sha,SHAS.frontend);
   }
   assert.equal(completed.has(role),false);
   assert.equal(transferred.has(role),true);
   assert.equal(models[role].requests.length,2);
   const prompts=JSON.stringify(models[role].requests);
   for(const secret of [c.secret,c.vp,c.credentialId,c.requestId,
    "OFFLINE_ONLY"])
    assert.equal(prompts.includes(secret),false);
   const completion=await owner.attestIndependentGatewayCompletion(
    c.taskId,c.runtimeTaskId
   );
   assert.equal(completion.status,
    "owner_gateway_completion_independently_observed");
   assert.equal(completed.has(role),true);
   await assert.rejects(owner.dispatchIssuedTask({
    taskId:c.taskId,runtimeTaskId:c.runtimeTaskId,
    instruction:"replay denied",
    effectStager:{async stage(){}}
   }),/closed or malformed owner-selected Task/u);
  }
  assert.deepEqual([...completed],roles);
  assert.deepEqual([...transferred],roles);
  assert.deepEqual(events,roles.flatMap(r=>[
   "child:"+r,"prepare:"+r,"stage:"+r,
   "vp:"+r,"execute:"+r,"attest:"+r
  ]));
 }finally{
  const results=await Promise.allSettled([
   owner?.close(),...bindingServers.reverse().map(s=>s.close()),
   ...roles.map(role=>agents[role]?.close())
  ]);
  await rm(dir,{recursive:true,force:true});
  for(const r of results)if(r.status==="rejected")throw r.reason;
 }
});
