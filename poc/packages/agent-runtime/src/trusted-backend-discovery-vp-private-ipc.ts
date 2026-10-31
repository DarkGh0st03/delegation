/**
 * R151.29 — Backend-holder private discovery Child VP IPC.
 *
 * The Backend's Rust Adapter bearer never crosses this socket. Only the
 * trusted Gateway obtains a nonce-bound signed VP for a single exact
 * read_file Child credential. A VP alone NEVER admits a Task or reads Gitea.
 */
import {createServer,request as httpRequest,type Server} from "node:http";
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {lstat,chmod,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import type {Permission} from "../../../apps/gateway/src/types.ts";
import type {TrustedDiscoveryChildPresentationSigner} from
 "../../../apps/gateway/src/trusted-discovery-child-vp-verification.ts";
import {loadTrustedPlanIpcSecret} from
 "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedBackendDiscoveryChildPresenter} from
 "./trusted-backend-discovery-presenter.ts";

const ROUTE="/v1/private-backend-discovery-vp";
const MAX_BODY=4096,MAX_VP=256*1024,AGE=30_000,MAX_NONCES=4096;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const AUD=/^[A-Za-z0-9:._/-]{8,256}$/u;
const CHALLENGE=/^[a-f0-9]{64}$/u,MAC=/^[a-f0-9]{64}$/u;
const WIRE_NONCE=/^[A-Za-z0-9_-]{22}$/u;
const RESOURCE=/^gitea:\/\/[^/?#\s]+\/[^/?#\s]+\/[^/?#\s]+\/branches\/[^/?#\s]+\/files\/[^?#\s]+$/u;
const deny=(message:string):never=>{
 throw Error("Private Backend discovery VP NO-GO: "+message);
};
const grant=(resource:string):Permission=>({resource,operation:"read_file"});
function pathOf(path:string){
 if(typeof path!=="string"||!path.startsWith("/")||path.length>95||
    path.includes("\u0000"))deny("short absolute socket path required");
 return resolve(path);
}
async function ownerDirectory(path:string){
 const st=await lstat(path);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  deny("private owner-owned socket directory required");
}
function mac(secret:Buffer,time:string,nonce:string,body:Buffer){
 const digest=createHash("sha256").update(body).digest("hex");
 return createHmac("sha256",secret)
  .update(["delegation.backend.discovery.vp.ipc.v1","POST",ROUTE,
   time,nonce,digest].join("\n")).digest("hex");
}
function send(res:import("node:http").ServerResponse,status:number,body:object){
 res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
 res.end(JSON.stringify(body));
}
function validProof(value:unknown,id:string,resource:string,audience:string){
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const p=value as Record<string,unknown>;
 if(Object.keys(p).sort().join(",")!==
    "audience,challenge,credential_id,disclosed_permissions"||
    p.credential_id!==id||p.audience!==audience||
    typeof p.challenge!=="string"||!CHALLENGE.test(p.challenge)||
    !Array.isArray(p.disclosed_permissions)||
    p.disclosed_permissions.length!==1)return false;
 const v=p.disclosed_permissions[0];
 return v&&typeof v==="object"&&!Array.isArray(v)&&
    Object.keys(v).sort().join(",")==="operation,resource"&&
    v.resource===resource&&v.operation==="read_file";
}
export async function createTrustedBackendDiscoveryVpSignerServer(config:{
 socketPath:string;secretFile:string;
 presenter:TrustedBackendDiscoveryChildPresenter;
 childCredentialId:string;resource:string;audience:string;
 isTaskActive:()=>boolean;
}):Promise<{server:Server;start():Promise<void>;fence():void;close():Promise<void>}>{
 const socket=pathOf(config.socketPath);
 await ownerDirectory(dirname(socket));
 const secret=await loadTrustedPlanIpcSecret(config.secretFile);
 if(!(config.presenter instanceof TrustedBackendDiscoveryChildPresenter)||
    !ID.test(config.childCredentialId)||!RESOURCE.test(config.resource)||
    config.resource.length>2048||!AUD.test(config.audience)||
    typeof config.isTaskActive!=="function")
  deny("fixed Backend signer, Child, canonical read and lifecycle required");
 let fenced=false,running=false;
 const assertLive=()=>{
  if(fenced||!config.isTaskActive())
   deny("Backend holder inactive, fenced or cancelled");
 };
 assertLive();
 const seen=new Map<string,number>();
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=="POST"||req.url!==ROUTE){
    send(res,404,{error:"not_found"});return;
   }
   const time=req.headers["x-backend-vp-time"],
    nonce=req.headers["x-backend-vp-nonce"],
    signature=req.headers["x-backend-vp-mac"];
   if(typeof time!=="string"||!/^\d{13}$/u.test(time)||
      Math.abs(Date.now()-Number(time))>AGE||
      typeof nonce!=="string"||!WIRE_NONCE.test(nonce)||
      typeof signature!=="string"||!MAC.test(signature)){
    send(res,403,{error:"not_authenticated"});return;
   }
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of req){
    const part=Buffer.from(chunk);bytes+=part.length;
    if(bytes>MAX_BODY){send(res,413,{error:"oversized"});return;}
    chunks.push(part);
   }
   const body=Buffer.concat(chunks);
   if(!body.length){send(res,400,{error:"empty"});return;}
   const expected=mac(secret,time,nonce,body);
   if(!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex"))){
    send(res,403,{error:"not_authenticated"});return;
   }
   const now=Date.now();
   for(const [k,until] of seen)if(until<=now)seen.delete(k);
   if(seen.has(nonce)||seen.size>=MAX_NONCES){
    send(res,409,{error:"replay"});return;
   }
   seen.set(nonce,now+AGE); // before parsing and any native signing
   const value:unknown=JSON.parse(body.toString("utf8"));
   if(!validProof(value,config.childCredentialId,
      config.resource,config.audience))
    deny("request outside fixed read-only Child");
   assertLive();
   const p=value as {credential_id:string;audience:string;challenge:string};
   const vp=await config.presenter.present({
    credential_id:config.childCredentialId,
    audience:config.audience,challenge:p.challenge,
    disclosed_permissions:[grant(config.resource)]
   });
   assertLive(); // cancel DURING Adapter operation must deny response
   if(typeof vp!=="string"||vp.length<16||
      Buffer.byteLength(vp,"utf8")>MAX_VP)
    deny("missing or oversized native signed VP");
   send(res,200,{ok:true,signed_vp:vp});
  }catch{
   if(!res.headersSent)send(res,403,{error:"backend_signing_denied"});
  }
 });
 return {
  server,
  async start(){
   if(running)deny("already started");
   assertLive();await ownerDirectory(dirname(socket));assertLive();
   try{await lstat(socket);deny("preexisting socket cannot be replaced");}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   await new Promise<void>((ok,bad)=>{
    const onError=(e:Error)=>{server.off("listening",onListen);bad(e);};
    const onListen=()=>{server.off("error",onError);ok();};
    server.once("error",onError);
    server.once("listening",onListen);
    server.listen(socket);
   });
   try{await chmod(socket,0o600);}
   catch(e){server.close();throw e;}
   running=true;
  },
  fence(){fenced=true;config.presenter.fence();},
  async close(){
   fenced=true;config.presenter.fence();
   if(!running)return;
   await new Promise<void>((ok,bad)=>{
    server.close(e=>e?bad(e):ok());server.closeAllConnections();
   });
   running=false;
   try{const st=await lstat(socket);if(st.isSocket())await unlink(socket);}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
 };
}
/** Client belongs in trusted Gateway process; it never sees Backend bearer. */
export class TrustedBackendDiscoveryVpSocketClient
 implements TrustedDiscoveryChildPresentationSigner{
 readonly #socket:string;
 readonly #secret:Buffer;
 private constructor(socket:string,secret:Buffer){
  this.#socket=socket;this.#secret=secret;
 }
 static async connect(config:{socketPath:string;secretFile:string}){
  return new TrustedBackendDiscoveryVpSocketClient(
   pathOf(config.socketPath),await loadTrustedPlanIpcSecret(config.secretFile));
 }
 async present(input:Readonly<{
  credential_id:string;audience:string;challenge:string;
  disclosed_permissions:ReadonlyArray<Permission>;
 }>):Promise<string>{
  if(!input||!ID.test(input.credential_id)||
     !AUD.test(input.audience)||!CHALLENGE.test(input.challenge)||
     !Array.isArray(input.disclosed_permissions)||
     input.disclosed_permissions.length!==1||
     !input.disclosed_permissions[0]||
     input.disclosed_permissions[0].operation!=="read_file"||
     typeof input.disclosed_permissions[0].resource!=="string"||
     !RESOURCE.test(input.disclosed_permissions[0].resource))
   deny("only one pinned read-only Child request accepted");
  const body=Buffer.from(JSON.stringify({
   credential_id:input.credential_id,audience:input.audience,
   challenge:input.challenge,disclosed_permissions:input.disclosed_permissions
  }),"utf8");
  if(body.length>MAX_BODY)deny("oversized request");
  const time=String(Date.now()),nonce=randomBytes(16).toString("base64url"),
   signature=mac(this.#secret,time,nonce,body);
  return new Promise<string>((ok,bad)=>{
   const req=httpRequest({
    socketPath:this.#socket,method:"POST",path:ROUTE,timeout:5000,
    headers:{"content-type":"application/json","content-length":body.length,
     "x-backend-vp-time":time,"x-backend-vp-nonce":nonce,
     "x-backend-vp-mac":signature}
   },res=>{
    let value="",count=0;
    res.on("data",(part:Buffer)=>{
     count+=part.length;
     if(count>MAX_VP+1024){
      req.destroy(Error("oversized Backend VP response"));return;
     }
     value+=part.toString("utf8");
    });
    res.once("end",()=>{
     if(res.statusCode!==200){
      bad(Error("Private Backend discovery VP denied"));return;
     }
     try{
      const r:unknown=JSON.parse(value);
      if(!r||typeof r!=="object"||Array.isArray(r)||
         Object.keys(r).sort().join(",")!=="ok,signed_vp"||
         (r as {ok:unknown}).ok!==true||
         typeof (r as {signed_vp:unknown}).signed_vp!=="string"||
         (r as {signed_vp:string}).signed_vp.length<16||
         Buffer.byteLength((r as {signed_vp:string}).signed_vp,"utf8")>MAX_VP)
       throw Error("invalid response");
      ok((r as {signed_vp:string}).signed_vp);
     }catch{bad(Error("Malformed private Backend VP response"));}
    });
   });
   req.once("timeout",()=>req.destroy(Error("Backend discovery VP IPC timed out")));
   req.once("error",bad);
   req.end(body);
  });
 }
}
