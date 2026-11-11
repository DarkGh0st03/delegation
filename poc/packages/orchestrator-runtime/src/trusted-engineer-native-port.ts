/**
 * R171: trusted Software Engineer -> SAME Rust CryptoRuntime through a local
 * Unix-domain socket. No HTTP call, independent issuer or second credential
 * registry. The Rust service enforces Engineer caller role + Core issuer
 * capabilities; policy/approval comes ONLY from TrustedEngineerAuthoritySession.
 *
 * Never expose this module, its bearer or its socket path as ADK/A2A tools.
 */
import {createConnection} from "node:net";
import type {EngineerCredentialPort,RootParameters}
 from "./trusted-engineer-authority.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";
import type {IssuedDelegationCredential,TrustedEngineerCoreConfig}
 from "./trusted-credential-contracts.ts";

interface NativeConfig extends TrustedEngineerCoreConfig {
 nativeSocketPath:string;
}
const FAIL="Trusted Engineer native Rust issuer unavailable";
const SHA_MAX=2*1024*1024;
const own=(x:unknown):x is Record<string,unknown> =>
 x!==null&&typeof x==="object"&&!Array.isArray(x);

export function createNativeRustEngineerCredentialPort(
 config:NativeConfig
):EngineerCredentialPort{
 if(typeof config.nativeSocketPath!=="string"||
    !config.nativeSocketPath.startsWith("/")||
    config.nativeSocketPath.length>100||
    config.nativeSocketPath.trim()!==config.nativeSocketPath||
    typeof config.bearerToken!=="string"||
    config.bearerToken.length<1||
    !Number.isSafeInteger(config.timeoutMs??90000)||
    (config.timeoutMs??90000)<1)
   throw Error(FAIL);
 const socketPath=config.nativeSocketPath;
 const token=config.bearerToken;
 const timeout=config.timeoutMs??90000;

 const call=(operation:"issue_root"|"revoke_root",body:unknown):Promise<unknown>=>
  new Promise((resolve,reject)=>{
   const socket=createConnection({path:socketPath,allowHalfOpen:true});
   let bytes=0,chunks:Buffer[]=[],settled=false;
   const done=(value:unknown,error?:Error)=>{
    if(settled)return;
    settled=true;socket.destroy();
    if(error)reject(error);else resolve(value);
   };
   socket.setTimeout(timeout,()=>done(undefined,Error(FAIL)));
   socket.once("connect",()=>{
    try{
     // Only trusted owner-local fields; never sent to a Gemini model.
     socket.end(JSON.stringify({token,operation,body}));
    }catch{done(undefined,Error(FAIL));}
   });
   socket.on("data",part=>{
    if(settled)return;
    bytes+=part.length;
    if(bytes>SHA_MAX){done(undefined,Error(FAIL));return;}
    chunks.push(part);
   });
   socket.once("end",()=>{
    try{
     const result:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
     if(!own(result)||result.ok!==true||!own(result.result))
      throw Error(FAIL);
     done(result.result);
    }catch{done(undefined,Error(FAIL));}
   });
   socket.once("error",()=>done(undefined,Error(FAIL)));
  });
 return Object.freeze({
  async issueScopedOrchestratorRoot(
   raw:RootParameters&{permissions:readonly DelegatedPermission[]}
  ):Promise<IssuedDelegationCredential>{
   const input=structuredClone(raw);
   if(!own(input)||typeof input.credential_id!=="string"||
      !Array.isArray(input.permissions)||input.permissions.length<1||
      input.permissions.length>128||
      input.permissions.some(p=>!own(p)||typeof p.resource!=="string"||
       !p.resource.startsWith("gitea://")||typeof p.operation!=="string"||
       !p.operation))
    throw Error(FAIL);
   const grants=input.permissions.map(p=>({resource:p.resource,operation:p.operation}));
   const requested={
    credential_id:input.credential_id,delegatee:"orchestrator",
    valid_from:input.valid_from,validity_seconds:input.validity_seconds,
    credential_status:input.credential_status,permissions:grants
   };
   const issued=await call("issue_root",requested);
   if(!own(issued)||issued.id!==input.credential_id||
      !own(issued.credentialSubject)||
      !Array.isArray(issued.credentialSubject.per)||
      issued.credentialSubject.per.length!==grants.length||
      issued.credentialSubject.per.some((p,i)=>
       !own(p)||p.resource!==grants[i]!.resource||
       p.operation!==grants[i]!.operation))
    throw Error(FAIL);
   return issued as unknown as IssuedDelegationCredential;
  },
  async revokeRoot(credential_id:string){
   if(typeof credential_id!=="string"||
      !credential_id.trim()||credential_id.length>256)throw Error(FAIL);
   const result=await call("revoke_root",{credential_id,status_set:true});
   if(!own(result)||result.credential_id!==credential_id||
      result.status_purpose!=="revocation"||
      result.status_set!==true)
     throw Error(FAIL);
  }
 });
}
