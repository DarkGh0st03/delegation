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
 readonly #coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">;
 readonly #pins:Readonly<{
  session_id:string;epoch:number;plan_digest:string;
  task_id:string;branch:string;repository:Repo;
 }>;
 private constructor(c:{
  gateway:TrustedPlanIpcClient;gitea:GiteaClient;
  coordinator:Pick<TrustedExecutionCoordinator,
   "phase"|"trustedOperationalAuthority">;
  pins:Readonly<{
   session_id:string;epoch:number;plan_digest:string;
   task_id:string;branch:string;repository:Repo;
  }>;
 }){
  this.#gateway=c.gateway;this.#gitea=c.gitea;
  this.#coordinator=c.coordinator;
  this.#pins=Object.freeze({...c.pins,
   repository:Object.freeze({...c.pins.repository})});
 }
 static async capture(config:{
  gateway:TrustedPlanIpcClient;gitea:GiteaClient;
  coordinator:Pick<TrustedExecutionCoordinator,
   "phase"|"trustedOperationalAuthority">;
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
  return new TrustedRetiredRepairAcceptanceWitness({
   gateway:config.gateway,gitea:config.gitea,
   coordinator:config.coordinator,
   pins:{
    session_id:current.plan.session_id,epoch:history.length,
    plan_digest:current.plan_digest,task_id:tests[0].id,
    branch,repository:{...current.plan.repository}
   }
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
