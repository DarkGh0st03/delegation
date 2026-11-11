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
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir,chmod,chown,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {AGENT_CARD_PATH} from "@a2a-js/sdk";

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
  ...(groups.length?["--groups",groups.join(",")]:["--clear-groups"])];
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
 'const {startDisposableOwnerModelIpcServer}=await import(process.argv[1]);',
 'const {createTrustedOwnerEffectStagingServer,TrustedOwnerEffectStagingRegistry}=',
 ' await import(process.argv[2]);',
 'const configs=JSON.parse(process.argv[3]),scopes=JSON.parse(process.argv[4]);',
 'const roles=["backend","frontend","test"];',
 'if(Object.keys(configs).sort().join(",")!==roles.slice().sort().join(",")||',
 ' Object.keys(scopes).sort().join(",")!==roles.slice().sort().join(","))',
 ' throw Error("expected original three roles");',
 'const registry=new TrustedOwnerEffectStagingRegistry(),handles=[];',
 'try{',
 ' for(const role of roles){',
 '  const conf=configs[role],scope=scopes[role];',
 '  if(conf.role!==role||scope.role!==role)throw Error("foreign role");',
 '  const model=await startDisposableOwnerModelIpcServer({',
 '   role,socketPath:conf.modelSocketPath,secretFile:conf.modelSecretFile,',
 '   originalScopedModelRole:scope,authorizeSignedTask:async()=>false,',
 '   invokeModel:async()=>{throw Error("NO GEMINI INFERENCE");}',
 '  });',
 '  handles.push(model);',
 '  const stage=await createTrustedOwnerEffectStagingServer({',
 '   socketPath:conf.stageSocketPath,secretFile:conf.stageSecretFile,',
 '   expectedRole:role,registry,originalScopedEffectRole:scope',
 '  });',
 '  handles.push(stage);await stage.start();',
 ' }',
 '}catch(error){',
 ' await Promise.allSettled(handles.reverse().map(h=>h.close()));',
 ' throw error;',
 '}',
 'process.stdout.write("READY\\n");',
 'process.once("SIGTERM",()=>void Promise.allSettled(',
 ' handles.reverse().map(h=>h.close())).then(items=>process.exit(',
 ' items.every(item=>item.status==="fulfilled")?0:1)));'
].join("\n");

test("all three original specialists simultaneously under ONE offline owner, separate UID/GID and no signed Task",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("Explicit offline Docker root fixture only");return;
 }
 const root=await mkdtemp("/tmp/delegation-three-a2a-");
 let owner;
 const workers=[];
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
  ]);
  await observeReady(owner);
  const pending=[];
  for(const [role,uid,gid] of roles){
   const child=spawnAs(uid,gid,[],[
    "--experimental-strip-types",CHILD
   ],{ipc:true,worker:true});
   workers.push(child);
   pending.push(observeWorker(child));
   child.send({type:"start",config:configs[role],ownerCanaryPath,
    requireOwnerFileIsolation:true,originalScopedRole:scopes[role]});
  }
  const ready=await Promise.all(pending);
  assert.equal(new Set(ready.map(r=>r.pid)).size,3);
  assert.ok(ready.every(r=>r.pid!==owner.pid));
  for(let i=0;i<roles.length;i++){
   const [role,uid,gid,,cardName]=roles[i];
   const actual=ready[i],child=workers[i];
   assert.equal(actual.pid,child.pid);
   assert.equal(actual.role,role);
   assert.equal(actual.baseUrl,"http://127.0.0.1:"+configs[role].port);
   assert.equal(actual.ownerCanaryReadable,false);
   assert.equal(actual.providerCredentialPresent,false);
   assert.equal(actual.originalNativeTaskBindingPresent,false);
   assert.equal(actual.originalTaskBindingChannelReady,true);
   assert.equal(actual.crossUidChannelsConfigured,true);
   assert.equal(actual.osIsolationVerified,false);
   assert.equal(child.exitCode,null);
   const proc=await import("node:fs/promises").then(fs=>
    fs.readFile("/proc/"+child.pid+"/status","utf8"));
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
  assert.equal(owner.exitCode,null);
  // No signed Child, Root, Gemini model call or Gateway effect was started.
 }finally{
  for(const worker of workers.reverse()){
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
