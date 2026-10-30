/**
 * R141 — read-only exact-SHA correlation AFTER the trusted owner retires
 * its original Gateway session. R139 real Docker provider evidence and
 * R140 retired Runner receipts remain separate from EVM root revocation.
 *
 * This is NOT a PR creator, merge tool, MCP route, or permission grant.
 * The source-of-truth signed Task/branch is captured while the original
 * Rust root is live, then checked against the retired Gateway and actual
 * Gitea branch HEAD with two independent read-only provider observations.
 */
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import {approvedWorkBranch} from
 "../../plan-contracts/src/approved-work-branch.mjs";

type Repo={authority:string;owner:string;repository:string};
const SHA=/^[a-f0-9]{40}$/u;
function deny(reason:string):never{
 throw Error("R141 retired repair acceptance NO-GO: "+reason);
}
/**
 * This witness can only be created from the signed Engineer Intake while
 * the SAME issued Coordinator root is operational. No model may call this.
 */
export class TrustedRetiredRepairAcceptanceWitness {
 readonly #gateway:TrustedPlanIpcClient;
 readonly #gitea:GiteaClient;
 readonly #originalRootPlanDigest:string;
 readonly #signedReviewApproved:boolean;
 readonly #originalBaseSha:string;
 #reviewAttempted=false;
 readonly #coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority"|"assertOperationalClosureConfirmed">;
 readonly #pins:Readonly<{
  session_id:string;epoch:number;plan_digest:string;
  task_id:string;branch:string;repository:Repo;
 }>;
 private constructor(c:{
  gateway:TrustedPlanIpcClient;gitea:GiteaClient;
  rootPlanDigest:string;signedReviewApproved:boolean;originalBaseSha:string;
  coordinator:Pick<TrustedExecutionCoordinator,
   "phase"|"trustedOperationalAuthority"|"assertOperationalClosureConfirmed">;
  pins:Readonly<{
   session_id:string;epoch:number;plan_digest:string;
   task_id:string;branch:string;repository:Repo;
  }>;
 }){
  this.#gateway=c.gateway;this.#gitea=c.gitea;
  this.#originalRootPlanDigest=c.rootPlanDigest;
  this.#signedReviewApproved=c.signedReviewApproved;
  this.#originalBaseSha=c.originalBaseSha;
  this.#coordinator=c.coordinator;
  this.#pins=Object.freeze({...c.pins,
   repository:Object.freeze({...c.pins.repository})});
 }
 static async capture(config:{
  gateway:TrustedPlanIpcClient;gitea:GiteaClient;
  coordinator:Pick<TrustedExecutionCoordinator,
   "phase"|"trustedOperationalAuthority"|"assertOperationalClosureConfirmed">;
  intake:TrustedOperationalEpochIntake;
 }):Promise<TrustedRetiredRepairAcceptanceWitness>{
  if(!(config?.gateway instanceof TrustedPlanIpcClient)||
     !(config.gitea instanceof GiteaClient)||
     !(config.intake instanceof TrustedOperationalEpochIntake)||
     !config.gateway.operationalSessionDurableConfigured()||
     config.coordinator?.phase!=="execution")
    deny("real private Gateway, Gitea and current root required");
  config.intake.assertSameCoordinator(config.coordinator);
  const root=config.coordinator.trustedOperationalAuthority();
  const history=await config.intake.verifiedEpochHistory();
  const current=history.at(-1),first=history[0];
  if(!current||!first||history.length<2||history.length>3||
     current.epoch!==history.length||
     current.root_credential_id!==root.credential_id||
     first.plan_digest!==root.plan_digest||
     !SHA.test(current.plan.base_revision))
   deny("original issued root and signed latest repair epoch required");
  const branch=approvedWorkBranch(current.plan);
  if(branch!==approvedWorkBranch(first.plan))
   deny("repair branch changed from original Engineer approval");
  const tests=current.plan.tasks.filter((t:{id:string;agent_id:string})=>
    t.agent_id==="test");
  if(tests.length!==1||!tests[0]||
     !current.plan.requested_permissions.some((p:{
      task_id:string;agent_id:string;operation:string;resource:string
     })=>p.task_id===tests[0].id&&p.agent_id==="test"&&
      p.operation==="run_tests"&&
      p.resource==="gitea://"+current.plan.repository.authority+"/"+
       current.plan.repository.owner+"/"+current.plan.repository.repository+
       "/branches/"+encodeURIComponent(branch)))
   deny("one final signed Test Task with exact branch grant required");
  if(config.coordinator.phase!=="execution"||
     config.coordinator.trustedOperationalAuthority().credential_id!==
      root.credential_id)
   deny("root retired during signed acceptance capture");
  // R145: a repair does not resurrect an old PR Task. Review may
  // only be opened by the trusted owner when the ORIGINAL, signed
  // Engineer scope explicitly approved create_pull_request (with an
  // original Test dependency) in the actually ISSUED Rust root.
  const repoRoot="gitea://"+first.plan.repository.authority+"/"+
    first.plan.repository.owner+"/"+first.plan.repository.repository;
  const originalTests=new Set(first.plan.tasks.filter(
   (t:{agent_id:string})=>t.agent_id==="test").map(
   (t:{id:string})=>t.id));
  const signedReviewApproved=first.plan.requested_permissions.some(
   (p:{task_id:string;agent_id:string;operation:string;resource:string})=>{
    if(p.agent_id!=="orchestrator"||
       p.operation!=="create_pull_request"||p.resource!==repoRoot)
      return false;
    const task=first.plan.tasks.find(
      (t:{id:string})=>t.id===p.task_id);
    return !!task&&task.agent_id==="orchestrator"&&
      task.depends_on.some((id:string)=>originalTests.has(id))&&
      root.permissions.some((g:{resource:string;operation:string})=>
       g.resource===repoRoot&&g.operation==="create_pull_request");
   });
  return new TrustedRetiredRepairAcceptanceWitness({
   gateway:config.gateway,gitea:config.gitea,
   rootPlanDigest:first.plan_digest,
   signedReviewApproved,originalBaseSha:first.plan.base_revision,
   coordinator:config.coordinator,
   pins:{
    session_id:current.plan.session_id,epoch:history.length,
    plan_digest:current.plan_digest,task_id:tests[0].id,
    branch,repository:{...current.plan.repository}
   }
  });
 }
 /** R142 adds genuine native EVM root revocation to R141's
  * independent Gateway Test PASS and fresh Gitea branch observations.
  * Still not a review-only PR authorization. */
 async verifyRevokedRetiredExactSha(){
  // The real Coordinator only resolves this after the SAME shutdown
  // promise has confirmed Gateway close AND native Rust revocation.
  // A merely "closed" phase must never qualify as terminal.
  await this.#coordinator.assertOperationalClosureConfirmed();
  const before=await this.verifyRetiredExactSha();
  const revocation=await this.#gateway.readRetiredRootRevocation({
   session_id:this.#pins.session_id,
   root_plan_digest:this.#originalRootPlanDigest,
   plan_digest:this.#pins.plan_digest,epoch:this.#pins.epoch,
   task_id:this.#pins.task_id,branch:before.branch,
   tested_commit_sha:before.tested_commit_sha
  });
  if(revocation.original_root_revoked!==true||
     revocation.pull_request_authorized!==false)
   deny("Gateway did not independently corroborate EVM root retirement");
  await this.#coordinator.assertOperationalClosureConfirmed();
  const after=await this.verifyRetiredExactSha();
  if(after.tested_commit_sha!==before.tested_commit_sha||
     after.plan_digest!==before.plan_digest||
     after.test_task_id!==before.test_task_id)
   deny("Gitea HEAD or signed Test changed during native revocation check");
  return Object.freeze({
   status:"r142_retired_runner_gitea_native_revoked_no_pr_authority" as const,
   session_id:this.#pins.session_id,epoch:this.#pins.epoch,
   plan_digest:this.#pins.plan_digest,
   test_task_id:this.#pins.task_id,branch:before.branch,
   tested_commit_sha:before.tested_commit_sha,
   native_anchor_version:revocation.anchor_version,
   root_revoked:true as const,pull_request_authorized:false as const
  });
 }
 /**
  * R145 owner-only one-shot DRAFT PR review publication.
  * Prerequisites are from an immutable signed Engineer decision, not an
  * agent-provided flag: original Rust PR scope, R142 original-root
  * revocation/closure, exact-SHA Gateway Test PASS, and stable Gitea HEAD.
  *
  * This is deliberately not exposed by HTTP, A2A, MCP, or Gemini.
  * No merge operation exists. Any ambiguous POST is terminal for this
  * witness: the caller must not repeat it automatically.
  */
 async openSignedReviewOnlyDraft(input:Readonly<{
   title:string;body:string;
 }>){
  if(this.#reviewAttempted)
   deny("signed review PR publication is one-shot, never retried");
  this.#reviewAttempted=true; // before ANY await, including preflight
  if(!this.#signedReviewApproved)
   deny("original signed Engineer scope has no reviewed PR grant");
  if(typeof input?.title!=="string"||
     !input.title.trim()||input.title.length>160||
     typeof input.body!=="string"||input.body.length>4000)
   deny("bounded owner-authored PR description required");
  const proof=await this.verifyRevokedRetiredExactSha();
  if(proof.root_revoked!==true||
     proof.pull_request_authorized!==false||
     proof.status!=="r142_retired_runner_gitea_native_revoked_no_pr_authority")
   deny("independent retired root and exact Test SHA evidence unavailable");
  const repo=await this.#gitea.getRepositoryMetadata();
  if(repo.full_name!==this.#pins.repository.owner+"/"+
      this.#pins.repository.repository||repo.default_branch!=="main")
   deny("original Gitea repository or base branch changed");
  const main=await this.#gitea.getBranchMetadata("main");
  if(main.commit_sha!==this.#originalBaseSha)
   deny("Engineer-approved main revision changed before review");
  const issued=await this.#gitea.createDraftPullRequest(
   proof.branch,"main",input.title,proof.tested_commit_sha,input.body
  );
  await this.#coordinator.assertOperationalClosureConfirmed();
  const after=await this.#gitea.getBranchMetadata("main");
  if(after.commit_sha!==this.#originalBaseSha)
   deny("main moved after PR creation; quarantine uncertain review");
  const now=await this.#gitea.getBranchMetadata(proof.branch);
  if(now.commit_sha!==proof.tested_commit_sha)
   deny("review branch changed after accepted Runner SHA");
  if(issued.draft!==true||issued.open!==true||
     issued.merged!==false||issued.head_revision!==proof.tested_commit_sha)
   deny("provider did not independently corroborate unmerged draft");
  return Object.freeze({
   status:"r145_signed_review_only_draft_open_unmerged" as const,
   session_id:this.#pins.session_id,
   epoch:this.#pins.epoch,plan_digest:this.#pins.plan_digest,
   tested_commit_sha:proof.tested_commit_sha,
   head_branch:proof.branch,
   draft_pr_number:issued.number,
   draft_pr_url:issued.url??null,
   signed_original_review_grant:true as const,
   gateway_test_pass_verified:true as const,
   original_root_revoked:true as const,
   draft:true as const,merged:false as const,
   merge_authorized:false as const
  });
 }
 /** No write effects. No claim that Rust EVM root was revoked. */
 async verifyRetiredExactSha():Promise<Readonly<{
  status:"r141_retired_gateway_runner_gitea_correlated_no_pr_authority";
  session_id:string;epoch:number;plan_digest:string;
  test_task_id:string;branch:string;tested_commit_sha:string;
  gateway_session_retired:true;real_gitea_head_correlated:true;
  rust_root_revocation_verified:false;pull_request_authorized:false;
 }>>{
  if(this.#coordinator.phase==="execution")
   deny("Engineer root is still active; cannot inspect final acceptance");
  const owner=this.#pins.repository.owner;
  const name=this.#pins.repository.repository;
  const repo=await this.#gitea.getRepositoryMetadata();
  if(repo.full_name!==owner+"/"+name)
   deny("Gitea repository differs from authenticated signed plan");
  const first=await this.#gitea.getBranchMetadata(this.#pins.branch);
  if(first.name!==this.#pins.branch||!SHA.test(first.commit_sha))
   deny("missing exact current Gitea repair head");
  const receipt=await this.#gateway.readRetiredRunnerAcceptance({
   session_id:this.#pins.session_id,task_id:this.#pins.task_id,
   branch:this.#pins.branch,tested_commit_sha:first.commit_sha
  });
  if(receipt.status!==
      "retired_gateway_exact_sha_runner_pass_no_pr_authority"||
     receipt.gateway_session_retired!==true||
     receipt.rust_root_revocation_verified!==false||
     receipt.pull_request_authorized!==false)
   deny("Gateway Runner evidence was not separately authenticated");
  const second=await this.#gitea.getBranchMetadata(this.#pins.branch);
  if(second.name!==this.#pins.branch||
     second.commit_sha!==first.commit_sha)
   deny("Gitea branch changed during Gateway Runner inspection");
  if(this.#coordinator.phase==="execution")
   deny("original owner root became active after retirement");
  return Object.freeze({
   status:"r141_retired_gateway_runner_gitea_correlated_no_pr_authority" as const,
   session_id:this.#pins.session_id,epoch:this.#pins.epoch,
   plan_digest:this.#pins.plan_digest,
   test_task_id:this.#pins.task_id,branch:this.#pins.branch,
   tested_commit_sha:first.commit_sha,
   gateway_session_retired:true as const,
   real_gitea_head_correlated:true as const,
   rust_root_revocation_verified:false as const,
   pull_request_authorized:false as const
  });
 }
}
