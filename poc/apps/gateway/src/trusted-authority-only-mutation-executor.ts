/**
 * R302.4 — trusted, ONE-SHOT Gitea atomic update pipeline.
 *
 * Called only from the Gateway AFTER native Rust signature/status verification
 * and a real independent OPA allow. A trusted owner pre-stages an immutable
 * CAS intent and R293 Task flight. No provider call until this verifies both.
 * No recovery retry if any provider response or receipt is ambiguous.
 */
import {createHash} from "node:crypto";
import {GiteaClient} from "./gitea-client.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight}
 from "./trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal}
 from "./trusted-authority-only-mutation-intent-journal.ts";
import {AuthenticatedGiteaMutationCompletionObserver,
 TrustedGatewayGiteaMutationEvidencePublisher}
 from "./trusted-authority-only-gitea-mutation-evidence.ts";
import type {
 PreparedRequestRecord,VerifiedDelegation,PolicyDecision,
 GiteaUpdateFileExecutionResult
} from "./types.ts";

function deny(reason:string):never{
 throw Error("Trusted authority-only Gitea mutation execution NO-GO: "+reason);
}
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
export class TrustedAuthorityOnlyGiteaMutationExecutor{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #preflight:TrustedAuthorityOnlyGiteaMutationPreflight;
 readonly #journal:DurableAuthorityOnlyGiteaMutationIntentJournal;
 readonly #gitea:GiteaClient;
 readonly #publisher:TrustedGatewayGiteaMutationEvidencePublisher;
 readonly #observer:AuthenticatedGiteaMutationCompletionObserver;
 readonly #repository:string;
 readonly #branch:string;
 #inFlight=false;
 constructor(opts:{
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  preflight:TrustedAuthorityOnlyGiteaMutationPreflight;
  journal:DurableAuthorityOnlyGiteaMutationIntentJournal;
  giteaClient:GiteaClient;
  publisher:TrustedGatewayGiteaMutationEvidencePublisher;
  observer:AuthenticatedGiteaMutationCompletionObserver;
  repository:string;branch:string;
 }){
  if(!opts||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.preflight instanceof TrustedAuthorityOnlyGiteaMutationPreflight)||
     !(opts.journal instanceof DurableAuthorityOnlyGiteaMutationIntentJournal)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.publisher instanceof TrustedGatewayGiteaMutationEvidencePublisher)||
     !(opts.observer instanceof AuthenticatedGiteaMutationCompletionObserver)||
     !opts.preflight.isForAdmissions(opts.admissions)||
     !opts.preflight.isForClient(opts.giteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
     opts.branch.includes("..")||opts.branch.includes("//"))
   deny("owner-only CAS executor is not bound to the exact trusted Gateway");
  this.#admissions=opts.admissions;
  this.#preflight=opts.preflight;
  this.#journal=opts.journal;
  this.#gitea=opts.giteaClient;
  this.#publisher=opts.publisher;
  this.#observer=opts.observer;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
 }
 isForAdmissions(admissions:TrustedAuthorityOnlyGatewayAdmissions):boolean{
  return admissions===this.#admissions;
 }
 async executeAfterVerifiedRustOpa(
  record:PreparedRequestRecord,verified:VerifiedDelegation,
  policy:PolicyDecision
 ):Promise<GiteaUpdateFileExecutionResult>{
  if(this.#inFlight)deny("concurrent owner mutation execution prohibited");
  if(!record||record.consumed!==true||
     record.request.tool!=="update_file"||
     !policy||policy.allow!==true||
     typeof policy.policy_version!=="string"||
     !policy.policy_version.trim()||
     !verified||!Array.isArray(verified.permissions))
   deny("native verified and OPA-allowed consumed update required");
  const binding=this.#admissions.assertTrustedCompletedMutationEvidenceBinding(
   record,verified);
  const intent=this.#preflight.getReservedIntent(record);
  const args=record.request.arguments;
  if(intent.repository!==this.#repository||
     intent.branch!==this.#branch||
     intent.branch!==args.branch||
     intent.path!==args.path||
     intent.next_content_sha256!==sha(args.content)||
     intent.next_content_bytes!==Buffer.byteLength(args.content,"utf8")||
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
   deny("serialized/foreign mutation request differs from trusted reserved intent");
  this.#inFlight=true;
  try{
   // The reservation is durable BEFORE any Gitea GET, POST or PUT.
   // Every failure after this line is TERMINAL for this Task, even if
   // Gitea's response was lost after committing.
   await this.#journal.reserveAttempt(intent);
   const actual=await this.#gitea.updateFileWithHeadCas({
    branch:intent.branch,path:intent.path,
    content:args.content,
    message:"thesis-gateway: update_file "+intent.path+
      " ["+intent.request_id+"]",
    requestId:intent.request_id,
    expectedHeadSha:intent.expected_head_sha,
    expectedBlobSha:intent.expected_blob_sha
   });
   // Publisher independently verifies the staged commit's actual parent,
   // the current feature HEAD, blob and UTF-8 bytes before MAC-ing.
   const published=await this.#publisher.publish(
    intent,binding,actual,policy.policy_version);
   // Separate authenticated evidence reader reopens on-disk owner receipt,
   // checks MAC and performs its OWN independently pinned Gitea reread.
   const observed=await this.#observer.observe(binding);
   if(observed.evidence_sha256!==published||
      observed.status!=="owner_verified_provider_result"||
      observed.request_fingerprint!==record.request_fingerprint)
    deny("published evidence does not match independent Gitea observation");
   await this.#journal.reserveCompletedEvidence(intent,published);
   return {
    provider:"gitea",performed:true,tool:"update_file",
    branch:intent.branch,path:intent.path,
    revision:actual.commit_sha,commit_sha:actual.commit_sha,
    blob_sha:actual.blob_sha,
    precondition_blob_sha:intent.expected_blob_sha
   };
  }finally{this.#inFlight=false;}
 }
}
