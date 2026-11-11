/**
 * FREE-only role-scoped VP transport to the ONE original Rust CryptoRuntime.
 * Exactly three specialist endpoints, not three signers or new agents.
 * Rust keeps the sole authority to sign and verify every Child/Gateway VP.
 * Source credentials and Root/Engineer tokens never cross this transport.
 *
 * This is an isolated component, NOT full signed/paid E2E attestation.
 */
import {createServer} from "node:net";
import {createHash,timingSafeEqual} from "node:crypto";
import {chmod,lstat,realpath,readFile,unlink} from "node:fs/promises";
import {dirname,isAbsolute,resolve} from "node:path";
import {invokeNativeCryptoWire}
 from "../../../mcp-shared/src/native-rust-transport.mjs";

const ROLES=Object.freeze(["backend","frontend","test"]);
const MAX_BODY=110_000;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const deny=()=>{throw Error("Original native Rust role relay NO-GO");};
const exact=(v,keys)=>!!v&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join(",")===keys.slice().sort().join(",");
const triple=v=>v&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join(",")===ROLES.slice().sort().join(",");
const digest=s=>createHash("sha256").update(s).digest();
const equals=(a,b)=>typeof a==="string"&&
 timingSafeEqual(digest(a),digest(b));

function validPresentation(body){
 return exact(body,["audience","challenge","credential_id",
  "disclosed_permissions"])&&
  ID.test(body.credential_id??"")&&
  typeof body.audience==="string"&&body.audience.length>=1&&
  body.audience.length<=512&&
  typeof body.challenge==="string"&&body.challenge.length>=8&&
  body.challenge.length<=512&&
  Array.isArray(body.disclosed_permissions)&&
  body.disclosed_permissions.length===1&&
  exact(body.disclosed_permissions[0],["operation","resource"])&&
  typeof body.disclosed_permissions[0].resource==="string"&&
  body.disclosed_permissions[0].resource.startsWith("gitea://")&&
  body.disclosed_permissions[0].resource.length<=2048&&
  ["read_file","update_file","create_file","run_tests"].includes(
   body.disclosed_permissions[0].operation);
}
async function checkOriginalRustSocket(path,uid){
 if(typeof path!=="string"||!isAbsolute(path)||
    resolve(path)!==path||path.length>95||path.includes("\0"))deny();
 try{
  const st=await lstat(path),parent=dirname(path),dir=await lstat(parent);
  if(!st.isSocket()||st.isSymbolicLink()||st.nlink!==1||
     st.uid!==uid||(st.mode&0o777)!==0o600||
     !dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==uid||
     (dir.mode&0o777)!==0o700||
     await realpath(parent)!==parent||await realpath(path)!==path)deny();
 }catch{deny();}
}
async function checkRoleDirectory(path,scope){
 if(typeof path!=="string"||!isAbsolute(path)||
    resolve(path)!==path||path.length>95||path.includes("\0"))deny();
 try{
  const parent=dirname(path),dir=await lstat(parent);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     dir.uid!==scope.ownerUid||dir.gid!==scope.roleGid||
     (dir.mode&0o7777)!==0o2750||
     await realpath(parent)!==parent)deny();
  try{await lstat(path);deny();}
  catch(error){if(error?.code!=="ENOENT")deny();}
 }catch{deny();}
}
function respond(socket,result){
 if(socket.destroyed)return;
 socket.end(JSON.stringify(result??{
  ok:false,error:"native_rust_role_presentation_denied"
 }));
}
// Do NOT use a Readable async iterator here: Node destroys a net.Socket
// when for-await finishes even with allowHalfOpen:true. The native wire
// protocol half-closes requests and still needs the writable reply side.
function readHalfClosedRequest(socket){
 return new Promise((resolveRead,rejectRead)=>{
  const chunks=[];let length=0,done=false;
  const finish=(error,result)=>{
   if(done)return;done=true;
   socket.off("data",onData);
   socket.off("end",onEnd);
   socket.off("error",onError);
   socket.off("close",onClose);
   if(error)rejectRead(error);else resolveRead(result);
  };
  const onData=chunk=>{
   length+=chunk.length;
   if(length>MAX_BODY)finish(Error("too large"));
   else chunks.push(chunk);
  };
  const onEnd=()=>finish(null,Buffer.concat(chunks));
  const onError=()=>finish(Error("socket error"));
  const onClose=()=>finish(Error("socket closed"));
  socket.on("data",onData);
  socket.once("end",onEnd);
  socket.once("error",onError);
  socket.once("close",onClose);
 });
}

/**
 * Run in already-unprivileged original Owner UID. Worker-provided A2A and
 * model text MUST NOT supply authorizeNativePresentation: it is the owner
 * closure over authentic R323 Coordinator/Child/Gateway Task receipts.
 * The three role tokens are pre-existing Rust CallerRegistry Agent tokens.
 */
export async function startDisposableOriginalNativeRustPresentationRelays({
 originalNativeSocketPath,roleSockets,roleTokens,scopes,
 authorizeNativePresentation,offlineSyntheticOnly
}={}){
 if(offlineSyntheticOnly!==true||process.platform!=="linux"||
    typeof process.getuid!=="function"||process.getuid()===0||
    process.env.DELEGATION_DISPOSABLE_LIVE_MODE!==undefined||
    ["GEMINI_API_KEY","GOOGLE_API_KEY","OPENAI_API_KEY",
     "GOOGLE_APPLICATION_CREDENTIALS"].some(k=>Object.hasOwn(process.env,k))||
    !triple(roleSockets)||!triple(roleTokens)||!triple(scopes)||
    typeof authorizeNativePresentation!=="function")deny();
 const uid=process.getuid();
 await checkOriginalRustSocket(originalNativeSocketPath,uid);
 const uids=new Set(),gids=new Set(),paths=new Set([originalNativeSocketPath]),
  tokens=new Set();
 for(const role of ROLES){
  const scope=scopes[role],path=roleSockets[role],token=roleTokens[role];
  if(!exact(scope,["ownerUid","role","roleGid","workerUid"])||
     scope.ownerUid!==uid||scope.role!==role||
     !Number.isSafeInteger(scope.workerUid)||scope.workerUid<=0||
     scope.workerUid===uid||
     !Number.isSafeInteger(scope.roleGid)||scope.roleGid<=0||
     typeof token!=="string"||token.length<8||token.length>8192||
     paths.has(path)||tokens.has(token))deny();
  paths.add(path);tokens.add(token);
  uids.add(scope.workerUid);gids.add(scope.roleGid);
  await checkRoleDirectory(path,scope);
 }
 if(uids.size!==3||gids.size!==3||paths.size!==4)deny();
 // A role VP relay lives only in the already-privilege-dropped ORIGINAL
 // Owner, never in the UID=0 provisioning parent or a user sharing worker
 // credentials. The kernel, not a worker-supplied ready flag, is evidence.
 let proc;
 try{proc=await readFile("/proc/self/status","utf8");}
 catch{deny();}
 const field=name=>proc.split("\n").find(line=>
  line.startsWith(name+":")
 )?.slice(name.length+1).trim();
 const numbers=name=>field(name)?.split(/\s+/u).map(Number);
 const ownerUids=numbers("Uid"),ownerGids=numbers("Gid");
 const ownerGroups=numbers("Groups");
 if(!ownerUids||ownerUids.length!==4||
    ownerUids.some(v=>v!==uid)||
    !ownerGids||ownerGids.length!==4||
    ownerGids.some(v=>v!==ownerGids[0])||
    ownerGids[0]===0||gids.has(ownerGids[0])||
    !ownerGroups||ownerGroups.length!==3||
    new Set(ownerGroups).size!==3||
    ownerGroups.some(v=>!gids.has(v))||
    field("NoNewPrivs")!=="1"||
    !/^0+$/u.test(field("CapEff")??""))deny();
 const handles=[],counts=Object.fromEntries(ROLES.map(role=>[role,0]));
 let closed=false,closing;
 const close=()=>{
  closed=true;
  return closing??=Promise.allSettled(handles.reverse().map(
   ({server,sockets,path})=>{
    for(const sock of sockets)sock.destroy();
    return new Promise((resolveDone,rejectDone)=>server.close(async err=>{
     try{
      if(err)throw err;
      await unlink(path).catch(e=>{if(e?.code!=="ENOENT")throw e;});
      resolveDone();
     }catch(e){rejectDone(e);}
    }));
   }
  )).then(outcomes=>{
   if(outcomes.some(x=>x.status==="rejected"))deny();
  });
 };
 try{
  for(const role of ROLES){
   const path=roleSockets[role],sockets=new Set();
   let busy=false;
   const server=createServer({allowHalfOpen:true},socket=>{
    sockets.add(socket);socket.on("close",()=>sockets.delete(socket));
    // A peer disconnecting during a Rust call must never crash the Owner
    // through an unhandled net.Socket error after request EOF.
    socket.on("error",()=>{});
    socket.setTimeout(12_000,()=>socket.destroy());
    const run=async()=>{
     let acquired=false;
     try{
      if(closed||busy)deny();
      busy=true;acquired=true;
      const body=await readHalfClosedRequest(socket);
      if(closed)deny();
      const message=JSON.parse(body.toString("utf8"));
      if(!exact(message,["body","operation","token"])||
         message.operation!=="create_presentation"||
         !equals(message.token,roleTokens[role])||
         !validPresentation(message.body))deny();
      const credentialId=message.body.credential_id;
      if(authorizeNativePresentation({role,credentialId})!==true)deny();
      // No new signing key, issuer, HTTP endpoint or cryptographic fallback:
      // the SAME original owner-private Rust runtime verifies the role
      // token, credential, permission and challenge before returning a VP.
      const result=await invokeNativeCryptoWire({
       socketPath:originalNativeSocketPath,token:roleTokens[role],
       timeoutMs:10000
      },"create_presentation",message.body);
      if(closed||!result||typeof result!=="object"||
         typeof result.signed_vp!=="string"||!result.signed_vp.trim()||
         authorizeNativePresentation({role,credentialId})!==true)deny();
      counts[role]++;
      respond(socket,{ok:true,result});
     }catch{respond(socket);}
     finally{if(acquired)busy=false;}
    };
    void run();
   });
   await new Promise((resolveReady,rejectReady)=>{
    server.once("error",rejectReady);
    server.listen(path,()=>{
     server.off("error",rejectReady);resolveReady();
    });
   });
   handles.push({server,sockets,path});
   await chmod(path,0o660);
   const st=await lstat(path);
   if(!st.isSocket()||st.isSymbolicLink()||
      st.uid!==uid||st.gid!==scopes[role].roleGid||
      (st.mode&0o777)!==0o660)deny();
  }
 }catch{
  await close().catch(()=>{});
  deny();
 }
 return Object.freeze({
  paths:Object.freeze({...roleSockets}),
  close,
  snapshot:()=>Object.freeze({
   closed,forwarded:Object.freeze({...counts}),
   original_rust_signature_verified_here:false,
   paid_gemini_authorized:false
  })
 });
}
