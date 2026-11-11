/**
 * No AI: real Linux cross-UID MODEL IPC. Root is used for OFFLINE
 * fixture provisioning only, never as the specialist or provider owner.
 * This proves a role group and owner-only file boundary in ONE container,
 * NOT independent mount namespaces, original Rust DID or paid readiness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtemp,mkdir,chmod,chown,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";

const SCOPE={role:"backend",ownerUid:1001,workerUid:1002,roleGid:2301};
const MODULE="file:///work/poc/apps/orchestrator/src/disposable-gemini-owner-worker-ipc.mjs";
const TASK={session_id:"offline-original-session",
 task_id:"native-approved-task-offline",
 credential_id:"urn:child:offline:backend",
 runtime_task_id:"dispatch_"+"Q".repeat(22)};
const ownerScript=[
 'const {startDisposableOwnerModelIpcServer}=await import(process.argv[1]);',
 'const cfg=JSON.parse(process.argv[2]);',
 'const task=JSON.parse(process.argv[3]);',
 'const scope=JSON.parse(process.argv[4]);',
 'const server=await startDisposableOwnerModelIpcServer({',
 ' role:"backend",socketPath:cfg.socket,secretFile:cfg.secret,',
 ' originalScopedModelRole:scope,',
 ' authorizeSignedTask:async({role,task:received})=>',
 '  role==="backend"&&JSON.stringify(received)===JSON.stringify(task),',
 ' invokeModel:async()=>({chunks:[{text:"synthetic-cross-uid-original-owner-response"}]})',
 '});',
 'process.stdout.write("READY\\n");',
 'process.once("SIGTERM",()=>void server.close().then(()=>process.exit(0),',
 ' ()=>process.exit(1)));'
].join("\n");
const workerScript=[
 'const {connectDisposableWorkerModelIpcClient}=await import(process.argv[1]);',
 'const {open}=await import("node:fs/promises");',
 'const {constants}=await import("node:fs");',
 'const cfg=JSON.parse(process.argv[2]);',
 'const task=JSON.parse(process.argv[3]);',
 'const scope=JSON.parse(process.argv[4]);',
 'let canaryAccessible=false;',
 'try{const fd=await open(cfg.canary,constants.O_RDONLY|constants.O_NOFOLLOW);',
 ' await fd.close();canaryAccessible=true;}',
 'catch(e){if(!["EACCES","EPERM"].includes(e.code))throw e;}',
 'const client=await connectDisposableWorkerModelIpcClient({',
 ' role:"backend",socketPath:cfg.socket,secretFile:cfg.secret,',
 ' originalScopedModelRole:scope',
 '});',
 'const result=await client.call({',
 ' task,callId:"original-crossuid-owner-model-001",',
 ' payload:{contents:[{role:"user",parts:[{text:"offline only"}]}]}',
 '});',
 'process.stdout.write(JSON.stringify({result,canaryAccessible,',
 ' workerUid:process.getuid(),workerGid:process.getgid(),',
 ' inheritedGeminiKey:process.env.GEMINI_API_KEY??null}));'
].join("\n");
const spawnAs=(uid,gid,groups,script,args)=>{
 const privileges=["--reuid",String(uid),"--regid",String(gid)];
 if(groups.length===0)privileges.push("--clear-groups");
 else privileges.push("--groups",groups.join(","));
 const child=spawn("/usr/bin/setpriv",[
  ...privileges,process.execPath,"--input-type=module","-e",
  script,...args
 ],{
  env:{PATH:"/usr/bin:/bin",LANG:"C.UTF-8",HOME:"/tmp"},
  stdio:["ignore","pipe","pipe"]
 });
 return child;
};
const finish=child=>new Promise((resolve,reject)=>{
 let stdout="",stderr="";
 child.stdout.on("data",x=>stdout+=x);
 child.stderr.on("data",x=>stderr+=x);
 child.once("error",reject);
 child.once("close",code=>resolve({code,stdout,stderr}));
});
const ownerReady=child=>new Promise((resolve,reject)=>{
 let output="",errors="",done=false;
 const timer=setTimeout(()=>{
  if(!done){done=true;reject(Error("owner socket did not become ready"));}
 },15000);
 child.stderr.on("data",c=>errors+=c);
 child.stdout.on("data",c=>{
  output+=c;
  if(!done&&output.includes("READY\n")){
   done=true;clearTimeout(timer);resolve();
  }
 });
 child.once("error",err=>{
  if(!done){done=true;clearTimeout(timer);reject(err);}
 });
 child.once("exit",code=>{
  if(!done){done=true;clearTimeout(timer);
   reject(Error("owner died "+String(code)+" "+errors.slice(0,600)));}
 });
});
test("Linux UID 1001/1002: only the backend group can request the synthetic HMAC model; owner canary is unreadable",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("Offline Docker root fixture only");
  return;
 }
 const root=await mkdtemp("/tmp/delegation-crossuid-");
 await chmod(root,0o755);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=join(root,"model-backend");
 await mkdir(dir,{mode:0o700});
 await chown(dir,1001,2301);
 await chmod(dir,0o2750);
 const secret=join(dir,"model.hex"),socket=join(dir,"model.sock");
 await writeFile(secret,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 await chown(secret,1001,2301);
 await chmod(secret,0o640);
 const protectedDir=join(root,"owner-private");
 await mkdir(protectedDir,{mode:0o700});
 await chown(protectedDir,1001,1101);
 await chmod(protectedDir,0o700);
 const canary=join(protectedDir,"harmless-canary");
 await writeFile(canary,randomBytes(32),{mode:0o600,flag:"wx"});
 await chown(canary,1001,1101);
 await chmod(canary,0o600);
 // A worker must be allowed to CREATE its bind.sock, but MUST NOT be
 // allowed to unlink the owner-owned bind HMAC (sticky owner directory).
 const bindDir=join(root,"bind-backend");
 await mkdir(bindDir,{mode:0o700});
 await chown(bindDir,1001,2301);
 await chmod(bindDir,0o3770);
 const bindSecret=join(bindDir,"bind.hex");
 await writeFile(bindSecret,randomBytes(32).toString("hex")+"\n",
  {mode:0o600,flag:"wx"});
 await chown(bindSecret,1001,2301);
 await chmod(bindSecret,0o640);
 const cfg={socket,secret,canary};
 const argv=[MODULE,JSON.stringify(cfg),JSON.stringify(TASK),
  JSON.stringify(SCOPE)];
 const owner=spawnAs(1001,1101,[2301],ownerScript,argv);
 t.after(async()=>{
  if(owner.exitCode===null)owner.kill("SIGTERM");
  await new Promise(resolve=>{
   if(owner.exitCode!==null||owner.signalCode!==null){
    resolve();return;
   }
   owner.once("close",resolve);
   setTimeout(()=>{if(owner.exitCode===null)owner.kill("SIGKILL");},5000)
    .unref();
  });
 });
 await ownerReady(owner);
 const foreign=await finish(spawnAs(1002,2302,[],workerScript,argv));
 assert.notEqual(foreign.code,0,
  "a foreign role group must not be admitted");
 assert.equal(foreign.stdout.includes("synthetic-cross-uid"),false);
 const unlinkOwnerHmac=[
  'const {unlink}=await import("node:fs/promises");',
  'try{await unlink(process.argv[1]);process.stdout.write("UNLINKED");}',
  'catch(e){if(["EACCES","EPERM"].includes(e.code))',
  'process.stdout.write("DENIED");else throw e;}'
 ].join("\n");
 const forbidden=await finish(spawnAs(1002,2301,[],
  unlinkOwnerHmac,[bindSecret]));
 assert.equal(forbidden.code,0,forbidden.stderr.slice(0,500));
 assert.equal(forbidden.stdout,"DENIED",
  "worker must not unlink owner HMAC in owner-owned sticky directory");
 const worker=await finish(spawnAs(1002,2301,[],workerScript,argv));
 assert.equal(worker.code,0,worker.stderr.slice(0,1500));
 const result=JSON.parse(worker.stdout);
 assert.equal(result.workerUid,1002);
 assert.equal(result.workerGid,2301);
 assert.equal(result.canaryAccessible,false);
 assert.equal(result.inheritedGeminiKey,null);
 assert.deepEqual(result.result,{chunks:[{
  text:"synthetic-cross-uid-original-owner-response"
 }]});
});
