/**
 * Native binding loader for the future in-process Gateway→Core Rust path.
 *
 * This module deliberately has NO JavaScript fallback and NEVER proxies
 * native-mode verification through the issuing Adapter. The library is
 * loaded from a fixed build artifact within this repository's Gateway
 * package; users cannot choose an arbitrary library path via HTTP or env.
 *
 * Native addon build + shared public-material/status resolvers are not yet
 * implemented. Selecting core-rust mode currently fails startup closed.
 */
import { createRequire } from "node:module";
import type {CoreRustBinding,CoreRustIdentityMap} from "./direct-core-verifier.ts";
import {DirectCoreRustVerifier} from "./direct-core-verifier.ts";

const requireNative=createRequire(import.meta.url);

function identitiesFromEnvironment():CoreRustIdentityMap {
  const value=(name:string):string=>{
    const id=process.env[name]?.trim();
    if(!id)throw new Error("Missing trusted Rust Core identity: "+name);
    return id;
  };
  return {
    orchestrator:value("ADAPTER_ID_ORCHESTRATOR"),
    backend:value("ADAPTER_ID_BACKEND"),
    frontend:value("ADAPTER_ID_FRONTEND"),
    test:value("ADAPTER_ID_TEST")
  };
}

/** Fixed relative path: never pass caller/environment-controlled paths. */
export function loadDirectCoreRustVerifier():DirectCoreRustVerifier {
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
     typeof (native as CoreRustBinding).verify_verifiable_presentation!=="function") {
    throw new Error("Native Rust Core addon does not expose the required verifier ABI");
  }
  return new DirectCoreRustVerifier(
    native as CoreRustBinding,identitiesFromEnvironment()
  );
}
