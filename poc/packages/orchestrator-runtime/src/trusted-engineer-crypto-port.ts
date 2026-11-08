/**
 * R417: canonical Software Engineer Root DC issuance/revocation is Rust only.
 * The separately gated historical HTTP fixture is owned elsewhere and
 * never imported here, whether statically, dynamically or as a type.
 */
import {createNativeRustEngineerCredentialPort}
 from "./trusted-engineer-native-port.ts";
import {createDirectRustEngineerCredentialPort}
 from "./trusted-engineer-direct-core-port.ts";
import type {TrustedEngineerCoreConfig}
 from "./trusted-credential-contracts.ts";
import type {EngineerCredentialPort}
 from "./trusted-engineer-authority.ts";

/** No Adapter URL, HTTP fetch, in-process private MCP, or legacy fallback. */
export function createTrustedEngineerCredentialPort(
 config:TrustedEngineerCoreConfig
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
 // R415: fail closed even when the separately exported historical HTTP
 // fixture has an explicit opt-in. No canonical HTTP transport fallback.
 throw Error("Canonical Engineer root requires native Rust issuer socket");
}
