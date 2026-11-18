/**
 * TESTS ONLY: explicit fake VP signers. Production agents sign in their
 * own native Rust wallet; DelegationEvidenceHandler refuses a fake signer
 * whenever the canonical native mode is on.
 */
import type {PresentationRequest,PresentationSigner}
  from "../../src/delegation-evidence-handler.ts";

/** Returns a fixed VP string and records every request. */
export function fakeSigner(signedVp="fake-signed-vp",
  calls:PresentationRequest[]=[]):PresentationSigner{
  return async request=>{calls.push(structuredClone(request));return signedVp;};
}

/** Routes each request into the test's own fetch mock as
 * POST <base>/v1/presentations with the caller token, so a fixture can
 * assert the exact request and choose the VP it returns. */
export function fakeSignerViaFetch(fetchFn:typeof fetch,token:string,
  base="http://fake-signer.invalid"):PresentationSigner{
  return async request=>{
    const response=await fetchFn(base+"/v1/presentations",{method:"POST",
      headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify(request)});
    const body=await response.json() as {signed_vp?:unknown};
    if(!response.ok||typeof body.signed_vp!=="string")
      throw Error("fake signer refused");
    return body.signed_vp;
  };
}

/** Adds a fetch-routed fake signer to an ADK handler test config. */
export function withFakeSigner<T extends {fetchFn?:typeof fetch;adapterToken:string}>(
  config:T):T&{presentationSigner:PresentationSigner}{
  if(!config.fetchFn)throw Error("withFakeSigner needs the test fetch mock");
  return {...config,presentationSigner:fakeSignerViaFetch(config.fetchFn,config.adapterToken)};
}
