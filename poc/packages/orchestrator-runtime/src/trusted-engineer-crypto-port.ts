/**
 * Software Engineer Root DC issuance and revocation are Rust only: the
 * in-process Engineer core, or its native socket. There is no other transport.
 */
import {createNativeRustEngineerCredentialPort}
 from "./trusted-engineer-native-port.ts";
import {createDirectRustEngineerCredentialPort}
 from "./trusted-engineer-direct-core-port.ts";
import type {TrustedEngineerCoreConfig}
 from "./trusted-credential-contracts.ts";
import type {EngineerCredentialPort}
 from "./trusted-engineer-authority.ts";

/** No HTTP, no in-process private MCP, no fallback. */
export function createTrustedEngineerCredentialPort(
 config:TrustedEngineerCoreConfig
):EngineerCredentialPort{
 const ambient=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 const pinned=config.nativeSocketPath;
 if(ambient!==undefined&&pinned!==undefined&&ambient!==pinned)
  throw Error("Conflicting trusted Engineer native Rust socket selection");
 const path=ambient??pinned;
 const direct=process.env.ENGINEER_CORE_NATIVE_MODE;
 if(direct!==undefined&&direct!=="1")
  throw Error("Unknown trusted Engineer Core mode");
 if(direct==="1"){
  if(!ambient||!ambient.startsWith("/")||ambient.length>100||ambient.trim()!==ambient)
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
 // No native transport configured: fail closed.
 throw Error("Canonical Engineer root requires native Rust issuer socket");
}
