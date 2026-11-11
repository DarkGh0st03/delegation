/**
 * R383.6 — protected, single-attempt native CREATE_FILE transport.
 *
 * The caller must already have passed an ORIGINAL Gateway consumed Prepare
 * through the real DirectCoreRustVerifier and independent OPA. No legacy
 * Gitea contents POST on the feature branch is permitted. Every failure
 * after durable attempt reservation is terminal; never retry ambiguous
 * provider writes. This class is not exported as a model FunctionTool.
 */
import {createHash} from "node:crypto";
import {GiteaClient} from "./gitea-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight}
 from "./trusted-authority-only-create-preflight.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal}
 from "./trusted-authority-only-create-intent-journal.ts";
import {AuthenticatedGiteaCreateCompletionObserver,
 TrustedGatewayGiteaCreateEvidencePublisher}
 from "./trusted-authority-only-gitea-create-evidence.ts";
import type {
 PreparedRequestRecord,VerifiedDelegation,PolicyDecision,
 GiteaCreateFileExecutionResult
} from "./types.ts";

function deny(reason:string):never{
 throw Error("Trusted authority-only Gitea create execution NO-GO: "+reason);
}
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
export class TrustedAuthorityOnlyGiteaCreateExecutor{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #preflight:TrustedAuthorityOnlyGiteaCreatePreflight;
 readonly #journal:DurableAuthorityOnlyGiteaCreateIntentJournal;
 readonly #writer:GiteaClient;
 readonly #publisher:TrustedGatewayGiteaCreateEvidencePublisher;
 readonly #observer:AuthenticatedGiteaCreateCompletionObserver;
 readonly #repository:string;
 readonly #branch:string;
 #inFlight=false;
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  preflight:TrustedAuthorityOnlyGiteaCreatePreflight;
  journal:DurableAuthorityOnlyGiteaCreateIntentJournal;
  giteaClient:GiteaClient;
  publisher:TrustedGatewayGiteaCreateEvidencePublisher;
  observer:AuthenticatedGiteaCreateCompletionObserver;
  repository:string;branch:string;
 }){
  if(!opts||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.preflight instanceof TrustedAuthorityOnlyGiteaCreatePreflight)||
     !(opts.journal instanceof DurableAuthorityOnlyGiteaCreateIntentJournal)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.publisher instanceof TrustedGatewayGiteaCreateEvidencePublisher)||
     !(opts.observer instanceof AuthenticatedGiteaCreateCompletionObserver)||
     typeof opts.repository!=="string"||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//")||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,
      opts.repository.split("/")[0],opts.repository.split("/")[1])||
     !TrustedAuthorityOnlyGiteaCreatePreflight.isNativeForOwner(
      opts.preflight,opts.admissions,opts.giteaClient,
      opts.repository,opts.branch)||
     !opts.publisher.isForRepository(opts.repository,opts.branch,
      opts.giteaClient)||
     !AuthenticatedGiteaCreateCompletionObserver.isForRepository(
      opts.observer,opts.repository,opts.branch)||
     !opts.observer.isIndependentOf(opts.giteaClient))
   deny("original Gateway/Task and independent Gitea create evidence required");
  this.#admissions=opts.admissions;
  this.#preflight=opts.preflight;
  this.#journal=opts.journal;
  this.#writer=opts.giteaClient;
  this.#publisher=opts.publisher;
  this.#observer=opts.observer;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
 }
 isForAdmissions(gate:TrustedAuthorityOnlyGatewayAdmissions):boolean{
  return gate===this.#admissions;
 }
 async executeAfterVerifiedRustOpa(
  record:PreparedRequestRecord,verified:VerifiedDelegation,
  policy:PolicyDecision
 ):Promise<GiteaCreateFileExecutionResult>{
  if(this.#inFlight)deny("concurrent create execution prohibited");
  if(!record||record.consumed!==true||
     record.request.tool!=="create_file"||
     !policy||policy.allow!==true||
     typeof policy.policy_version!=="string"||
     !policy.policy_version.trim()||
     !verified||!Array.isArray(verified.permissions))
   deny("real native VP, OPA and consumed original CREATE required");
  // This is a read-only owner-native admission on the original record,
  // using the same signed Child, exact Task and durable flight.
  const admission=await this.#preflight
   .assertNativeCreateAdmissionAfterVerification(record,verified,policy);
  if(admission.status!=="native_create_task_admitted_no_provider_write"||
     admission.provider_write_authorized!==false)
   deny("native admission is not a real Task binding");
  const binding=this.#admissions.assertTrustedCreateNativeAdmissionBinding(
   record,verified);
  const intent=this.#preflight.getReservedIntent(record);
  const args=record.request.arguments;
  if(intent.repository!==this.#repository||
     intent.branch!==this.#branch||args.branch!==this.#branch||
     intent.path!==args.path||
     intent.next_content_sha256!==sha(args.content)||
     intent.next_content_bytes!==Buffer.byteLength(args.content,"utf8")||
     admission.task_id!==binding.task_id||
     admission.request_id!==record.request_id||
     intent.session_id!==binding.session_id||
     intent.authority_digest!==binding.authority_digest||
     intent.root_credential_id!==binding.root_credential_id||
     intent.task_id!==binding.task_id||
     intent.runtime_task_id!==binding.runtime_task_id||
     intent.epoch!==binding.epoch||
     intent.agent_did!==binding.agent_did||
     intent.credential_id!==binding.credential_id||
     intent.request_id!==binding.request_id||
     intent.request_fingerprint!==binding.request_fingerprint)
   deny("create effect differs from immutable native Task/Child intent");
  this.#inFlight=true;
  try{
   // The one-shot marker MUST be durable before the first Gitea call.
   // No automatic retry, even if staging/branch CAS response is lost.
   await this.#journal.reserveAttempt(intent);
   const result=await this.#writer.createFileWithHeadCas({
    branch:intent.branch,path:intent.path,content:args.content,
    message:"thesis-gateway: create_file "+intent.path+
     " ["+intent.request_id+"]",
    requestId:intent.request_id,expectedHeadSha:intent.expected_head_sha
   });
   // Publisher independently verifies old absence, parent, new HEAD,
   // blob and bytes before writing a 0600 MAC-sealed receipt.
   const published=await this.#publisher.publish(
    intent,binding,result,policy.policy_version);
   // A separate authenticated observer re-opens the receipt and
   // independently re-reads Gitea before reporting success.
   const observed=await this.#observer.observe(binding);
   if(observed.status!=="owner_verified_provider_result"||
      observed.evidence_sha256!==published||
      observed.request_fingerprint!==record.request_fingerprint)
    deny("create completion is not independently authenticated");
   await this.#journal.reserveCompletedEvidence(intent,published);
   return Object.freeze({
    provider:"gitea",performed:true,tool:"create_file",
    branch:intent.branch,path:intent.path,
    revision:result.commit_sha,commit_sha:result.commit_sha,
    blob_sha:result.blob_sha
   });
  }finally{this.#inFlight=false;}
 }
}
