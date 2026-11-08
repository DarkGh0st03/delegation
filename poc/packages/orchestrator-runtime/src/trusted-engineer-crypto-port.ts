/**
 * R385.0: canonical Engineer Root DC issuance/revocation selector.
 * Engineer and Gateway use the native Rust Core directly under the
 * authority-only profile. The old MCP -> HTTP Adapter root issuer is loaded
 * lazily and ONLY for selected historical fixture operations.
 * No model, A2A agent or Gateway tool is allowed to select its authority.
 */
import {createNativeRustEngineerCredentialPort}
 from "./trusted-engineer-native-port.ts";
import {createDirectRustEngineerCredentialPort}
 from "./trusted-engineer-direct-core-port.ts";
import type {AdapterClientConfig} from "./authority-adapter-transport.ts";
import type {EngineerCredentialPort,RootParameters}
 from "./trusted-engineer-authority.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

/**
 * Backwards-compatible *lazy* bridge for historical offline fixtures ONLY.
 *
 * Importing the owner selector or choosing the direct Rust path must NEVER
 * evaluate the legacy HTTP client or instantiate an in-process root MCP.
 * Old callers retain a synchronous EngineerCredentialPort constructor and
 * the same asynchronous, one-shot issuance and revocation operations.
 */
export function createOwnerPrivateMcpEngineerCredentialPort(
 config:AdapterClientConfig
):EngineerCredentialPort{
 // Retain the historical synchronous input validation (before any import).
 if(config.adapterBaseUrl.trim().length===0)
  throw Error("Delegation Adapter base URL cannot be empty");
 if(config.bearerToken.trim().length===0)
  throw Error("Engineer Adapter token cannot be empty");
 let loaded:Promise<EngineerCredentialPort>|undefined;
 const legacy=()=>{
  loaded??=import("./trusted-engineer-legacy-mcp-http-port.ts")
   .then(m=>m.createLegacyOwnerPrivateMcpEngineerCredentialPort(config));
  return loaded;
 };
 return Object.freeze({
  async issueScopedOrchestratorRoot(
   input:RootParameters&{permissions:readonly DelegatedPermission[]}
  ){
   // Pin grants before the dynamic module-load await. Never allow a caller
   // to mutate a pending approval while the historical fixture loads.
   const pinned=structuredClone(input);
   return (await legacy()).issueScopedOrchestratorRoot(pinned);
  },
  async revokeRoot(credentialId:string){
   return (await legacy()).revokeRoot(credentialId);
  }
 });
}

/**
 * Canonical trusted-owner selector. When the SAME Rust CryptoRuntime exposes
 * its root-only Unix socket, use it directly; never fall back to HTTP after a
 * native failure. Historical offline fixtures may still use MCP -> Adapter.
 */
export function createTrustedEngineerCredentialPort(
 config:Pick<AdapterClientConfig,"bearerToken"|"timeoutMs">&
  {adapterBaseUrl?:string;fetchFn?:AdapterClientConfig["fetchFn"]}
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
 if(!config.adapterBaseUrl?.trim())
  throw Error("Legacy HTTP Engineer fixture requires explicit Adapter URL");
 return createOwnerPrivateMcpEngineerCredentialPort({
  ...config,adapterBaseUrl:config.adapterBaseUrl
 });
}
