/**
 * FREE Docker proof of the THREE ORIGINAL specialist A2A listeners under
 * distinct Linux worker UIDs 1002/1003/1004, with one owner UID 1001.
 * Each role's three HMAC transports use only its dedicated 2301/2302/2303
 * group. No additional specialist or real Gemini model is created.
 * Model callback denies all inference. No Rust Root, Gitea or provider.
 * The container does NOT prove separate Linux mount namespaces.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer as createUnixServer} from "node:net";
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir,chmod,chown,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {AGENT_CARD_PATH} from "@a2a-js/sdk";
import {startDisposableOriginalPrivilegedThreeRoleWorkers}
 from "../src/disposable-gemini-original-a2a-worker-launcher.mjs";

const SCOPE={role:"backend",ownerUid:1001,workerUid:1002,roleGid:2301};
const OWNER_MODEL="file:///work/poc/apps/orchestrator/src/disposable-gemini-owner-worker-ipc.mjs";
const STAGE="file:///work/poc/packages/agent-runtime/src/trusted-effect-staging-unix-ipc.ts";
const CHILD="/work/poc/apps/orchestrator/src/disposable-gemini-original-a2a-worker-child.mjs";
const ownerScript=[
 'const {startDisposableOwnerModelIpcServer}=await import(process.argv[1]);',
 'const {createTrustedOwnerEffectStagingServer,TrustedOwnerEffectStagingRegistry}=',
 ' await import(process.argv[2]);',
 'const conf=JSON.parse(process.argv[3]);',
 'const scope=JSON.parse(process.argv[4]);',
 'const model=await startDisposableOwnerModelIpcServer({',
 ' role:scope.role,socketPath:conf.modelSocketPath,',
 ' secretFile:conf.modelSecretFile,originalScopedModelRole:scope,',
 ' authorizeSignedTask:async()=>false,',
 ' invokeModel:async()=>{throw Error("NO PROVIDER INFERENCE");}',
 '});',
 'const stage=await createTrustedOwnerEffectStagingServer({',
 ' socketPath:conf.stageSocketPath,secretFile:conf.stageSecretFile,',
 ' expectedRole:scope.role,registry:new TrustedOwnerEffectStagingRegistry(),',
 ' originalScopedEffectRole:scope',
 '});',
 'await stage.start();',
 'process.stdout.write("READY\\n");',
 'process.once("SIGTERM",()=>void Promise.allSettled([',
 ' stage.close(),model.close()]).then(()=>process.exit(0)));'
].join("\n");
const ownerEnv={PATH:"/usr/bin:/bin",LANG:"C.UTF-8",HOME:"/tmp"};
const workerEnv={...ownerEnv,DELEGATION_GATEWAY_ARCHITECTURE:"authority-only"};
const spawnAs=(uid,gid,groups,args,options={})=>{
 const privileges=["--reuid",String(uid),"--regid",String(gid),
  ...(groups.length?["--groups",groups.join(",")]:["--clear-groups"]),
  "--no-new-privs","--bounding-set=-all"];
 return spawn("/usr/bin/setpriv",[...privileges,process.execPath,...args],{
  stdio:options.ipc?["ignore","pipe","pipe","ipc"]:
   ["ignore","pipe","pipe"],
  env:options.worker?workerEnv:ownerEnv
 });
};
const observeReady=child=>new Promise((resolve,reject)=>{
 let output="",errors="",done=false;
 const timer=setTimeout(()=>{
  if(done)return;
  done=true;reject(Error("owner did not open role-scoped model/stage"));
 },18000);
 child.stdout.on("data",c=>{
  output+=c;
  if(!done&&output.includes("READY\n")){
   done=true;clearTimeout(timer);resolve();
  }
 });
 child.stderr.on("data",c=>errors+=c);
 child.once("error",error=>{
  if(!done){done=true;clearTimeout(timer);reject(error);}
 });
 child.once("exit",code=>{
  if(!done){done=true;clearTimeout(timer);
   reject(Error("owner exit "+code+" "+errors.slice(0,700)));}
 });
});
const observeWorker=child=>new Promise((resolve,reject)=>{
 let done=false,errors="";
 const timer=setTimeout(()=>{
  if(done)return;
  done=true;reject(Error("worker A2A did not start"));
 },18000);
 child.stderr.on("data",x=>errors+=x);
 const finish=(err,message)=>{
  if(done)return;
  done=true;clearTimeout(timer);
  if(err)reject(Error("worker NO-GO "+errors.slice(0,700)));
  else resolve(message);
 };
 child.on("message",m=>{
  if(m?.type==="ready")finish(false,m);
  if(m?.type==="error")finish(true);
 });
 child.once("error",()=>finish(true));
 child.once("exit",()=>finish(true));
});
async function prepare(root,name,ownerUid,group,dirMode,role="backend"){
 const directory=join(root,name+"-"+role);
 await mkdir(directory,{mode:0o700});
 await chown(directory,ownerUid,group);
 await chmod(directory,dirMode);
 const socketPath=join(directory,name+".sock");
 const secretFile=join(directory,name+".hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 await chown(secretFile,1001,group);
 await chmod(secretFile,0o640);
 return {socketPath,secretFile};
}
async function awaitExit(child){
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise(resolve=>{
  let done=false;
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
  child.once("exit",finish);
  const timer=setTimeout(()=>{
   if(child.exitCode===null)child.kill("SIGKILL");
   finish();
  },6000);
 });
}
test("real Backend A2A server under UID 1002 starts with 3 role-scoped owner transports; private owner canary denied",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("Explicit offline Docker root fixture only");return;
 }
 const root=await mkdtemp("/tmp/delegation-real-a2a-");
 await chmod(root,0o755);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const model=await prepare(root,"model",1001,2301,0o2750);
 const stage=await prepare(root,"stage",1001,2301,0o2750);
 const bind=await prepare(root,"bind",1001,2301,0o3770);
 const ownerOnly=join(root,"owner-private");
 await mkdir(ownerOnly,{mode:0o700});
 await chown(ownerOnly,1001,1101);
 await chmod(ownerOnly,0o700);
 const ownerCanaryPath=join(ownerOnly,"harmless-canary");
 await writeFile(ownerCanaryPath,randomBytes(32),{mode:0o600,flag:"wx"});
 await chown(ownerCanaryPath,1001,1101);
 await chmod(ownerCanaryPath,0o600);
 const conf={role:"backend",port:18641,
  task:{session_id:"original-offline-a2a-crossuid"},
  maxCalls:1,
  modelSocketPath:model.socketPath,modelSecretFile:model.secretFile,
  stageSocketPath:stage.socketPath,stageSecretFile:stage.secretFile,
  bindSocketPath:bind.socketPath,bindSecretFile:bind.secretFile,
  adapterToken:"offline-backend-adapter-token",
  gatewayBaseUrl:"http://127.0.0.1:18642",
  adapterBaseUrl:"http://127.0.0.1:18643"};
 const owner=spawnAs(1001,1101,[2301],[
  "--experimental-strip-types","--input-type=module","-e",
  ownerScript,OWNER_MODEL,STAGE,JSON.stringify(conf),JSON.stringify(SCOPE)
 ]);
 t.after(async()=>{if(owner.exitCode===null)owner.kill("SIGTERM");
  await awaitExit(owner);
 });
 await observeReady(owner);
 const worker=spawnAs(1002,2301,[],[
  "--experimental-strip-types",CHILD
 ],{ipc:true,worker:true});
 t.after(async()=>{
  if(worker.connected)worker.send({type:"stop"},()=>{});
  else if(worker.exitCode===null)worker.kill("SIGTERM");
  await awaitExit(worker);
 });
 const readyWait=observeWorker(worker);
 worker.send({type:"start",config:conf,ownerCanaryPath,
  requireOwnerFileIsolation:true,originalScopedRole:SCOPE});
 const ready=await readyWait;
 assert.equal(ready.role,"backend");
 assert.equal(ready.pid,worker.pid);
 assert.equal(ready.crossUidChannelsConfigured,true);
 assert.equal(ready.ownerCanaryReadable,false);
 assert.equal(ready.providerCredentialPresent,false);
 assert.equal(ready.originalNativeTaskBindingPresent,false);
 assert.equal(ready.originalTaskBindingChannelReady,true);
 assert.equal(ready.osIsolationVerified,false);
 const response=await fetch(new URL(AGENT_CARD_PATH,
  ready.baseUrl+"/"));
 assert.equal(response.status,200);
 const card=await response.json();
 assert.equal(card.name,"Backend Development Agent");
 assert.equal(card.supportedInterfaces[0].url,ready.baseUrl+"/a2a/rest");
 assert.equal(worker.exitCode,null);
});

test("actual Frontend and Test A2A listeners run as separate UID/GID role principals with the same original 3 private IPC directions",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("Explicit offline Docker root fixture only");return;
 }
 for(const [role,uid,gid,port,expectedCard] of [
  ["frontend",1003,2302,18651,"Frontend Development Agent"],
  ["test",1004,2303,18661,"Software Testing Agent"]
 ]){
  const scope={role,ownerUid:1001,workerUid:uid,roleGid:gid};
  const root=await mkdtemp("/tmp/delegation-real-a2a-"+role+"-");
  let owner,worker;
  try{
   await chmod(root,0o755);
   const model=await prepare(root,"model",1001,gid,0o2750,role);
   const stage=await prepare(root,"stage",1001,gid,0o2750,role);
   const bind=await prepare(root,"bind",1001,gid,0o3770,role);
   const ownerPrivate=join(root,"owner-private");
   await mkdir(ownerPrivate,{mode:0o700});
   await chown(ownerPrivate,1001,1101);
   await chmod(ownerPrivate,0o700);
   const ownerCanaryPath=join(ownerPrivate,"harmless-canary");
   await writeFile(ownerCanaryPath,randomBytes(32),
    {mode:0o600,flag:"wx"});
   await chown(ownerCanaryPath,1001,1101);
   await chmod(ownerCanaryPath,0o600);
   const conf={
    role,port,task:{session_id:"original-offline-crossuid-3-roles"},
    maxCalls:1,modelSocketPath:model.socketPath,
    modelSecretFile:model.secretFile,
    stageSocketPath:stage.socketPath,
    stageSecretFile:stage.secretFile,
    bindSocketPath:bind.socketPath,
    bindSecretFile:bind.secretFile,
    adapterToken:"offline-"+role+"-private-adapter",
    gatewayBaseUrl:"http://127.0.0.1:18642",
    adapterBaseUrl:"http://127.0.0.1:18643"
   };
   owner=spawnAs(1001,1101,[gid],[
    "--experimental-strip-types","--input-type=module","-e",
    ownerScript,OWNER_MODEL,STAGE,JSON.stringify(conf),
    JSON.stringify(scope)
   ]);
   await observeReady(owner);
   worker=spawnAs(uid,gid,[],[
    "--experimental-strip-types",CHILD
   ],{ipc:true,worker:true});
   const pending=observeWorker(worker);
   worker.send({
    type:"start",config:conf,ownerCanaryPath,
    requireOwnerFileIsolation:true,originalScopedRole:scope
   });
   const ready=await pending;
   assert.equal(ready.role,role);
   assert.equal(ready.pid,worker.pid);
   assert.equal(ready.crossUidChannelsConfigured,true);
   assert.equal(ready.providerCredentialPresent,false);
   assert.equal(ready.ownerCanaryReadable,false);
   assert.equal(ready.originalNativeTaskBindingPresent,false);
   assert.equal(ready.originalTaskBindingChannelReady,true);
   assert.equal(ready.osIsolationVerified,false);
   const response=await fetch(new URL(AGENT_CARD_PATH,ready.baseUrl+"/"));
   assert.equal(response.status,200);
   const card=await response.json();
   assert.equal(card.name,expectedCard);
   assert.equal(card.supportedInterfaces[0].url,
    ready.baseUrl+"/a2a/rest");
  }finally{
   if(worker){
    if(worker.connected)worker.send({type:"stop"},()=>{});
    else if(worker.exitCode===null)worker.kill("SIGTERM");
    await awaitExit(worker);
   }
   if(owner){
    if(owner.exitCode===null)owner.kill("SIGTERM");
    await awaitExit(owner);
   }
   await rm(root,{recursive:true,force:true});
  }
 }
});


const threeRoleOwnerScript=[
"const {startDisposableOriginalThreeRoleModelIpcOwner}=await import(\"file:///work/poc/apps/orchestrator/src/disposable-gemini-original-ipc-task-admission.mjs\");",
"const {createTrustedOwnerEffectStagingServer,TrustedOwnerEffectStagingRegistry,connectTrustedEffectAgentBindingClient}=await import(process.argv[2]);",
"const {TrustedAuthorityOnlyRemoteEffectOwner}=await import(\"file:///work/poc/packages/orchestrator-runtime/src/trusted-authority-only-remote-effect-owner.ts\");",
"const {TrustedAuthorityOnlyExecutionCoordinator}=await import(\"file:///work/poc/packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts\");",
"const {TrustedAuthorityOnlyChildIssuer}=await import(\"file:///work/poc/packages/orchestrator-runtime/src/trusted-authority-only-child-issuer.ts\");",
"const {TrustedAuthorityOnlyGatewayAdmissions}=await import(\"file:///work/poc/apps/gateway/src/trusted-authority-only-admissions.ts\");",
"const {canonicalFileUri}=await import(\"file:///work/poc/apps/gateway/src/canonical.ts\");",
"const {DeterministicA2AOrchestrator}=await import(\"file:///work/poc/packages/agent-runtime/src/orchestrator.ts\");",
"const configs=JSON.parse(process.argv[3]),scopes=JSON.parse(process.argv[4]);",
"const roles=[\"backend\",\"frontend\",\"test\"];",
"const pinned={backend:[1002,2301,\"B\",\"apps/backend/account.ts\"],frontend:[1003,2302,\"F\",\"apps/frontend/account.ts\"],test:[1004,2303,\"T\",\"apps/test/account.test.ts\"]};",
"if(process.getuid()!==1001||Object.keys(configs).sort().join(\",\")!==roles.slice().sort().join(\",\")||Object.keys(scopes).sort().join(\",\")!==roles.slice().sort().join(\",\")||process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||process.env.GITHUB_TOKEN)throw Error(\"owner original three-role cross-UID NO-GO\");",
"const registry=new TrustedOwnerEffectStagingRegistry(),handles=[],modelCalls={},pins={};",
"const modelChannels={},invokeModelByRole={};",
"let modelOwner;",
"const repository={authority:\"gitea.local\",owner:\"thesis\",repository:\"iam-console-poc\"};",
"const branch=\"feature/account-suspension\",sessionId=configs.backend.task.session_id;",
"const allPermissions=roles.map(role=>({resource:canonicalFileUri(repository,branch,pinned[role][3]),operation:\"read_file\"}));",
"const root={session_id:sessionId,repository,branch,authority_digest:\"a\".repeat(64),root_credential_id:\"synthetic-three-role-rust-root\",base_revision:\"b\".repeat(40),requirement_sha256:\"c\".repeat(64),engineer_did:\"did:thesis:engineer\",expires_at:new Date(Date.now()+60000).toISOString(),root_expires_at:new Date(Date.now()+60000).toISOString(),root_permissions:allPermissions};",
"let owner,finished=false,staged=0;",
"const retireAll=()=>modelOwner?.close();",
"try{",
" for(let i=0;i<roles.length;i++){",
"  const role=roles[i],conf=configs[role],scope=scopes[role];",
"  const [uid,gid,tag,file]=pinned[role];",
"  if(conf.role!==role||conf.task.session_id!==sessionId||scope.role!==role||scope.ownerUid!==1001||scope.workerUid!==uid||scope.roleGid!==gid)throw Error(\"role or signed session mismatch\");",
"  const taskId=\"r323-original-three-crossuid-\"+role,runtimeTaskId=\"dispatch_\"+tag.repeat(22);",
"  const permission=allPermissions[i],agentDid=\"did:thesis:\"+role+\"-agent\",credentialId=\"urn:offline:original-child:\"+role;",
"  pins[role]={taskId,runtimeTaskId,permission,file,agentDid,credentialId,epoch:i+1};",
"  modelCalls[role]=0;",
"  modelChannels[role]={socketPath:conf.modelSocketPath,",
"   secretFile:conf.modelSecretFile};",
"  invokeModelByRole[role]=async()=>{",
"   modelCalls[role]++;",
"   return {chunks:[{content:{role:\"model\",parts:[{text:\"synthetic native-bound readonly response\"}]},usageMetadata:{promptTokenCount:5,candidatesTokenCount:3,totalTokenCount:8}}],",
"    metered_calls_started:modelCalls[role],metered_total_tokens:modelCalls[role]*8,",
"    owner_original_signed_task_verified_here:false,provider_billed_amount_verified:false,model_generated_source_proven:false};",
"  };",
"  const stage=await createTrustedOwnerEffectStagingServer({",
"   socketPath:conf.stageSocketPath,secretFile:conf.stageSecretFile,",
"   expectedRole:role,registry,originalScopedEffectRole:scope",
"  });",
"  handles.push(stage);await stage.start();",
" }",
" modelOwner=await startDisposableOriginalThreeRoleModelIpcOwner({",
"  channels:modelChannels,invokeModelByRole,originalScopedRoles:scopes,",
"  offlineSyntheticOnly:true",
" });",
"}catch(error){",
" await retireAll();",
" await Promise.allSettled(handles.reverse().map(h=>h.close()));",
" throw error;",
"}",
"process.stdout.write(\"READY\\n\");",
"process.once(\"SIGTERM\",()=>void Promise.allSettled([",
" modelOwner.close(),...handles.reverse().map(h=>h.close())",
"]).then(items=>process.exit(items.every(x=>x.status===\"fulfilled\")?0:1)));",
"process.on(\"message\",async message=>{",
" if(message?.type!==\"run_original_three\"||finished)return;",
" finished=true;",
" const bound=[];",
" try{",
"  if(!message.urls||Object.keys(message.urls).sort().join(\",\")!==roles.slice().sort().join(\",\"))throw Error(\"original role A2A URL inventory required\");",
"  const clients={};",
"  for(const role of roles){",
"   const conf=configs[role],scope=scopes[role];",
"   if(message.urls[role]!==\"http://127.0.0.1:\"+conf.port)throw Error(\"foreign agent URL\");",
"   clients[role]=await connectTrustedEffectAgentBindingClient({",
"    socketPath:conf.bindSocketPath,secretFile:conf.bindSecretFile,",
"    expectedRole:role,originalScopedEffectRole:scope",
"   });",
"  }",
"  const coordinator=Object.assign(Object.create(TrustedAuthorityOnlyExecutionCoordinator.prototype),{",
"   assertTrustedGatewayAuthorityBinding:()=>root,",
"   assertTrustedGatewayRegisteredTask:id=>{",
"    const role=roles.find(r=>pins[r].taskId===id);",
"    if(!role)throw Error(\"unknown signed Task\");",
"    const p=pins[role];",
"    return {status:\"task_registered_preflight_only\",session_id:sessionId,task_id:id,epoch:p.epoch,agent_id:role,agent_did:p.agentDid,card_ref:\"trusted:\"+role,depends_on:[],permissions:[p.permission],root_credential_id:root.root_credential_id,authority_digest:root.authority_digest,execution_authorized:false,child_credential_issued:false,gateway_registered:false};",
"   }",
"  });",
"  const issuer=Object.assign(Object.create(TrustedAuthorityOnlyChildIssuer.prototype),{",
"   assertTrustedIssuedChild:id=>{",
"    const role=roles.find(r=>pins[r].taskId===id);",
"    if(!role)throw Error(\"unknown native Child\");",
"    const p=pins[role];",
"    return {status:\"native_child_response_verified_staged\",session_id:sessionId,task_id:id,epoch:p.epoch,agent_id:role,agent_did:p.agentDid,root_credential_id:root.root_credential_id,credential_id:p.credentialId,authority_digest:root.authority_digest,permissions:[p.permission],status_list_credential:\"status\",status_list_index:String(p.epoch),expires_at:root.expires_at,gateway_execution_authorized:false};",
"   }",
"  });",
"  const gateway=Object.assign(Object.create(TrustedAuthorityOnlyGatewayAdmissions.prototype),{",
"   assertTrustedOwnerRemoteEffectBinding:(id,runtimeId)=>{",
"    const role=roles.find(r=>pins[r].taskId===id);",
"    if(!role||runtimeId!==pins[role].runtimeTaskId)throw Error(\"unknown original Gateway Task\");",
"    const p=pins[role];",
"    return {status:\"gateway_owner_child_task_preflight_only\",task_id:id,runtime_task_id:runtimeId,agent_id:role,agent_did:p.agentDid,credential_id:p.credentialId,authority_digest:root.authority_digest,gateway_execution_authorized:false};",
"   }",
"  });",
"  owner=new TrustedAuthorityOnlyRemoteEffectOwner({",
"   coordinator,childIssuer:issuer,gateway,ownerStageRegistry:registry,",
"   agentBindingClients:clients",
"  });",
"  const a2a=new DeterministicA2AOrchestrator({deadlineMs:15000,initialIntervalMs:30,maxIntervalMs:100});",
"  const outcome={};",
"  for(const role of roles){",
"   const p=pins[role];",
"   const receipt=await owner.bindRegisteredTask({taskId:p.taskId,runtimeTaskId:p.runtimeTaskId,effectStager:{",
"    async stage(){staged++;throw Error(\"offline: no provider effects\");}",
"   }});",
"   const retireModelTask=modelOwner.onNativeOriginalTaskPrebound({role,receipt,assertOriginalRootActive:()=>root});",
"   bound.push(role);",
"   let error=\"\";",
"   try{",
"    await a2a.sendProtectedTask({",
"     agent_base_url:message.urls[role],",
"     subtask:{subtask_id:p.taskId,branch,instruction:\"Read approved source and report observations\",",
"      relevant_paths:[p.file],approved_file_permissions:[{path:p.file,operation:\"read_file\"}],",
"      approved_run_tests:false},",
"     delegation_evidence:{credential:\"synthetic-offline-DC-no-real-signature\",credential_id:p.credentialId,presenter_id:p.agentDid},",
"     trusted_gateway_task_id:p.runtimeTaskId",
"    });",
"   }catch(e){error=String(e.message);}",
"   // Synchronous model fence precedes the private remote binding retirement.",
"   retireModelTask();",
"   await owner.fence(p.runtimeTaskId);",
"   let denied=false;",
"   try{await modelOwner.roleAuthorizers[role]({role,task:{task_id:p.taskId,runtime_task_id:p.runtimeTaskId,session_id:sessionId,credential_id:p.credentialId},callId:\"three-role-post-fence-\"+role});}",
"   catch(e){denied=String(e.message).includes(\"Task admission NO-GO\");}",
"   outcome[role]={prebound:true,fenced:true,replayDenied:denied,modelCalls:modelCalls[role],a2aIncomplete:error.includes(\"without completion\")};",
"  }",
"  process.send?.({type:\"original_three_result\",report:{ownerUid:process.getuid(),roles:outcome,staged,syntheticRootOnly:true,paidInference:false}});",
" }catch(error){",
"  await retireAll();",
"  if(owner)for(const role of bound)await owner.fence(pins[role].runtimeTaskId).catch(()=>{});",
"  process.send?.({type:\"original_three_failure\",error:String(error.stack??error).slice(0,1200)});",
" }",
"});",
""
].join("\n");

test("one offline original Owner binds and fences Backend Frontend Test over distinct Linux UIDs after rejecting unbound model calls",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("Explicit offline Docker root fixture only");return;
 }
 const root=await mkdtemp("/tmp/delegation-three-a2a-");
 let owner,privileged;
 try{
  await chmod(root,0o755);
  const ownerPrivate=join(root,"owner-private");
  await mkdir(ownerPrivate,{mode:0o700});
  await chown(ownerPrivate,1001,1101);
  await chmod(ownerPrivate,0o700);
  const ownerCanaryPath=join(ownerPrivate,"harmless-canary");
  await writeFile(ownerCanaryPath,randomBytes(32),{mode:0o600,flag:"wx"});
  await chown(ownerCanaryPath,1001,1101);
  await chmod(ownerCanaryPath,0o600);
  const roles=[
   ["backend",1002,2301,18711,"Backend Development Agent"],
   ["frontend",1003,2302,18721,"Frontend Development Agent"],
   ["test",1004,2303,18731,"Software Testing Agent"]
  ];
  const configs={},scopes={};
  for(const [role,uid,gid,port] of roles){
   const model=await prepare(root,"model",1001,gid,0o2750,role);
   const stage=await prepare(root,"stage",1001,gid,0o2750,role);
   const bind=await prepare(root,"bind",1001,gid,0o3770,role);
   scopes[role]={role,ownerUid:1001,workerUid:uid,roleGid:gid};
   configs[role]={
    role,port,task:{session_id:"one-offline-original-three-role-session"},
    maxCalls:1,modelSocketPath:model.socketPath,
    modelSecretFile:model.secretFile,stageSocketPath:stage.socketPath,
    stageSecretFile:stage.secretFile,bindSocketPath:bind.socketPath,
    bindSecretFile:bind.secretFile,
    adapterToken:"offline-three-role-"+role+"-token",
    gatewayBaseUrl:"http://127.0.0.1:18780",
    adapterBaseUrl:"http://127.0.0.1:18781"
   };
  }
  // ONE owner Node process has the three role groups, while each
  // specialist has only its own Linux UID/primary GID.
  owner=spawnAs(1001,1101,[2301,2302,2303],[
   "--experimental-strip-types","--input-type=module","-e",
   threeRoleOwnerScript,OWNER_MODEL,STAGE,
   JSON.stringify(configs),JSON.stringify(scopes)
  ],{ipc:true});
  await observeReady(owner);
  // The owner, unlike the UID=0 provisioner, has no Linux capability or
  // privilege escalation path; it retains exactly the three role GIDs.
  const ownerStatus=await (await import("node:fs/promises")).readFile(
   "/proc/"+owner.pid+"/status","utf8");
  assert.match(ownerStatus,/^NoNewPrivs:[ \\t]*1[ \\t]*$/mu);
  assert.match(ownerStatus,/^CapEff:[ \\t]*0+[ \\t]*$/mu);
  assert.match(ownerStatus,/^Groups:[ \\t]*2301 2302 2303[ \\t]*$/mu);
  // The very same existing specialist PIDs must NOT be able to opt into
  // native MCP with a guessed DID and an unmounted Rust signing socket.
  // Refuse at bootstrap, before any A2A listener or model invocation.
  for(const [role,uid,gid] of roles){
   const probe=spawnAs(uid,gid,[],[
    "--experimental-strip-types",CHILD
   ],{ipc:true,worker:true});
   const denied=observeWorker(probe);
   const falseNativeConfig={
    ...configs[role],nativeSignerDid:"did:thesis:"+role+"-agent",
    nativeCryptoSocketPath:join(root,"absent-rust-"+role+".sock")
   };
   probe.send({type:"start",config:falseNativeConfig,ownerCanaryPath,
    requireOwnerFileIsolation:true,originalScopedRole:scopes[role]});
   await assert.rejects(denied,/worker NO-GO/u,
    "missing original Rust socket must not create a "+role+" A2A listener");
   await awaitExit(probe);
   assert.equal(probe.exitCode,1);
  }
  // Fail-closed supervisor inputs must be rejected BEFORE any additional
  // Linux worker is spawned. The trusted signed Owner is a single UID/PID.
  const trustedLaunch={
   configs,scopes,ownerPid:owner.pid,ownerCanaryPath,
   offlineSyntheticOnly:true
  };
  for(const [label,variant] of [
   ["reused worker UID",{scopes:{...scopes,frontend:{
    ...scopes.frontend,workerUid:scopes.backend.workerUid
   }}}],
   ["reused worker group",{scopes:{...scopes,test:{
    ...scopes.test,roleGid:scopes.frontend.roleGid
   }}}],
   ["foreign owner PID",{ownerPid:process.pid}],
   ["paid-mode authorization",{offlineSyntheticOnly:false}],
   ["unmounted native Rust signer",{configs:{...configs,backend:{
    ...configs.backend,
    nativeSignerDid:"did:thesis:backend-agent",
    nativeCryptoSocketPath:join(root,"missing-original-native-rust.sock")
   }}}]
  ]){
   await assert.rejects(startDisposableOriginalPrivilegedThreeRoleWorkers({
    ...trustedLaunch,...variant
   }),/Disposable original A2A subprocess launcher NO-GO/u,label);
  }
  // A listening Unix socket is NOT proof of a native Rust signer.
  // Reject it before any A2A spawn when its owner-created Linux group,
  // socket mode or directory ACL differs from the pinned Backend role.
  const fakeRustDir=join(root,"fake-native-backend");
  await mkdir(fakeRustDir,{mode:0o700});
  await chown(fakeRustDir,1001,2302); // deliberately Frontend's group
  await chmod(fakeRustDir,0o2750);
  const fakeRustSocket=join(fakeRustDir,"native.sock");
  const fakeRust=createUnixServer(()=>{throw Error("No Rust signer here");});
  await new Promise((resolve,reject)=>{
   fakeRust.once("error",reject);
   fakeRust.listen(fakeRustSocket,resolve);
  });
  try{
   await chown(fakeRustSocket,1001,2302);
   await chmod(fakeRustSocket,0o660);
   const invalidRust={
    ...configs,backend:{...configs.backend,
     nativeCryptoSocketPath:fakeRustSocket,
     nativeSignerDid:"did:thesis:backend-agent"}
   };
   const rejectNative=async label=>assert.rejects(
    startDisposableOriginalPrivilegedThreeRoleWorkers({
     configs:invalidRust,scopes,ownerPid:owner.pid,ownerCanaryPath,
     offlineSyntheticOnly:true
    }),/subprocess launcher NO-GO/u,label
   );
   await rejectNative("foreign specialist GID cannot authenticate Rust socket");
   await chown(fakeRustSocket,1001,2301);
   await rejectNative("wrong native Rust directory GID cannot be bypassed");
   await chown(fakeRustDir,1001,2301);
   await chmod(fakeRustSocket,0o666);
   await rejectNative("world-writable Rust socket must be rejected");
   await chmod(fakeRustSocket,0o660);
   await chmod(fakeRustDir,0o2755);
   await rejectNative("world-traversable Rust directory must be rejected");
  }finally{
   await new Promise(resolve=>fakeRust.close(resolve));
  }
  // The ORIGINAL three-role privileged launcher now starts exactly three
  // existing A2A workers. The Docker fixture no longer fabricates readiness
  // by manually forking those positive-path workers itself.
  privileged=await startDisposableOriginalPrivilegedThreeRoleWorkers({
   configs,scopes,ownerPid:owner.pid,ownerCanaryPath,
   offlineSyntheticOnly:true
  });
  const ready=roles.map(([role])=>privileged.workers[role]);
  assert.equal(privileged.paidGeminiAuthorized,false);
  assert.equal(privileged.osIsolationVerified,false);
  assert.equal(privileged.nativeRustSignerVerified,false);
  assert.equal(new Set(ready.map(r=>r.pid)).size,3);
  assert.ok(ready.every(r=>r.pid!==owner.pid));
  for(let i=0;i<roles.length;i++){
   const [role,uid,gid,,cardName]=roles[i];
   const actual=ready[i];
   assert.equal(actual.workerUid,uid);
   assert.equal(actual.roleGid,gid);
   assert.equal(actual.role,role);
   assert.equal(actual.baseUrl,"http://127.0.0.1:"+configs[role].port);
   assert.equal(actual.canReadOwnerCanary,false);
   assert.equal(actual.originalNativeTaskBindingPresent,false);
   assert.equal(actual.osIsolationVerified,false);
   const proc=await import("node:fs/promises").then(fs=>
    fs.readFile("/proc/"+actual.pid+"/status","utf8"));
   const uids=proc.match(/^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)/mu);
   const gids=proc.match(/^Gid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)/mu);
   assert.deepEqual(uids?.slice(1).map(Number),[uid,uid,uid,uid]);
   assert.deepEqual(gids?.slice(1).map(Number),[gid,gid,gid,gid]);
   const response=await fetch(new URL(AGENT_CARD_PATH,actual.baseUrl+"/"));
   assert.equal(response.status,200);
   const card=await response.json();
   assert.equal(card.name,cardName);
   assert.equal(card.supportedInterfaces[0].url,actual.baseUrl+"/a2a/rest");
  }
  // For every role, the kernel must refuse all three HMAC secrets from
  // the NEXT specialist's Linux UID/GID. Verify OS file permissions,
  // not merely a reported A2A role or a mock credential flag.
  const foreignSecretProbe=[
   'const {open}=await import("node:fs/promises");',
   'try{const fd=await open(process.argv[1],"r");await fd.close();',
   ' process.stdout.write("UNSAFE");}',
   'catch(error){if(["EACCES","EPERM"].includes(error.code))',
   ' process.stdout.write("DENIED");else throw error;}'
  ].join("\n");
  for(let i=0;i<roles.length;i++){
   const [,uid,gid]=roles[i],foreignRole=roles[(i+1)%roles.length][0];
   for(const secretFile of [
    configs[foreignRole].modelSecretFile,
    configs[foreignRole].stageSecretFile,
    configs[foreignRole].bindSecretFile
   ]){
    const probe=spawnAs(uid,gid,[],[
     "--input-type=module","-e",foreignSecretProbe,secretFile
    ]);
    const outcome=await new Promise((resolve,reject)=>{
     let stdout="",stderr="";
     probe.stdout.on("data",chunk=>stdout+=chunk);
     probe.stderr.on("data",chunk=>stderr+=chunk);
     probe.once("error",reject);
     probe.once("close",code=>resolve({code,stdout,stderr}));
    });
    assert.equal(outcome.code,0,outcome.stderr.slice(-300));
    assert.equal(outcome.stdout,"DENIED",
     "foreign role must not read other specialist's model/stage/bind HMAC");
   }
  }
  // Own-role HMAC and correct UID/GID are NOT enough. Without an R323
  // owner native Task prebind, every model request must be denied.
  const noNativeTaskProbe=[
   'const {connectDisposableWorkerModelIpcClient}=await import(process.argv[1]);',
   'const cfg=JSON.parse(process.argv[2]);',
   'const scope=JSON.parse(process.argv[3]);',
   'const client=await connectDisposableWorkerModelIpcClient({',
   ' role:scope.role,socketPath:cfg.modelSocketPath,',
   ' secretFile:cfg.modelSecretFile,originalScopedModelRole:scope});',
   'const task={session_id:cfg.task.session_id,',
   ' task_id:"unapproved-"+scope.role,',
   ' credential_id:"urn:unapproved:child:"+scope.role,',
   ' runtime_task_id:"dispatch_"+"Q".repeat(22)};',
   'try{await client.call({task,callId:"crossuid-without-native-prebind-001",',
   ' payload:{contents:[{role:"user",parts:[{text:"NO INFERENCE"}]}]}});',
   ' process.stdout.write("UNSAFE");}',
   'catch(error){',
   ' if(!String(error.message).includes("owner-worker model IPC NO-GO"))',
   '  throw error;',
   ' process.stdout.write("DENIED");}'
  ].join("\n");
  for(const [role,uid,gid] of roles){
   const probe=spawnAs(uid,gid,[],[
    "--input-type=module","-e",noNativeTaskProbe,
    OWNER_MODEL,JSON.stringify(configs[role]),JSON.stringify(scopes[role])
   ]);
   const outcome=await new Promise((resolve,reject)=>{
    let stdout="",stderr="";
    probe.stdout.on("data",chunk=>stdout+=chunk);
    probe.stderr.on("data",chunk=>stderr+=chunk);
    probe.once("error",reject);
    probe.once("close",code=>resolve({code,stdout,stderr}));
   });
   assert.equal(outcome.code,0,outcome.stderr.slice(-400));
   assert.equal(outcome.stdout,"DENIED",
    "own-role HMAC is not permission to invoke an unbound model Task");
  }
  // Same real owner PID and the SAME three real worker PIDs now exercise
  // actual original R323 signed-Task prebinding (offline Root/Child fixtures).
  // No additional owner, worker, planner, signer or provider is started.
  const nativeThree=await new Promise((resolve,reject)=>{
   let finished=false,stderr="";
   owner.stderr.on("data",chunk=>stderr+=chunk);
   const timer=setTimeout(()=>finish(Error(
    "original three-role cross-UID native owner dispatch timeout")),75000);
   const finish=(err,result)=>{
    if(finished)return;
    finished=true;clearTimeout(timer);
    owner.off("message",onMessage);owner.off("exit",onExit);
    if(err)reject(err);else resolve(result);
   };
   const onMessage=msg=>{
    if(msg?.type==="original_three_result")finish(null,msg.report);
    if(msg?.type==="original_three_failure")
     finish(Error("original three-role native NO-GO: "+msg.error));
   };
   const onExit=code=>finish(Error("owner exited "+code+
    " "+stderr.slice(-1000)));
   owner.on("message",onMessage);owner.once("exit",onExit);
   owner.send({type:"run_original_three",urls:Object.fromEntries(
    ready.map(item=>[item.role,item.baseUrl])
   )},error=>{if(error)finish(error);});
  });
  assert.equal(nativeThree.ownerUid,1001);
  assert.equal(nativeThree.staged,0,
   "no Gitea or Docker provider effect may be fabricated in this offline proof");
  assert.equal(nativeThree.syntheticRootOnly,true);
  assert.equal(nativeThree.paidInference,false);
  assert.deepEqual(Object.keys(nativeThree.roles).sort(),
   ["backend","frontend","test"]);
  for(const role of ["backend","frontend","test"]){
   assert.deepEqual(nativeThree.roles[role],{
    prebound:true,fenced:true,replayDenied:true,
    modelCalls:1,a2aIncomplete:true
   },"original "+role+" R323 prebind/model IPC/retirement must all succeed");
  }
  // Separate Linux processes now attempt replay with the EXACT previously
  // bound Task/Child and their own valid role HMAC. Denial must come from
  // the actual OWNER Unix model server, not only an in-process test ledger.
  const afterNativeFenceProbe=[
   'const {connectDisposableWorkerModelIpcClient}=await import(process.argv[1]);',
   'const cfg=JSON.parse(process.argv[2]),scope=JSON.parse(process.argv[3]);',
   'const client=await connectDisposableWorkerModelIpcClient({',
   ' role:scope.role,socketPath:cfg.modelSocketPath,',
   ' secretFile:cfg.modelSecretFile,originalScopedModelRole:scope});',
   'const tags={backend:"B",frontend:"F",test:"T"};',
   'const task={task_id:"r323-original-three-crossuid-"+scope.role,',
   ' runtime_task_id:"dispatch_"+tags[scope.role].repeat(22),',
   ' credential_id:"urn:offline:original-child:"+scope.role,',
   ' session_id:cfg.task.session_id};',
   'try{await client.call({task,callId:"three-role-after-native-fence-002",',
   ' payload:{contents:[{role:"user",parts:[{text:"REPLAY"}]}]}});',
   ' process.stdout.write("UNSAFE");}',
   'catch(error){if(!String(error.message).includes("model IPC NO-GO"))',
   ' throw error;process.stdout.write("DENIED");}'
  ].join("\n");
  for(const [role,uid,gid] of roles){
   const probe=spawnAs(uid,gid,[],[
    "--input-type=module","-e",afterNativeFenceProbe,OWNER_MODEL,
    JSON.stringify(configs[role]),JSON.stringify(scopes[role])
   ]);
   const outcome=await new Promise((resolve,reject)=>{
    let stdout="",stderr="";
    probe.stdout.on("data",chunk=>stdout+=chunk);
    probe.stderr.on("data",chunk=>stderr+=chunk);
    probe.once("error",reject);
    probe.once("close",code=>resolve({code,stdout,stderr}));
   });
   assert.equal(outcome.code,0,outcome.stderr.slice(-500));
   assert.equal(outcome.stdout,"DENIED",
    "a retired original "+role+" Task must not resume over valid cross-UID HMAC");
  }
  assert.equal(owner.exitCode,null);
  for(const actual of ready){
   const response=await fetch(new URL(AGENT_CARD_PATH,actual.baseUrl+"/"));
   assert.equal(response.status,200,
    "original Linux worker must remain live after terminal Task fence");
  }
  // No genuine Engineer/Rust approval, provider model call or Gateway
  // effect was started. Offline Task/Child/Root replies are fixtures.
 }finally{
  if(privileged)await privileged.close();
  if(owner){
   if(owner.exitCode===null)owner.kill("SIGTERM");
   await awaitExit(owner);
  }
  await rm(root,{recursive:true,force:true});
 }
});


test("original R323 owner UID 1001 prebinds one real Backend UID 1002 A2A Task, authentic HMAC model IPC then terminally fences",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("Explicit offline Docker root fixture only");return;
 }
 const root=await mkdtemp("/tmp/delegation-native-crossuid-");
 let owner,worker;
 try{
  await chmod(root,0o755);
  const role="backend",scope={
   role,ownerUid:1001,workerUid:1002,roleGid:2301
  };
  const model=await prepare(root,"model",1001,2301,0o2750);
  const stage=await prepare(root,"stage",1001,2301,0o2750);
  const bind=await prepare(root,"bind",1001,2301,0o3770);
  const privateDir=join(root,"owner-private");
  await mkdir(privateDir,{mode:0o700});
  await chown(privateDir,1001,1101);
  await chmod(privateDir,0o700);
  const ownerCanaryPath=join(privateDir,"harmless-canary");
  await writeFile(ownerCanaryPath,randomBytes(32),{mode:0o600,flag:"wx"});
  await chown(ownerCanaryPath,1001,1101);
  await chmod(ownerCanaryPath,0o600);
  const conf={
   role,port:18741,
   task:{session_id:"original-native-crossuid-offline-session"},
   maxCalls:1,
   modelSocketPath:model.socketPath,modelSecretFile:model.secretFile,
   stageSocketPath:stage.socketPath,stageSecretFile:stage.secretFile,
   bindSocketPath:bind.socketPath,bindSecretFile:bind.secretFile,
   adapterToken:"offline-backend-crossuid-r323-token",
   gatewayBaseUrl:"http://127.0.0.1:18780",
   adapterBaseUrl:"http://127.0.0.1:18781"
  };
  const ownerEntry="/work/poc/apps/orchestrator/test/disposable-gemini-original-crossuid-native-owner-fixture.mjs";
  owner=spawnAs(1001,1101,[2301],[
   "--experimental-strip-types",ownerEntry,
   JSON.stringify(conf),JSON.stringify(scope)
  ],{ipc:true});
  await observeReady(owner);
  worker=spawnAs(1002,2301,[],[
   "--experimental-strip-types",CHILD
  ],{ipc:true,worker:true});
  const awaited=observeWorker(worker);
  worker.send({type:"start",config:conf,ownerCanaryPath,
   requireOwnerFileIsolation:true,originalScopedRole:scope});
  const ready=await awaited;
  assert.equal(ready.role,"backend");
  assert.equal(ready.pid,worker.pid);
  assert.equal(ready.ownerCanaryReadable,false);
  assert.equal(ready.providerCredentialPresent,false);
  assert.equal(ready.originalNativeTaskBindingPresent,false,
   "worker cannot claim an independent original signed Root");
  assert.equal(ready.originalTaskBindingChannelReady,true);
  assert.equal(ready.crossUidChannelsConfigured,true);
  assert.equal(ready.osIsolationVerified,false);
  const result=await new Promise((resolve,reject)=>{
   let finished=false,stderr="";
   owner.stderr.on("data",b=>stderr+=b);
   const timer=setTimeout(()=>finish(
    Error("native owner did not confirm cross-UID signed-task prebind")),25000);
   const finish=(error,value)=>{
    if(finished)return;
    finished=true;clearTimeout(timer);
    owner.off("message",onMessage);
    owner.off("exit",onExit);
    if(error)reject(error);
    else resolve(value);
   };
   const onMessage=message=>{
    if(message?.type==="result")finish(null,message.report);
    if(message?.type==="failure")
     finish(Error("original R323 crossUID NO-GO: "+message.error));
   };
   const onExit=code=>finish(Error("native owner exited "+code+
    " "+stderr.slice(-900)));
   owner.on("message",onMessage);
   owner.once("exit",onExit);
   owner.send({type:"run",agentBaseUrl:ready.baseUrl},error=>{
    if(error)finish(error);
   });
  });
  assert.deepEqual(result,{
   ownerUid:1001,workerUid:1002,
   prebound:true,fenced:true,replayDenied:true,
   modelCalls:1,staged:0,a2aIncomplete:true,
   syntheticRootOnly:true,paidInference:false
  });
  // A fresh process with the CORRECT Backend UID, GID, Task and HMAC
  // cannot replay a model request after the R323 owner retired the Child.
  // This proves actual network denial, not only an in-memory ledger call.
  const afterFenceProbe=[
   'const {connectDisposableWorkerModelIpcClient}=await import(process.argv[1]);',
   'const cfg=JSON.parse(process.argv[2]);',
   'const scope=JSON.parse(process.argv[3]);',
   'const client=await connectDisposableWorkerModelIpcClient({',
   ' role:scope.role,socketPath:cfg.modelSocketPath,',
   ' secretFile:cfg.modelSecretFile,originalScopedModelRole:scope});',
   'const task={session_id:cfg.task.session_id,',
   ' task_id:"original-real-crossuid-native-task-01",',
   ' credential_id:"urn:offline:original-child:crossuid-backend",',
   ' runtime_task_id:"dispatch_"+"N".repeat(22)};',
   'try{await client.call({task,callId:"crossuid-after-native-fence-002",',
   ' payload:{contents:[{role:"user",parts:[{text:"REPLAY"}]}]}});',
   ' process.stdout.write("UNSAFE");}',
   'catch(error){if(!String(error.message).includes("model IPC NO-GO"))',
   ' throw error;process.stdout.write("DENIED");}'
  ].join("\n");
  const replay=spawnAs(1002,2301,[],[
   "--input-type=module","-e",afterFenceProbe,OWNER_MODEL,
   JSON.stringify(conf),JSON.stringify(scope)
  ]);
  const replayResult=await new Promise((resolve,reject)=>{
   let stdout="",stderr="";
   replay.stdout.on("data",x=>stdout+=x);
   replay.stderr.on("data",x=>stderr+=x);
   replay.once("error",reject);
   replay.once("close",code=>resolve({code,stdout,stderr}));
  });
  assert.equal(replayResult.code,0,replayResult.stderr.slice(-600));
  assert.equal(replayResult.stdout,"DENIED",
   "closed native Task cannot be replayed over correct-role cross-UID HMAC");
  assert.equal(owner.exitCode,null);
  assert.equal(worker.exitCode,null);
 }finally{
  if(worker){
   if(worker.connected){
    try{worker.send({type:"stop"},()=>{});}
    catch{if(worker.exitCode===null)worker.kill("SIGTERM");}
   }else if(worker.exitCode===null)worker.kill("SIGTERM");
   await awaitExit(worker);
  }
  if(owner){
   if(owner.exitCode===null)owner.kill("SIGTERM");
   await awaitExit(owner);
  }
  await rm(root,{recursive:true,force:true});
 }
});
