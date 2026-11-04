/**
 * R164: trusted Engineer-only Root DC and revocation transport.
 *
 * The Engineer session decides exact preliminary vs operational grants from
 * trusted Gitea pins + authenticated signed approval, NOT from an MCP call.
 * Each operation uses one in-process MCP SDK exchange with a random opaque
 * ref; the existing Rust Adapter remains the ONLY issuer/status registry.
 * Neither root permission lists, credential IDs, bearer tokens nor DCs are
 * MCP tool parameters or results. No ADK/A2A accessible listener exists.
 */
import {createOwnerPrivateCryptographicMcpSession}
 from "../../../mcp-shared/src/owner-private-child-mcp.ts";
import {createNativeRustEngineerCredentialPort}
 from "./trusted-engineer-native-port.ts";
import {createDirectRustEngineerCredentialPort}
 from "./trusted-engineer-direct-core-port.ts";
import {SoftwareEngineerAuthorityBootstrap}
 from "./authority-client.ts";
import type {AdapterClientConfig} from "./authority-adapter-transport.ts";
import type {EngineerCredentialPort,RootParameters}
 from "./trusted-engineer-authority.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

export function createOwnerPrivateMcpEngineerCredentialPort(
 config:AdapterClientConfig
):EngineerCredentialPort{
 const rust=new SoftwareEngineerAuthorityBootstrap(config);
 return Object.freeze({
  async issueScopedOrchestratorRoot(
   input:RootParameters&{permissions:readonly DelegatedPermission[]}
  ){
   // Snapshot before the first async boundary: a mutable caller cannot
   // change the root ID or grants while a private MCP session initializes.
   const pinned=structuredClone(input);
   return createOwnerPrivateCryptographicMcpSession(
    "root_issue",()=>rust.issueScopedOrchestratorRoot(pinned)
   ).invokeOnce();
  },
  async revokeRoot(credentialId:string){
   // Credential IDs and Rust revocation bearer stay inside the owner.
   return createOwnerPrivateCryptographicMcpSession(
    "root_revoke",()=>rust.revokeRoot(credentialId)
   ).invokeOnce();
  }
 });
}

/**
 * Canonical trusted-owner selector. When the SAME Rust CryptoRuntime exposes
 * its root-only Unix socket, use it directly; never fall back to HTTP after a
 * native failure. Historical offline fixtures may still use MCP -> Adapter.
 */
export function createTrustedEngineerCredentialPort(
 config:AdapterClientConfig
):EngineerCredentialPort{
 const path=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const direct=process.env.ENGINEER_CORE_NATIVE_MODE;
 if(direct!==undefined&&direct!=="1")
  throw Error("Unknown trusted Engineer Core mode");
 if(direct==="1"){
  if(!path||!path.startsWith("/")||path.length>100||path.trim()!==path)
   throw Error("Direct Engineer Core requires sole native Rust delegate socket");
  // This is an in-process Node-API call to the sole Rust issuer owned by
  // the Engineer host; the socket remains for Orchestrator/Agent only.
  return createDirectRustEngineerCredentialPort(config);
 }
 if(path!==undefined){
  if(!path.trim())throw Error("Engineer native socket required");
  return createNativeRustEngineerCredentialPort({
   ...config,nativeSocketPath:path
  });
 }
 // A canonical signed DAG must never downgrade root issuance/revocation
 // to the HTTP Adapter just because its trusted native socket is missing.
 // Explicit historical fixtures without this flag retain their old route.
 if(process.env.APPROVED_RUNNER_NATIVE_MCP==="1")
  throw Error("Canonical Engineer root requires native Rust issuer socket");
 return createOwnerPrivateMcpEngineerCredentialPort(config);
}
