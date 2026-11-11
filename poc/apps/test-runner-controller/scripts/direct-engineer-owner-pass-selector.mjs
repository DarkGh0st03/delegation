import {verifySignedGeminiPilotConsent} from "../../../scripts/signed-gemini-pilot-consent.mjs";
/**
 * R235 — signed DAG owner topology gate.
 *
 * The historical fixture runs two independent planning Node processes on
 * ONE EVM chain because one long-lived HTTP Adapter owns its issuer keys.
 * The new architecture embeds the sole Rust CryptoRuntime in the Software
 * Engineer Node process. Running both plans would initialize independent
 * Rust owners, silently changing signer state on the same public chain.
 *
 * Direct mode runs ONE planning+approved-DAG Node process on a fresh
 * disposable EVM chain. It never creates a second issuer or Adapter HTTP.
 */
export function selectNativeOwnerPasses(env){
 const mode=env.ENGINEER_CORE_NATIVE_MODE;
 if(mode!==undefined&&mode!=="1"&&mode!=="0")
  throw Error("Unknown native Engineer owner mode");
 const direct=mode==="1";
 if(direct){
  const path=env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  if(typeof path!=="string"||!path.startsWith("/")||
     path.trim()!==path||path.length>100||
     env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
     env.ADAPTER_TRUST_PROFILE!=="evm"||
     env.GATEWAY_VERIFIER_MODE!=="core-rust")
   throw Error("Direct Engineer signed DAG requires sole native issuer and Core Rust Gateway");
  if(env.DELEGATION_SIGNED_GEMINI_PILOT==="1"){
   // Never enable inference from a native topology selector. It only
   // checks that the outer paid workflow has the exact one-use manual
   // consent and GitHub source identity. Its CI gate remains independent.
   verifySignedGeminiPilotConsent(env,{requireApiKey:false});
   if(env.APPROVED_RUNNER_NATIVE_EVM!=="1")
    throw Error("Direct Engineer billed pilot requires native EVM trust");
  }
 }
 return Object.freeze({
  preliminaryReadOnlyProcess:!direct,
  signedDagOwnerProcess:true,
  soleEmbeddedRustIssuer:direct
 });
}
