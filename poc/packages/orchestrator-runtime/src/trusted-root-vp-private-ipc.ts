/**
 * R130 — Private HMAC Unix socket for fresh root signed presentations.
 * The Orchestrator owns the actual Rust Adapter signer and bearer.
 * Gateway only obtains a signed VP; no child DC/epoch authority is issued.
 */
import {createServer,request as httpRequest,type Server} from "node:http";
import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {lstat,chmod,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {loadTrustedPlanIpcSecret} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {Permission} from "../../../apps/gateway/src/types.ts";
import type {TrustedRootPresentationSigner}
 from "../../../apps/gateway/src/trusted-root-vp-verification.ts";
import {TrustedOrchestratorRootPresenter}
 from "./trusted-orchestrator-root-presenter.ts";

const ROUTE="/v1/private-root-vp",MAX_BODY=270000,MAX_VP=262144;
const HORIZON=30000,MAX_USED=4096;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const AUD=/^[A-Za-z0-9:._/-]{8,256}$/u;
const NONCE=/^[a-f0-9]{64}$/u,MAC=/^[a-f0-9]{64}$/u;
const WIRE=/^[A-Za-z0-9_-]{22}$/u;
const fail=(m:string):never=>{throw Error("R130 private root VP NO-GO: "+m);};
const key=(p:{resource:string;operation:string})=>JSON.stringify([p.resource,p.operation]);
function pathOf(p:string){
 if(typeof p!=="string"||!p.startsWith("/")||p.length>95||p.includes("\u0000"))
  fail("short absolute private socket required");
 return resolve(p);
}
async function ownerDir(p:string){
 const m=await lstat(p);
 if(!m.isDirectory()||m.isSymbolicLink()||(m.mode&0o077)!==0||
    (typeof process.getuid==="function"&&m.uid!==process.getuid()))
  fail("socket directory must be owner-owned, private");
}
function sign(secret:Buffer,time:string,nonce:string,body:Buffer){
 const hash=createHash("sha256").update(body).digest("hex");
 return createHmac("sha256",secret)
  .update(["delegation.root.vp.ipc.v1","POST",ROUTE,time,nonce,hash].join("\n"))
  .digest("hex");
}
function send(res:import("node:http").ServerResponse,code:number,p:object){
 res.writeHead(code,{"content-type":"application/json","cache-control":"no-store"});
 res.end(JSON.stringify(p));
}
export async function createTrustedRootVpSignerServer(config:{
 socketPath:string;secretFile:string;presenter:TrustedOrchestratorRootPresenter;
 rootCredentialId:string;rootPermissions:ReadonlyArray<Permission>;
 audience:string;
}):Promise<{server:Server;start():Promise<void>;close():Promise<void>}>{
 const socket=pathOf(config.socketPath);
 await ownerDir(dirname(socket));
 const secret=await loadTrustedPlanIpcSecret(config.secretFile);
 if(!(config.presenter instanceof TrustedOrchestratorRootPresenter)||
    !ID.test(config.rootCredentialId)||!AUD.test(config.audience)||
    !Array.isArray(config.rootPermissions)||
    !config.rootPermissions.length||config.rootPermissions.length>128)
  fail("pinned real Orchestrator signer and original root required");
 const allowed=new Set<string>();
 for(const g of config.rootPermissions){
  if(!g||typeof g.resource!=="string"||!g.resource.startsWith("gitea://")||
     typeof g.operation!=="string")fail("invalid pinned root grant");
  const k=key(g);if(allowed.has(k))fail("duplicate pinned grant");
  allowed.add(k);
 }
 const seen=new Map<string,number>(),challenges=new Set<string>();
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=="POST"||req.url!==ROUTE){
    send(res,404,{error:"not_found"});return;
   }
   const time=req.headers["x-vp-time"],nonce=req.headers["x-vp-nonce"],
    auth=req.headers["x-vp-hmac"];
   if(typeof time!=="string"||!/^\d{13}$/u.test(time)||
      Math.abs(Date.now()-Number(time))>HORIZON||
      typeof nonce!=="string"||!WIRE.test(nonce)||
      typeof auth!=="string"||!MAC.test(auth)){
    send(res,403,{error:"not_authenticated"});return;
   }
   const pieces:Buffer[]=[];let size=0;
   for await(const part of req){
    const b=Buffer.from(part);size+=b.length;
    if(size>MAX_BODY){send(res,413,{error:"oversized"});return;}
    pieces.push(b);
   }
   const body=Buffer.concat(pieces);
   if(!body.length){send(res,400,{error:"empty"});return;}
   if(!timingSafeEqual(Buffer.from(auth,"hex"),
     Buffer.from(sign(secret,time,nonce,body),"hex"))){
    send(res,403,{error:"not_authenticated"});return;
   }
   const now=Date.now();
   for(const [n,until] of seen)if(until<=now)seen.delete(n);
   if(seen.has(nonce)||seen.size>=MAX_USED){
    send(res,409,{error:"replay"});return;
   }
   seen.set(nonce,now+HORIZON);
   const value:unknown=JSON.parse(body.toString("utf8"));
   if(!value||typeof value!=="object"||Array.isArray(value))fail("invalid request");
   const r=value as Record<string,unknown>;
   if(Object.keys(r).sort().join(",")!==
      "audience,challenge,credential_id,disclosed_permissions"||
      r.credential_id!==config.rootCredentialId||r.audience!==config.audience||
      typeof r.challenge!=="string"||!NONCE.test(r.challenge)||
      !Array.isArray(r.disclosed_permissions)||!r.disclosed_permissions.length||
      r.disclosed_permissions.length>allowed.size)
    fail("root, audience, challenge or grant count mismatch");
   const grants:Permission[]=[],once=new Set<string>();
   for(const v of r.disclosed_permissions){
    if(!v||typeof v!=="object"||Array.isArray(v)||
       Object.keys(v).sort().join(",")!=="operation,resource")
     fail("untrusted permission");
    const g=v as Record<string,unknown>;
    if(typeof g.resource!=="string"||typeof g.operation!=="string")
     fail("invalid permission");
    const k=key({resource:g.resource,operation:g.operation});
    if(once.has(k)||!allowed.has(k))fail("out-of-root or duplicate permission");
    once.add(k);
    grants.push({resource:g.resource,operation:g.operation as Permission["operation"]});
   }
   if(challenges.has(r.challenge)||challenges.size>=MAX_USED){
    send(res,409,{error:"challenge_replay"});return;
   }
   challenges.add(r.challenge); // consume BEFORE signer IO
   const vp=await config.presenter.present({
    credential_id:config.rootCredentialId,audience:config.audience,
    challenge:r.challenge,disclosed_permissions:grants
   });
   if(typeof vp!=="string"||vp.length<16||
      Buffer.byteLength(vp,"utf8")>MAX_VP)fail("invalid signed VP");
   send(res,200,{ok:true,signed_vp:vp});
  }catch{if(!res.headersSent)send(res,403,{error:"root_signing_denied"});}
 });
 let running=false;
 return {
  server,
  async start(){
   if(running)fail("already started");
   await ownerDir(dirname(socket));
   try{await lstat(socket);fail("never replace a preexisting socket");}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   await new Promise<void>((resolve,reject)=>{
    const bad=(e:Error)=>{server.off("listening",ok);reject(e);};
    const ok=()=>{server.off("error",bad);resolve();};
    server.once("error",bad);server.once("listening",ok);server.listen(socket);
   });
   try{await chmod(socket,0o600);}catch(e){server.close();throw e;}
   running=true;
  },
  async close(){
   if(!running)return;
   await new Promise<void>((resolve,reject)=>{
    server.close(e=>e?reject(e):resolve());server.closeAllConnections();
   });running=false;
   try{const m=await lstat(socket);if(m.isSocket())await unlink(socket);}
   catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
 };
}
export class TrustedRootVpSocketClient implements TrustedRootPresentationSigner{
 readonly #socket:string;readonly #secret:Buffer;
 private constructor(socket:string,secret:Buffer){
  this.#socket=socket;this.#secret=secret;
 }
 static async connect(config:{socketPath:string;secretFile:string}){
  return new TrustedRootVpSocketClient(
   pathOf(config.socketPath),
   await loadTrustedPlanIpcSecret(config.secretFile)
  );
 }
 async present(input:Readonly<{credential_id:string;
  disclosed_permissions:ReadonlyArray<Permission>;
  audience:string;challenge:string}>):Promise<string>{
  if(!input||!ID.test(input.credential_id)||!AUD.test(input.audience)||
     !NONCE.test(input.challenge)||
     !Array.isArray(input.disclosed_permissions)||!input.disclosed_permissions.length||
     input.disclosed_permissions.length>128)
   fail("Gateway must supply valid pinned source-free proof request");
  const body=Buffer.from(JSON.stringify({
   credential_id:input.credential_id,audience:input.audience,
   challenge:input.challenge,disclosed_permissions:input.disclosed_permissions
  }));
  if(body.length>MAX_BODY)fail("oversized private request");
  const time=String(Date.now()),nonce=randomBytes(16).toString("base64url"),
   mac=sign(this.#secret,time,nonce,body);
  return new Promise<string>((resolve,reject)=>{
   const req=httpRequest({
    socketPath:this.#socket,method:"POST",path:ROUTE,timeout:5000,
    headers:{"content-type":"application/json","content-length":body.length,
     "x-vp-time":time,"x-vp-nonce":nonce,"x-vp-hmac":mac}
   },res=>{
    let text="",size=0;
    res.on("data",(chunk:Buffer)=>{
     size+=chunk.length;
     if(size>MAX_VP+2048){req.destroy(Error("oversized VP IPC response"));return;}
     text+=chunk.toString("utf8");
    });
    res.once("end",()=>{
     if(res.statusCode!==200){reject(Error("Private root VP signing denied"));return;}
     try{
      const r:unknown=JSON.parse(text);
      if(!r||typeof r!=="object"||Array.isArray(r)||
         Object.keys(r).sort().join(",")!=="ok,signed_vp"||
         (r as {ok:unknown}).ok!==true||
         typeof (r as {signed_vp:unknown}).signed_vp!=="string"||
         (r as {signed_vp:string}).signed_vp.length<16||
         Buffer.byteLength((r as {signed_vp:string}).signed_vp,"utf8")>MAX_VP)
       throw Error("malformed result");
      resolve((r as {signed_vp:string}).signed_vp);
     }catch{reject(Error("Malformed private root VP response"));}
    });
   });
   req.once("timeout",()=>req.destroy(Error("Private root VP IPC timed out")));
   req.once("error",reject);req.end(body);
  });
 }
}
