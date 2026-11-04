/**
 * R161: trusted, OWNER-PRIVATE child credential issuer transport.
 *
 * Authority lives in TrustedApprovedPlanChildAuthorityIssuer: this port may
 * only receive a command after the immutable signed plan, exact role/grants,
 * one-shot durable intent and live root checks. It cannot select permissions,
 * mint its own DC or be invoked from an ADK FunctionTool/MCP Agent Task.
 *
 * The current signer is still the existing Rust Adapter (single issuer
 * identity, revocation and status registry). A later private crypto MCP port
 * can replace this transport without adding a model-visible issuance tool.
 */
import type {CredentialStatusInput,IssuedDelegationCredential}
  from "./authority-client.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";
import {createOwnerPrivateChildMcpSession}
  from "../../../mcp-shared/src/owner-private-child-mcp.ts";
import {invokeNativeCrypto} from "../../agent-runtime/src/native-crypto-ipc.ts";

type FetchLike=typeof fetch;
export interface ExactTrustedChildIssuance {
  parent_credential_id:string;
  credential_id:string;
  delegatee:"backend"|"frontend"|"test";
  valid_from:string;
  validity_seconds:number;
  credential_status:CredentialStatusInput;
  permissions:readonly DelegatedPermission[];
}
export interface TrustedChildCryptographyPort {
  readonly kind:"rust-adapter"|"rust-native"|"owner-private-crypto-mcp";
  issueChild(request:Readonly<ExactTrustedChildIssuance>):Promise<IssuedDelegationCredential>;
}
export interface RustAdapterChildPortConfig {
  adapterBaseUrl:string;
  bearerToken:string;
  fetchFn?:FetchLike;
  timeoutMs?:number;
}

export function createRustAdapterChildCryptographyPort(
 config:RustAdapterChildPortConfig
):TrustedChildCryptographyPort {
 if(typeof config.adapterBaseUrl!=="string"||
    !/^https?:\/\//u.test(config.adapterBaseUrl)||
    !config.adapterBaseUrl.trim()||
    !config.bearerToken.trim()||
    !Number.isSafeInteger(config.timeoutMs??5000)||
    (config.timeoutMs??5000)<1)
   throw Error("Private Rust Adapter issuance transport unavailable");
 const base=config.adapterBaseUrl.replace(/\/+$/u,"");
 const send=config.fetchFn??fetch;
 const timeout=config.timeoutMs??5000;
 return Object.freeze({
  kind:"rust-adapter" as const,
  async issueChild(request:Readonly<ExactTrustedChildIssuance>) {
   // No schema-inferred grants: the caller must pass only the exact
   // previously authenticated, approved permissions.
   const response=await send(base+"/v1/credentials/child",{
    method:"POST",
    headers:{authorization:"Bearer "+config.bearerToken,
      "content-type":"application/json",accept:"application/json"},
    body:JSON.stringify(request),
    signal:AbortSignal.timeout(timeout)
   });
   if(!response.ok)
    throw Error("Trusted child DC: Adapter rejected exact signed Task child issuance");
   try{return await response.json() as IssuedDelegationCredential;}
   catch{throw Error("Trusted child DC: Adapter child issuance response is malformed");}
  }
 });
}

/**
 * Native Child DC signing in the SAME Rust process as the Engineer's root.
 * The caller supplied exact grants have already been checked against a
 * signed approved Task. Rust enforces parent/role/capability independently.
 */
export function createNativeRustChildCryptographyPort(
 config:RustAdapterChildPortConfig,socketPath:string
):TrustedChildCryptographyPort {
 if(!config.bearerToken?.trim()||!socketPath.startsWith("/"))
  throw Error("Trusted native Child DC transport unavailable");
 return Object.freeze({
  kind:"rust-native" as const,
  async issueChild(request:Readonly<ExactTrustedChildIssuance>){
   const result=await invokeNativeCrypto({
    socketPath,token:config.bearerToken,timeoutMs:config.timeoutMs??10000
   },"issue_child",request);
   if(!result||typeof result!=="object"||Array.isArray(result)||
      (result as {id?:unknown}).id!==request.credential_id)
    throw Error("Native Rust Child DC identity mismatch");
   const subject=(result as {credentialSubject?:{per?:unknown}}).credentialSubject;
   const rights=subject?.per;
   if(!Array.isArray(rights)||rights.length!==request.permissions.length||
      rights.some((p,i)=>!p||typeof p!=="object"||
       (p as {resource?:unknown}).resource!==request.permissions[i]!.resource||
       (p as {operation?:unknown}).operation!==request.permissions[i]!.operation))
    throw Error("Native Rust Child DC changed signed permissions");
   return result as IssuedDelegationCredential;
  }
 });
}

/**
 * R162: real MCP SDK exchange inside the trusted owner process.
 * The existing Rust Adapter is the sole issuer and revocation authority;
 * no new keys, status registry or model-facing tool are created.
 */
export function createOwnerPrivateMcpChildCryptographyPort(
 config:RustAdapterChildPortConfig
):TrustedChildCryptographyPort{
 const rust=createRustAdapterChildCryptographyPort(config);
 return Object.freeze({
  kind:"owner-private-crypto-mcp" as const,
  async issueChild(request:Readonly<ExactTrustedChildIssuance>){
   const session=createOwnerPrivateChildMcpSession(
     ()=>rust.issueChild(request)
   );
   return session.invokeOnce();
  }
 });
}
