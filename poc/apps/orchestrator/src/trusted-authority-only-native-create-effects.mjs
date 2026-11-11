/**
 * R383.9: compose CREATE_FILE from original privileged Gateway owner only.
 *
 * No side effects during assembly. Separate owner-private 0700 directories
 * (preprovisioned and validated by canonical bootstrap), a native Child
 * Task/flight, original Prepare and Rust+OPA remain mandatory.
 *
 * Never instantiate from an HTTP/A2A/MCP/ADK payload. The caller must use
 * the SAME GatewayAdmissions, Gitea writer, store and branch as UPDATE.
 */
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../gateway/src/trusted-authority-only-admissions.ts";
import {GiteaClient} from "../../gateway/src/gitea-client.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal}
 from "../../gateway/src/trusted-authority-only-create-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight}
 from "../../gateway/src/trusted-authority-only-create-preflight.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor}
 from "../../gateway/src/trusted-authority-only-create-executor.ts";
import {TrustedGatewayGiteaCreateEvidencePublisher,
 AuthenticatedGiteaCreateCompletionObserver}
 from "../../gateway/src/trusted-authority-only-gitea-create-evidence.ts";

function deny(){
 throw Error("R383.9 owner-native CREATE effects require pinned trusted dependencies");
}
export function assembleTrustedAuthorityOnlyNativeCreateEffects({
 gateway,store,giteaClient,independentGiteaClient,repository,
 branch,evidenceKey,createIntentDirectory,createReceiptDirectory,nowMs
}={}){
 if(!(gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
    !(giteaClient instanceof GiteaClient)||
    !(independentGiteaClient instanceof GiteaClient)||
    giteaClient===independentGiteaClient||
    typeof store?.get!=="function"||
    !Buffer.isBuffer(evidenceKey)||evidenceKey.length!==32||
    typeof repository!=="string"||
    !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(repository)||
    !GiteaClient.isPinnedRepositoryClient(
     giteaClient,...repository.split("/"))||
    !GiteaClient.isPinnedRepositoryClient(
     independentGiteaClient,...repository.split("/"))||
    typeof branch!=="string"||
    !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(branch)||
    branch.includes("..")||branch.includes("//")||
    typeof createIntentDirectory!=="string"||
    typeof createReceiptDirectory!=="string"||
    createIntentDirectory===createReceiptDirectory)
  deny();
 const journal=new DurableAuthorityOnlyGiteaCreateIntentJournal(
  createIntentDirectory);
 const preflight=new TrustedAuthorityOnlyGiteaCreatePreflight({
  admissions:gateway,giteaClient,journal,repository,branch,nowMs
 });
 const observer=new AuthenticatedGiteaCreateCompletionObserver({
  directory:createReceiptDirectory,key:evidenceKey,
  repository,branch,independentGiteaClient,nowMs
 });
 const publisher=new TrustedGatewayGiteaCreateEvidencePublisher({
  directory:createReceiptDirectory,key:evidenceKey,
  repository,branch,independentGiteaClient,nowMs
 });
 const executor=new TrustedAuthorityOnlyGiteaCreateExecutor({
  admissions:gateway,preflight,journal,giteaClient,
  publisher,observer,repository,branch
 });
 return Object.freeze({preflight,executor,observer});
}
