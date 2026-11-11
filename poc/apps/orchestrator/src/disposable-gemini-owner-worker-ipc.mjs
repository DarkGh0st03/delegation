/**
 * Disposable Gemini: owner/worker IPC foundation (ZERO provider calls).
 *
 * A worker may hold a role-specific 0600 Unix-channel HMAC credential, but
 * NEVER the owner Gemini API key. The owner holds the real model and MUST
 * independently authorize each ORIGINAL signed Task/Child before executing
 * a request. This transport cannot itself validate Rust-signed Tasks.
 *
 * This is an isolated transport COMPONENT, not a worker process launcher,
 * a model proxy, an Engineer approval, or evidence of OS-level secret
 * separation. Paid Actions startup remains strictly disabled.
 */
import {createServer,request as httpRequest} from "node:http";
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {open,lstat,realpath,chmod,unlink} from "node:fs/promises";
import {dirname,isAbsolute,resolve} from "node:path";
import {readOriginalScopedModelSecret,assertOriginalScopedModelSocket}
 from "./disposable-gemini-original-scoped-model-channel.mjs";

const ROLES=new Set(["backend","frontend","test"]);
const PATH="/v1/private-disposable-model-call";
const MAX_BODY=128*1024,MAX_REPLY=1024*1024;
const MAX_REQUESTS=512,MAX_CLOCK_SKEW=30_000,MAX_TIMEOUT=180_000;
const RUN_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CALL_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const NONCE=/^[A-Za-z0-9_-]{22}$/u;
const HEX=/^[a-f0-9]{64}$/u;
const TASK_KEYS=["credential_id","runtime_task_id","session_id","task_id"];
const MESSAGE_KEYS=["call_id","payload","role","task","version"];
const deny=()=>{throw Error("Disposable owner-worker model IPC NO-GO");};
const exact=(x,keys)=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join(",")===keys.slice().sort().join(",");
const owned=st=>st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&
 (st.mode&0o777)===0o600&&
 (typeof process.getuid!=="function"||st.uid===process.getuid());
async function channelPath(socketPath,secretFile){
 if(typeof socketPath!=="string"||!isAbsolute(socketPath)||
    resolve(socketPath)!==socketPath||socketPath.length>94||
    socketPath.includes("\0")||
    typeof secretFile!=="string"||!isAbsolute(secretFile)||
    resolve(secretFile)!==secretFile||
    dirname(socketPath)!==dirname(secretFile)||socketPath===secretFile)deny();
 const dir=dirname(socketPath),st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o777)!==0o700||
    (typeof process.getuid==="function"&&st.uid!==process.getuid())||
    await realpath(dir)!==dir)deny();
}
async function readRoleSecret(socketPath,secretFile){
 await channelPath(socketPath,secretFile);
 const fd=await open(secretFile,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await fd.stat();
  if(!owned(stat)||stat.size<64||stat.size>65)deny();
  const raw=(await fd.readFile("utf8")).trim();
  if(!HEX.test(raw))deny();
  return Buffer.from(raw,"hex");
 }finally{await fd.close();}
}
function mac(role,secret,epoch,nonce,body){
 const digest=createHash("sha256").update(body).digest("hex");
 return createHmac("sha256",secret).update([
  "delegation.original-owner-gemini-ipc.v1",role,"POST",PATH,
  epoch,nonce,digest
 ].join("\n")).digest("hex");
}
function secureEqual(a,b){
 return typeof a==="string"&&HEX.test(a)&&
 timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function validTask(task){
 return exact(task,TASK_KEYS)&&TASK_KEYS.every(k=>RUN_ID.test(task[k]??""));
}
function validInput(value,role){
 return exact(value,MESSAGE_KEYS)&&value.version===1&&
 value.role===role&&CALL_ID.test(value.call_id??"")&&
 validTask(value.task)&&
 value.payload!==null&&typeof value.payload==="object"&&
 !Array.isArray(value.payload);
}
function reply(res,status,value){
 if(res.headersSent||res.destroyed)return;
 res.writeHead(status,{"content-type":"application/json",
  "cache-control":"no-store"});
 res.end(JSON.stringify(value));
}
function rejectReply(res,status=403){
 reply(res,status,{error:"Disposable owner-worker model IPC NO-GO"});
}

/**
 * This server MUST run in the trusted OWNER process with the private model.
 * The two callbacks are mandatory: 'authorizeSignedTask' is expected to
 * consult the ORIGINAL authenticated Gateway/Child authority. A test stub
 * is NOT that authority. 'invokeModel' is a trusted owner-only operation.
 *
 * No model is constructed or invoked while the listener is created.
 */
export async function startDisposableOwnerModelIpcServer({
 role,socketPath,secretFile,authorizeSignedTask,invokeModel,
 originalScopedModelRole
}={}){
 if(!ROLES.has(role)||typeof authorizeSignedTask!=="function"||
    typeof invokeModel!=="function")deny();
 // Default owner-only mode remains UNCHANGED. Explicit scoped mode
 // requires actual distinct Linux UIDs, dedicated role group, strict
 // HMAC owner and fd metadata: never infer permission from a boolean.
 const scoped=originalScopedModelRole!==undefined;
 const secret=scoped?
  await readOriginalScopedModelSecret({
   role,scope:originalScopedModelRole,side:"owner",
   socketPath,secretFile
  }):await readRoleSecret(socketPath,secretFile);
 try{await lstat(socketPath);deny();}
 catch(error){
  if(error?.code!=="ENOENT")deny();
 }
 const nonces=new Set(),calls=new Set();
 const lifetime=new AbortController();
 let active=false,closing=false,closePromise;
 const server=createServer(async(req,res)=>{
  if(closing||req.method!=="POST"||req.url!==PATH){
   rejectReply(res,404);return;
  }
  let body=Buffer.alloc(0);
  try{
   for await(const part of req){
    body=Buffer.concat([body,part]);
    if(body.length>MAX_BODY)deny();
   }
   const epoch=req.headers["x-delegation-time"];
   const nonce=req.headers["x-delegation-nonce"];
   const signature=req.headers["x-delegation-mac"];
   if(typeof epoch!=="string"||!/^[0-9]{13}$/u.test(epoch)||
      Math.abs(Date.now()-Number(epoch))>MAX_CLOCK_SKEW||
      typeof nonce!=="string"||!NONCE.test(nonce)||
      nonces.has(nonce)||nonces.size>=MAX_REQUESTS||
      !secureEqual(signature,mac(role,secret,epoch,nonce,body))||
      active||closing)deny();
   nonces.add(nonce);
   const data=JSON.parse(body.toString("utf8"));
   if(!validInput(data,role)||calls.has(data.call_id)||
      calls.size>=MAX_REQUESTS)deny();
   calls.add(data.call_id);
   // The worker's HMAC authenticates only the channel. It cannot replace
   // an ORIGINAL signed Child/Task authorization from the trusted owner.
   const admitted=await authorizeSignedTask(Object.freeze({
    role,task:data.task,callId:data.call_id,payload:data.payload
   }));
   if(admitted!==true||active||closing)deny();
   active=true;
   try{
    const result=await Promise.race([
     Promise.resolve().then(()=>invokeModel(Object.freeze({
      role,task:data.task,callId:data.call_id,payload:data.payload,
      signal:lifetime.signal
     }))),
     new Promise((_,reject)=>lifetime.signal.addEventListener(
      "abort",()=>reject(Error("owner retired")),{once:true}))
    ]);
    if(closing||lifetime.signal.aborted||result===undefined)deny();
    const encoded=JSON.stringify({ok:true,result});
    if(typeof encoded!=="string"||
       Buffer.byteLength(encoded)>MAX_REPLY)deny();
    reply(res,200,JSON.parse(encoded));
   }finally{active=false;}
  }catch{rejectReply(res);}
 });
 await new Promise((resolveReady,rejectReady)=>{
  server.once("error",rejectReady);
  server.listen(socketPath,()=>{
   server.off("error",rejectReady);resolveReady();
  });
 });
 try{
  await chmod(socketPath,scoped?0o660:0o600);
  if(scoped)await assertOriginalScopedModelSocket({
   role,scope:originalScopedModelRole,side:"owner",
   socketPath,secretFile
  });
 }
 catch{
  server.closeAllConnections();
  await new Promise(resolveDone=>server.close(()=>resolveDone()));
  await unlink(socketPath).catch(()=>{});
  deny();
 }
 const close=()=>closePromise??=(async()=>{
  closing=true;
  lifetime.abort();
  server.closeAllConnections();
  await new Promise((resolveDone,rejectDone)=>server.close(error=>
   error?rejectDone(error):resolveDone()));
  await unlink(socketPath).catch(error=>{
   if(error?.code!=="ENOENT")throw error;
  });
 })();
 return Object.freeze({
  role,status:()=>closing?"closed_or_closing":"active",
  close
 });
}

/**
 * Worker-side RPC client. It reads ONLY its role-specific IPC HMAC secret,
 * never a provider API key or protected Engineer signing key. A separate
 * OS principal/container is still required to prevent same-UID file reads.
 */
export async function connectDisposableWorkerModelIpcClient({
 role,socketPath,secretFile,originalScopedModelRole
}={}){
 if(!ROLES.has(role))deny();
 const scoped=originalScopedModelRole!==undefined;
 const secret=scoped?
  await readOriginalScopedModelSecret({
   role,scope:originalScopedModelRole,side:"worker",
   socketPath,secretFile
  }):await readRoleSecret(socketPath,secretFile);
 if(scoped){
  await assertOriginalScopedModelSocket({
   role,scope:originalScopedModelRole,side:"worker",
   socketPath,secretFile
  });
 }else{
  const socket=await lstat(socketPath);
  if(!socket.isSocket()||socket.isSymbolicLink()||
     (socket.mode&0o777)!==0o600)deny();
 }
 const call=({task,callId,payload,signal}={})=>new Promise((resolveCall,rejectCall)=>{
  const data={version:1,role,task,call_id:callId,payload};
  if(!validInput(data,role)){rejectCall(Error("Disposable owner-worker model IPC NO-GO"));return;}
  const body=Buffer.from(JSON.stringify(data));
  if(body.length>MAX_BODY){rejectCall(Error("Disposable owner-worker model IPC NO-GO"));return;}
  const epoch=String(Date.now()),nonce=randomBytes(16).toString("base64url");
  const req=httpRequest({
   socketPath,path:PATH,method:"POST",timeout:MAX_TIMEOUT,
   headers:{"content-type":"application/json","content-length":body.length,
    "x-delegation-time":epoch,"x-delegation-nonce":nonce,
    "x-delegation-mac":mac(role,secret,epoch,nonce,body)}
  },res=>{
   let replyBody=Buffer.alloc(0);
   res.on("data",chunk=>{
    replyBody=Buffer.concat([replyBody,chunk]);
    if(replyBody.length>MAX_REPLY)req.destroy(Error("IPC reply too large"));
   });
   res.once("end",()=>{
    try{
     if(res.statusCode!==200)deny();
     const parsed=JSON.parse(replyBody.toString("utf8"));
     if(!exact(parsed,["ok","result"])||parsed.ok!==true)deny();
     resolveCall(parsed.result);
    }catch{rejectCall(Error("Disposable owner-worker model IPC NO-GO"));}
   });
  });
  req.once("error",()=>rejectCall(Error("Disposable owner-worker model IPC NO-GO")));
  req.once("timeout",()=>req.destroy(Error("IPC timeout")));
  if(signal){
   if(signal.aborted)req.destroy(Error("Owner cancelled"));
   else signal.addEventListener("abort",()=>req.destroy(Error("Owner cancelled")),
    {once:true});
  }
  req.end(body);
 });
 return Object.freeze({role,call});
}
