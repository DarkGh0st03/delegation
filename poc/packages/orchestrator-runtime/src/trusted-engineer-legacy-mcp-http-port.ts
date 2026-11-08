/**
 * R385.0 - isolated backwards-compatibility route for historical fixtures.
 *
 * This is NOT the canonical Software Engineer path. Rust Core is accessed
 * directly by the owner in authority-only mode. Only explicitly selected
 * historical offline fixture calls may load this MCP -> HTTP Adapter route.
 */
import {createOwnerPrivateCryptographicMcpSession}
 from "../../../mcp-shared/src/owner-private-child-mcp.ts";
import {assertLegacyEngineerHttpFixtureAllowed}
 from "./trusted-engineer-legacy-fixture-gate.ts";
import type {AdapterClientConfig}
 from "./authority-adapter-transport.ts";
import type {EngineerCredentialPort,RootParameters}
 from "./trusted-engineer-authority.ts";
import type {DelegatedPermission}
 from "./delegated-permission.ts";

export function createLegacyOwnerPrivateMcpEngineerCredentialPort(
 config:AdapterClientConfig
):EngineerCredentialPort{
 assertLegacyEngineerHttpFixtureAllowed();
 // R412: direct legacy callers must retain synchronous constructor
 // validation even though the HTTP issuer is now loaded on demand.
 if(config.adapterBaseUrl.trim().length===0)
  throw Error("Delegation Adapter base URL cannot be empty");
 if(config.bearerToken.trim().length===0)
  throw Error("Engineer Adapter token cannot be empty");
 let loaded:Promise<EngineerCredentialPort>|undefined;
 const historicalIssuer=()=>{
  assertLegacyEngineerHttpFixtureAllowed();
  loaded??=import("./authority-client.ts").then(m=>{
   // A native-profile switch during dynamic import must deny issuance.
   assertLegacyEngineerHttpFixtureAllowed();
   return new m.SoftwareEngineerAuthorityBootstrap(config);
  });
  return loaded;
 };
 return Object.freeze({
  async issueScopedOrchestratorRoot(
   input:RootParameters&{permissions:readonly DelegatedPermission[]}
  ){
   assertLegacyEngineerHttpFixtureAllowed();
   // Snapshot before the first async boundary: a mutable caller cannot
   // change the root ID or grants while a private MCP session initializes.
   const pinned=structuredClone(input);
   return createOwnerPrivateCryptographicMcpSession(
    "root_issue",async()=>{
     assertLegacyEngineerHttpFixtureAllowed();
     const rust=await historicalIssuer();
     assertLegacyEngineerHttpFixtureAllowed();
     return rust.issueScopedOrchestratorRoot(pinned);
    }
   ).invokeOnce();
  },
  async revokeRoot(credentialId:string){
   assertLegacyEngineerHttpFixtureAllowed();
   // Credential IDs and Rust revocation bearer stay inside the owner.
   return createOwnerPrivateCryptographicMcpSession(
    "root_revoke",async()=>{
     assertLegacyEngineerHttpFixtureAllowed();
     const rust=await historicalIssuer();
     assertLegacyEngineerHttpFixtureAllowed();
     return rust.revokeRoot(credentialId);
    }
   ).invokeOnce();
  }
 });
}

