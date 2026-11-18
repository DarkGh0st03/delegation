/**
 * Trusted, owner-private Child DC issuer transport.
 *
 * Authority lives in TrustedApprovedPlanChildAuthorityIssuer: this port may
 * only receive a command after the immutable signed plan, exact role/grants,
 * one-shot durable intent and live Root checks. It cannot select permissions,
 * mint its own DC or be invoked from an ADK FunctionTool/MCP Agent Task.
 * The signer is the Orchestrator's own Rust wallet (native Unix socket).
 */
import type {CredentialStatusInput,IssuedDelegationCredential}
  from "./trusted-credential-contracts.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";
import {invokeNativeCrypto} from "../../agent-runtime/src/native-crypto-ipc.ts";
import {createOwnerPrivateNativeCryptoMcpSession}
 from "../../../mcp-shared/src/owner-private-native-crypto-stdio.mjs";

export interface ExactTrustedChildIssuance {
  parent_credential_id:string;
  credential_id:string;
  /** Only the Coordinator and native Rust registry select an additional
   * specialist, never A2A/ADK/model data. All extra Child scopes are read-only. */
  delegatee:string;
  valid_from:string;
  validity_seconds:number;
  credential_status:CredentialStatusInput;
  permissions:readonly DelegatedPermission[];
}
export interface TrustedChildCryptographyPort {
  readonly kind:"rust-native";
  issueChild(request:Readonly<ExactTrustedChildIssuance>):Promise<IssuedDelegationCredential>;
  /** Opt-in: the same Rust IPC call made inside a private MCP subprocess. */
  issueChildViaPrivateMcp?(request:Readonly<ExactTrustedChildIssuance>):Promise<IssuedDelegationCredential>;
}
export interface NativeChildPortConfig {
  bearerToken:string;
  timeoutMs?:number;
}

/**
 * Native Child DC signing in the Orchestrator's Rust wallet. The exact
 * grants have already been checked against a signed approved Task; Rust
 * enforces parent, role and capability independently.
 */
export function createNativeRustChildCryptographyPort(
 config:NativeChildPortConfig,socketPath:string
):TrustedChildCryptographyPort {
 if(!config.bearerToken?.trim()||!socketPath.startsWith("/"))
  throw Error("Trusted native Child DC transport unavailable");
 const validate=(result:unknown,request:Readonly<ExactTrustedChildIssuance>)
   :IssuedDelegationCredential=>{
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
 };
 return Object.freeze({
  kind:"rust-native" as const,
  async issueChild(request:Readonly<ExactTrustedChildIssuance>){
   const result=await invokeNativeCrypto({
    socketPath,token:config.bearerToken,timeoutMs:config.timeoutMs??10000
   },"issue_child",request);
   return validate(result,request);
  },
  async issueChildViaPrivateMcp(request:Readonly<ExactTrustedChildIssuance>){
   // Same validated Rust credential; transport failure never silently
   // retries through the original direct or ACK-only MCP route.
   const session=createOwnerPrivateNativeCryptoMcpSession("child_issue",{
    socketPath,bearerToken:config.bearerToken,timeoutMs:config.timeoutMs??10000
   },request);
   return validate(await session.invokeOnce(),request);
  }
 });
}
