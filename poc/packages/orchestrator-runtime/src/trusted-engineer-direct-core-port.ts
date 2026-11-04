/**
 * R225: Software Engineer -> Core Rust in its own process through Node-API.
 *
 * NO Adapter HTTP, NO Unix socket and NO MCP are called by this port.
 * The addon owns the one Rust CryptoRuntime on a single Rust thread; a
 * separately authenticated Unix socket in that SAME process is used only
 * by Orchestrator/Agent delegated Child DC and presentation operations.
 *
 * This route must not silently fall back to the old socket/HTTP transport.
 * The trusted Engineer host alone decides whether the reviewed Task may
 * request a preliminary/operational root and revocation.
 */
import {createRequire} from "node:module";
import type {AdapterClientConfig} from "./authority-adapter-transport.ts";
import type {EngineerCredentialPort,RootParameters}
 from "./trusted-engineer-authority.ts";
import type {IssuedDelegationCredential} from "./authority-client.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

const requireAddon=createRequire(import.meta.url);
const FAIL="Trusted Software Engineer direct Rust Core unavailable";

export interface EngineerRustCoreBinding {
 start_engineer_core():void;
 issue_engineer_root(token:string,payloadJson:string):Promise<string>;
 revoke_engineer_root(token:string,payloadJson:string):Promise<string>;
}

let startup:"unstarted"|"ready"|"failed"="unstarted";
let trustedBinding:EngineerRustCoreBinding|undefined;
const object=(value:unknown):value is Record<string,unknown>=>
 value!==null&&typeof value==="object"&&!Array.isArray(value);

export function loadDirectRustEngineerCore():EngineerRustCoreBinding{
 if(startup==="ready"&&trustedBinding)return trustedBinding;
 if(startup!=="unstarted")throw Error(FAIL);
 // Reserve before loading any potentially partial native state.
 startup="failed";
 let loaded:unknown;
 try{
  // Match the Gateway's fixed packaged native-addon path. Not supplied by
  // the model, a URL, an A2A Task or an arbitrary environment filename.
  loaded=requireAddon("./native/delegation-engineer.node");
 }catch{throw Error(FAIL);}
 if(!object(loaded)||
    typeof loaded.start_engineer_core!=="function"||
    typeof loaded.issue_engineer_root!=="function"||
    typeof loaded.revoke_engineer_root!=="function")
   throw Error(FAIL);
 try{(loaded.start_engineer_core as ()=>void)();}
 catch{throw Error(FAIL);}
 trustedBinding=loaded as unknown as EngineerRustCoreBinding;
 startup="ready";
 return trustedBinding;
}

/** Injected binding is for OFFLINE tests only; production loads fixed addon. */
export function createDirectRustEngineerCredentialPort(
 config:Pick<AdapterClientConfig,"bearerToken">, injectedBinding?:EngineerRustCoreBinding
):EngineerCredentialPort{
 const token=config.bearerToken;
 if(typeof token!=="string"||!token.trim())
  throw Error(FAIL);
 const native=injectedBinding??loadDirectRustEngineerCore();
 if(!native||typeof native.issue_engineer_root!=="function"||
    typeof native.revoke_engineer_root!=="function")
  throw Error(FAIL);

 return Object.freeze({
  async issueScopedOrchestratorRoot(
   input:RootParameters&{permissions:readonly DelegatedPermission[]}
  ):Promise<IssuedDelegationCredential>{
   // Pin input before the first await; no mutation of permission lists
   // while the native issuer is processing a reviewed Engineer approval.
   const snapshot=structuredClone(input);
   if(!snapshot||typeof snapshot.credential_id!=="string"||
      !snapshot.credential_id.trim()||
      !Array.isArray(snapshot.permissions)||
      snapshot.permissions.length<1||snapshot.permissions.length>128||
      snapshot.permissions.some(p=>!p||
        typeof p.resource!=="string"||!p.resource.startsWith("gitea://")||
        typeof p.operation!=="string"||!p.operation))
     throw Error(FAIL);
   const rights=snapshot.permissions.map(p=>({
    resource:p.resource,operation:p.operation
   }));
   const body={
    credential_id:snapshot.credential_id,
    delegatee:"orchestrator",
    valid_from:snapshot.valid_from,
    validity_seconds:snapshot.validity_seconds,
    credential_status:snapshot.credential_status,
    permissions:rights
   };
   let output:unknown;
   try{output=JSON.parse(await native.issue_engineer_root(token,JSON.stringify(body)));}
   catch{throw Error(FAIL);}
   if(!object(output)||output.id!==snapshot.credential_id||
      !object(output.credentialSubject)||
      !Array.isArray(output.credentialSubject.per)||
      output.credentialSubject.per.length!==rights.length||
      output.credentialSubject.per.some((p,i)=>!object(p)||
       p.resource!==rights[i]!.resource||p.operation!==rights[i]!.operation))
     throw Error(FAIL);
   return output as unknown as IssuedDelegationCredential;
  },
  async revokeRoot(credentialId:string):Promise<void>{
   if(typeof credentialId!=="string"||!credentialId.trim())
    throw Error(FAIL);
   let output:unknown;
   try{output=JSON.parse(await native.revoke_engineer_root(
    token,JSON.stringify({credential_id:credentialId,status_set:true})
   ));}
   catch{throw Error(FAIL);}
   if(!object(output)||output.credential_id!==credentialId||
      output.status_set!==true||output.status_purpose!=="revocation")
    throw Error(FAIL);
  }
 });
}
