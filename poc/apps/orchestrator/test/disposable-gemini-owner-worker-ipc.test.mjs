/**
 * Real Unix-socket and separate-process security regressions. This test
 * NEVER imports Gemini/Google ADK or sends paid model requests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,createHash,createHmac} from "node:crypto";
import {mkdtemp,writeFile,rm,lstat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {request as httpRequest} from "node:http";
import {startDisposableOwnerModelIpcServer,
 connectDisposableWorkerModelIpcClient}
 from "../src/disposable-gemini-owner-worker-ipc.mjs";

const DENY=/Disposable owner-worker model IPC NO-GO/u;
const task=Object.freeze({
 session_id:"signed-session-123",
 task_id:"original-task-9",
 credential_id:"urn:original-child:123",
 runtime_task_id:"runtime-task-17"
});
const payload=Object.freeze({
 contents:[{role:"user",parts:[{text:"synthetic offline request"}]}]
});
function callId(){return "call-"+randomBytes(12).toString("hex");}
async function setup(t,{role="backend",authorize,invoke}={}){
 const root=await mkdtemp(join(tmpdir(),"dgm-ipc-"));
 const socketPath=join(root,role+".sock");
 const secretFile=join(root,role+".hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{
  mode:0o600,flag:"wx"
 });
 let admitted=0,invocations=0;
 const server=await startDisposableOwnerModelIpcServer({
  role,socketPath,secretFile,
  authorizeSignedTask:async input=>{
   admitted++;
   return authorize?authorize(input):input.task.session_id===task.session_id;
  },
  invokeModel:async input=>{
   invocations++;
   return invoke?invoke(input):Object.freeze({
    // NOT a real Gemini result. The role-scoped worker receives only
    // this serialized data, never provider credentials or the model.
    chunks:[{text:"synthetic-deterministic-owner-response"}]
   });
  }
 });
 t.after(async()=>{
  await server.close().catch(()=>{});
  await rm(root,{recursive:true,force:true});
 });
 const client=await connectDisposableWorkerModelIpcClient({
  role,socketPath,secretFile
 });
 return {root,role,socketPath,secretFile,server,client,
  admitted:()=>admitted,invocations:()=>invocations};
}
function rpc(c,patch={}){
 return c.call({task,callId:callId(),payload,...patch});
}
function rawRpc(f,{epoch=String(Date.now()),nonce=randomBytes(16).toString("base64url"),
 role=f.role,body,signature}={}){
 const encoded=Buffer.from(JSON.stringify(body??{
  version:1,role:f.role,task,call_id:callId(),payload
 }));
 const hash=createHash("sha256").update(encoded).digest("hex");
 const domain=["delegation.original-owner-gemini-ipc.v1",role,"POST",
  "/v1/private-disposable-model-call",epoch,nonce,hash].join("\n");
 return import("node:fs/promises").then(fs=>fs.readFile(f.secretFile,"utf8"))
  .then(secret=>new Promise((resolve,reject)=>{
   const mac=createHmac("sha256",Buffer.from(secret.trim(),"hex"))
    .update(domain).digest("hex");
   const req=httpRequest({
    socketPath:f.socketPath,method:"POST",
    path:"/v1/private-disposable-model-call",
    headers:{"content-type":"application/json",
     "content-length":encoded.length,
     "x-delegation-time":epoch,
     "x-delegation-nonce":nonce,
     "x-delegation-mac":signature??mac}
   },res=>{
    let out="";
    res.on("data",x=>out+=x);
    res.on("end",()=>resolve({status:res.statusCode,
     data:JSON.parse(out)}));
   });
   req.on("error",reject);
   req.end(encoded);
  }));
}

test("separate original role uses protected Unix IPC, not a Google API key",async t=>{
 const f=await setup(t);
 const st=await lstat(f.socketPath);
 assert.equal(st.isSocket(),true);
 assert.equal(st.mode&0o777,0o600);
 const result=await rpc(f.client);
 assert.deepEqual(result,{chunks:[{
  text:"synthetic-deterministic-owner-response"
 }]});
 assert.equal(f.admitted(),1);
 assert.equal(f.invocations(),1);
 assert.equal(JSON.stringify(result).includes("API_KEY"),false);
 await f.server.close();
 assert.equal(f.server.status(),"closed_or_closing");
 await assert.rejects(rpc(f.client),DENY);
});

test("task authorizer fails closed and the owner callback never runs",async t=>{
 const f=await setup(t,{authorize:input=>
  input.task.session_id===task.session_id});
 await assert.rejects(rpc(f.client,{
  task:{...task,session_id:"forged-signed-session"}
 }),DENY);
 assert.equal(f.admitted(),1);
 assert.equal(f.invocations(),0);
 await rpc(f.client);
 assert.equal(f.invocations(),1);
});

test("role spoof, MAC tampering, replayed call ID and stale timestamp deny",async t=>{
 const f=await setup(t);
 const wrongRole=await connectDisposableWorkerModelIpcClient({
  role:"frontend",socketPath:f.socketPath,secretFile:f.secretFile
 });
 await assert.rejects(rpc(wrongRole),DENY);
 assert.equal((await rawRpc(f,{
  signature:"0".repeat(64)
 })).status,403);
 assert.equal((await rawRpc(f,{
  epoch:String(Date.now()-90_000)
 })).status,403);
 const duplicated={version:1,role:"backend",task,
  call_id:callId(),payload};
 const ok=await rawRpc(f,{body:duplicated});
 const replay=await rawRpc(f,{body:duplicated});
 assert.equal(ok.status,200);
 assert.equal(replay.status,403);
 assert.equal(f.invocations(),1);
});

test("oversize input, unknown Task field and unauthenticated IPC path reject",async t=>{
 const f=await setup(t);
 await assert.rejects(rpc(f.client,{
  payload:{contents:[],"blob":"x".repeat(128*1024)}
 }),DENY);
 await assert.rejects(rpc(f.client,{
  task:{...task,model_selected_permission:"root"}
 }),DENY);
 assert.equal(f.invocations(),0);
 assert.equal(f.admitted(),0);
});

test("a real second Node process receives ONLY IPC capability and serialized mock reply",async t=>{
 const marker="OWNER_ONLY_SYNTHETIC_GEMINI_SECRET_DO_NOT_SEND";
 const f=await setup(t,{invoke:({role})=>{
  assert.equal(role,"backend");
  return {chunks:[{text:"worker-visible-offline-answer"}]};
 }});
 const workerScript=`
const {connectDisposableWorkerModelIpcClient}=await import(process.argv[1]);
const client=await connectDisposableWorkerModelIpcClient({
 role:"backend",socketPath:process.argv[2],secretFile:process.argv[3]
});
const result=await client.call({
 task:{session_id:"signed-session-123",task_id:"original-task-9",
 credential_id:"urn:original-child:123",runtime_task_id:"runtime-task-17"},
 callId:"separate-process-call-42",
 payload:{contents:[{role:"user",parts:[{text:"offline"}]}]}
});
process.stdout.write(JSON.stringify({result,
 inheritedProvider:process.env.GEMINI_API_KEY??null,
 inheritedGithub:process.env.GITHUB_TOKEN??null,
 inheritedNodeOptions:process.env.NODE_OPTIONS??null,
 pid:process.pid}));
`;
 const moduleUrl=new URL("../src/disposable-gemini-owner-worker-ipc.mjs",
  import.meta.url).href;
 const child=spawn(process.execPath,[
  "--input-type=module","-e",workerScript,moduleUrl,
  f.socketPath,f.secretFile
 ],{
  cwd:process.cwd(),
  env:{PATH:process.env.PATH??"",HOME:process.env.HOME??"/tmp",
   LANG:"C.UTF-8"},
  stdio:["ignore","pipe","pipe"]
 });
 let output="",errors="";
 child.stdout.on("data",x=>output+=x);
 child.stderr.on("data",x=>errors+=x);
 const status=await new Promise((resolve,reject)=>{
  child.on("error",reject);
  child.on("close",code=>resolve(code));
 });
 assert.equal(status,0,errors.slice(0,300));
 const proof=JSON.parse(output);
 assert.equal(proof.inheritedProvider,null);
 assert.equal(proof.inheritedGithub,null);
 assert.equal(proof.inheritedNodeOptions,null);
 assert.notEqual(proof.pid,process.pid);
 assert.deepEqual(proof.result,{
  chunks:[{text:"worker-visible-offline-answer"}]
 });
 assert.equal(JSON.stringify(proof).includes(marker),false);
 assert.equal(f.invocations(),1);
 // Separate process here is a transport proof, not isolation against
 // a malicious same-UID worker that can read owner-only filesystem files.
});

test("original owner close rejects an in-flight synthetic model response",async t=>{
 let entered;
 const active=new Promise(resolve=>entered=resolve);
 const f=await setup(t,{invoke:async()=>{
  entered();
  await new Promise(()=>{}); // upstream ignores interruption
  return {chunks:[{text:"NOT_RELEASED"}]};
 }});
 // Attach the rejection handler immediately: the RPC socket can close
 // before the asynchronous native owner close() promise settles.
 const rejected=assert.rejects(rpc(f.client),DENY);
 await active;
 await f.server.close();
 await rejected;
 assert.equal(f.server.status(),"closed_or_closing");
});
