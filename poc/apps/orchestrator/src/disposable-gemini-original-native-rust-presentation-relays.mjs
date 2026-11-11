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
import {chmod,lstat,realpath,unlink} from "node:fs/promises";
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
    socket.setTimeout(12_000,()=>socket.destroy());
    const run=async()=>{
     try{
      if(closed||busy)deny();
      busy=true;
      const chunks=[];let length=0;
      for await(const chunk of socket){
       length+=chunk.length;
       if(length>MAX_BODY)deny();
       chunks.push(chunk);
      }
      if(closed)deny();
      const message=JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
     finally{busy=false;}
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
