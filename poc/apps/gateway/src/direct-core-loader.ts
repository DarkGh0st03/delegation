/**
 * Native binding loader for the future in-process Gateway→Core Rust path.
 *
 * This module deliberately has NO JavaScript fallback and NEVER proxies
 * native-mode verification through the issuing Adapter. The library is
 * loaded from a fixed build artifact within this repository's Gateway
 * package; users cannot choose an arbitrary library path via HTTP or env.
 *
 * The real Node-API addon is built from services/delegation-core-node and
 * reads independent DID/EVM/accumulator/status evidence. The deployment must
 * place its build artifact at ./native/delegation-core.node before startup.
 * Missing artifacts or unavailable trust material fail startup CLOSED; never
 * fall back to the HTTP issuing Adapter.
 */
import { createRequire } from "node:module";
import type {CoreRustBinding,CoreRustIdentityMap} from "./direct-core-verifier.ts";
import {DirectCoreRustVerifier} from "./direct-core-verifier.ts";

const requireNative=createRequire(import.meta.url);

/** Read only the SAME bounded native deployment roster as the Rust Engineer.
 * This map is a presenter identity expectation, not a VP validity shortcut.
 * DirectCoreRustVerifier independently requires unique DIDs and an actual
 * native signature/trust/status verification for every delegated operation. */
export function trustedCoreRustIdentitiesFromEnvironment(
 env:Readonly<Record<string,string|undefined>>=process.env
):CoreRustIdentityMap {
 const value=(name:string):string=>{
  const did=env[name];
  if(typeof did!=="string"||!did||did.trim()!==did||
     did.length>1024||!did.startsWith("did:"))
   throw Error("Missing trusted Rust Core identity: "+name);
  return did;
 };
 const raw=env.ADAPTER_ADDITIONAL_SPECIALISTS??"";
 if(typeof raw!=="string"||raw.length>325)
  throw Error("Invalid native Rust Core additional specialist roster");
 const additional=raw===""?[]:raw.split(",");
 const legal=/^[a-z][a-z0-9_-]{0,23}$/u;
 if(additional.length>13||new Set(additional).size!==additional.length||
    additional.some(role=>!legal.test(role)||
      ["engineer","gateway","orchestrator","backend","frontend","test",
       "constructor","prototype"].includes(role)))
  throw Error("Invalid native Rust Core additional specialist roster");
 const pins:Record<string,string>=Object.create(null);
 for(const role of ["orchestrator","backend","frontend","test",...additional])
  pins[role]=value("ADAPTER_ID_"+role.toUpperCase());
 if(new Set(Object.values(pins)).size!==Object.keys(pins).length)
  throw Error("Native Rust Core specialist DIDs must be distinct");
 return Object.freeze(pins);
}

/** Fixed relative path: never pass caller/environment-controlled paths. */
export function loadDirectCoreRustVerifier(
  options?:Readonly<{allowGiteaScopeCoverage?:boolean}>
):DirectCoreRustVerifier {
  let native:unknown;
  try{
    native=requireNative("./native/delegation-core.node") as unknown;
  }catch{
    throw new Error(
      "Direct Rust Core verification is unavailable: trusted native addon not built; "+
      "refusing to start rather than bypassing VP/accumulator/status checks"
    );
  }
  if(native===null || typeof native!=="object" ||
     !("verify_verifiable_presentation" in native) ||
     !("assert_verification_ready" in native) ||
     typeof (native as CoreRustBinding).verify_verifiable_presentation!=="function" ||
     typeof (native as {assert_verification_ready?:unknown}).assert_verification_ready!=="function") {
    throw new Error("Native Rust Core addon does not expose the required verifier ABI");
  }
  // Mandatory real EVM chain-id / read-only artifact presence preflight.
  // No fallback to the issuing Adapter, even if native verification is unavailable.
  try {
    (native as {assert_verification_ready:()=>void}).assert_verification_ready();
  }catch{
    throw new Error("Native Rust Core verification sources are not ready; refusing startup");
  }
  return new DirectCoreRustVerifier(
    native as CoreRustBinding,trustedCoreRustIdentitiesFromEnvironment(),options
  );
}
