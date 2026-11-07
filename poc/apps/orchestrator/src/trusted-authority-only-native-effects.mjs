import {TrustedAuthorityOnlyGiteaMutationPreflight} from "../../gateway/src/trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from "../../gateway/src/trusted-authority-only-mutation-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor} from "../../gateway/src/trusted-authority-only-mutation-executor.ts";
import {TrustedGatewayGiteaMutationEvidencePublisher,
 AuthenticatedGiteaMutationCompletionObserver} from "../../gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {TrustedAuthorityOnlyRunnerPreflight}
 from "../../gateway/src/trusted-authority-only-runner-preflight.ts";
import {DurableAuthorityOnlyRunnerIntentJournal}
 from "../../gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyRunnerExecutor}
 from "../../gateway/src/trusted-authority-only-runner-executor.ts";
import {TrustedAuthorityOnlyPullRequestExecutor}
 from "../../gateway/src/trusted-authority-only-pull-request-executor.ts";
import {TrustedAuthorityOnlyBranchExecutor}
 from "../../gateway/src/trusted-authority-only-branch-executor.ts";
import {TrustedGatewayRunnerFailEvidencePublisher,
 AuthenticatedRunnerFailureObserver}
 from "../../gateway/src/trusted-authority-only-runner-failure-evidence.ts";
import {TrustedGatewayGiteaReadEvidencePublisher}
 from "../../gateway/src/trusted-authority-only-gitea-publisher.ts";
import {TrustedGatewayRunnerPassEvidencePublisher} from "../../gateway/src/trusted-authority-only-runner-evidence.ts";

/** Compose provider ports for the admitted Gateway without executing effects.
 * The Review Host must verify the binding before Branch or A2A execution.
 */
export function assembleTrustedAuthorityOnlyNativeEffects({
 gateway:gate,store,giteaClient:client,independentGiteaClient:independentClient,
 runnerClient,runnerPassObserver:runnerObserver,readObserver,repository,
 branch,evidenceKey,directories,nowMs
}){
 const journal=new DurableAuthorityOnlyGiteaMutationIntentJournal(directories.mutationIntent);
 const preflight=new TrustedAuthorityOnlyGiteaMutationPreflight({
  admissions:gate,giteaClient:client,journal,repository,
  branch,nowMs
 });
 const observer=new AuthenticatedGiteaMutationCompletionObserver({
  directory:directories.giteaReceipts,key:evidenceKey,
  repository,branch,giteaClient:independentClient,nowMs
 });
 const mutationExecutor=new TrustedAuthorityOnlyGiteaMutationExecutor({
  admissions:gate,preflight,journal,giteaClient:client,
  publisher:new TrustedGatewayGiteaMutationEvidencePublisher({
   directory:directories.giteaReceipts,key:evidenceKey,
   repository,
   branch,independentGiteaClient:independentClient,nowMs
  }),observer,repository,branch
 });
 // Separate native Test Runner path, bound to the SAME trusted Gateway.
 // It makes no provider call until native Rust VP and real OPA both allow.
 const runnerJournal=new DurableAuthorityOnlyRunnerIntentJournal(
  directories.runnerIntent);
 const runnerPreflight=new TrustedAuthorityOnlyRunnerPreflight({
  admissions:gate,giteaClient:client,journal:runnerJournal,
  repository,branch,nowMs
 });
 const failObserver=new AuthenticatedRunnerFailureObserver({
  directory:directories.runnerFailureReceipts,key:evidenceKey,
  giteaClient:client,journal:runnerJournal,
  repository,branch,nowMs
 });
 const failPublisher=new TrustedGatewayRunnerFailEvidencePublisher({
  directory:directories.runnerFailureReceipts,key:evidenceKey,
  // The original RunnerExecutor requires the exact SAME Gateway Gitea port
  // for its one-shot flight; the independent MAC failure observer then
  // reopens the attested source HEAD through that original bound identity.
  runnerClient,independentGiteaClient:client,
  journal:runnerJournal,repository,branch,nowMs
 });
 const runnerExecutor=new TrustedAuthorityOnlyRunnerExecutor({
  admissions:gate,preflight:runnerPreflight,
  journal:runnerJournal,giteaClient:client,runnerClient,
  publisher:new TrustedGatewayRunnerPassEvidencePublisher({
   directory:directories.runnerPassReceipts,key:evidenceKey,
   runnerClient,independentGiteaClient:independentClient,
   repository,branch,nowMs
  }),observer:runnerObserver,
  failurePublisher:failPublisher,failureObserver:failObserver,
  repository,branch
 });
 const branchExecutor=new TrustedAuthorityOnlyBranchExecutor({
  admissions:gate,giteaClient:client,
  independentGiteaClient:independentClient,
  repository,nowMs
 });
 const prExecutor=new TrustedAuthorityOnlyPullRequestExecutor({
  admissions:gate,giteaClient:client,runnerObserver,
  repository,branch,
  independentGiteaClient:independentClient
 });
 const readPublisher=new TrustedGatewayGiteaReadEvidencePublisher({
  directory:directories.giteaReceipts,key:evidenceKey,admissions:gate,
  // Authenticated read-only client is independent from the Gateway writer.
  independentGiteaClient:independentClient,
  repository,branch,nowMs
 });
 return Object.freeze({
  binding:Object.freeze({
   store,mutation:preflight,runner:runnerPreflight,giteaClient:client,
   mutationObserver:observer,...(readObserver===undefined?{}:{readObserver}),
   runnerPassObserver:runnerObserver,failureObserver:failObserver,
   pullRequestExecutor:prExecutor,branchExecutor
  }),
  authorization:Object.freeze({
   authorityOnlyReadEnabled:true,authorityOnlyReceiptWriter:readPublisher,
   authorityOnlyMutationEnabled:true,authorityOnlyMutationExecutor:mutationExecutor,
   authorityOnlyRunnerEnabled:true,authorityOnlyRunnerExecutor:runnerExecutor,
   authorityOnlyPullRequestEnabled:true,authorityOnlyPullRequestExecutor:prExecutor,
   authorityOnlyBranchEnabled:true,authorityOnlyBranchExecutor:branchExecutor
  })
 });
}
