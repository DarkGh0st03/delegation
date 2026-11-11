/**
 * R293 — explicitly owner-injected completion evidence boundary.
 *
 * The caller supplies NO proof or success boolean to the Gateway: the
 * observer asks an independently trusted source about exact local pins.
 * This adapter does not itself verify Rust/EVM/Gitea/Runner evidence.
 * Do not install an untrusted callback, mock source or model tool in production.
 */
export interface TrustedCompletionExpectation {
 readonly session_id:string;
 readonly authority_digest:string;
 readonly root_credential_id:string;
 readonly task_id:string;
 readonly runtime_task_id:string;
 readonly epoch:number;
 readonly agent_did:string;
 readonly credential_id:string;
 readonly request_id:string;
 readonly request_fingerprint:string;
}
export interface ObservedTrustedTaskCompletion extends TrustedCompletionExpectation {
 readonly status:"owner_verified_provider_result";
 readonly evidence_sha256:string;
 readonly completed_at_ms:number;
}
export class TrustedAuthorityOnlyCompletionObserver{
 readonly #read:(expected:Readonly<TrustedCompletionExpectation>)=>
  Promise<ObservedTrustedTaskCompletion>;
 constructor(options:{readVerifiedCompletion:
   (expected:Readonly<TrustedCompletionExpectation>)=>
    Promise<ObservedTrustedTaskCompletion>}){
  if(!options||typeof options.readVerifiedCompletion!=="function")
   throw Error("Trusted completion observer requires owner-controlled verifier");
  this.#read=options.readVerifiedCompletion;
 }
 async observe(expected:Readonly<TrustedCompletionExpectation>){
  // Cloned before crossing the trusted evidence-reader boundary.
  return this.#read(Object.freeze(structuredClone(expected)));
 }
}
