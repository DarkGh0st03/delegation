/**
 * Trusted Gateway-side Gitea observation for operational repair planning.
 *
 * This is NOT an MCP/LLM tool or a replacement for the existing
 * DC -> challenge VP -> native Rust -> OPA -> Gateway action enforcement.
 * It makes a read-only provider observation (the feature branch HEAD) from
 * the Gateway's independently authenticated Gitea client, while checking
 * the original Engineer-root-bound operational session before AND after
 * provider I/O. No raw provider response, Gitea token or source file enters
 * the repair model.
 */
import {GiteaClient} from "./gitea-client.ts";
import {approvedWorkBranch} from "../../../packages/plan-contracts/src/approved-work-branch.mjs";
import {TrustedOperationalEpochIntake} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-intake.ts";
import type {TrustedFeatureRevision} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-repair-planner.ts";

type Repository={authority:string;owner:string;repository:string};
const SHA=/^[a-f0-9]{40}$/u;
const deny=(reason:string):never=>{
 throw Error("Trusted Gateway feature-head NO-GO: "+reason);
};
function sameRepo(a:Repository,b:Repository):boolean{
 return ["authority","owner","repository"].every(k=>
  a[k as keyof Repository]===b[k as keyof Repository]);
}

export class TrustedOperationalFeatureHeadReader {
 readonly #client:GiteaClient;
 readonly #intake:TrustedOperationalEpochIntake;
 readonly #repository:Readonly<Repository>;
 constructor(config:{
  giteaClient:GiteaClient;
  intake:TrustedOperationalEpochIntake;
  repository:Readonly<Repository>;
 }){
  if(!(config.giteaClient instanceof GiteaClient)||
     !(config.intake instanceof TrustedOperationalEpochIntake)||
     !config.repository||
     ["authority","owner","repository"].some(k=>{
      const value=config.repository[k as keyof Repository];
      return typeof value!=="string"||!value.trim();
     }))
    deny("trusted client, operational intake and pinned repository required");
  this.#client=config.giteaClient;
  this.#intake=config.intake;
  this.#repository=Object.freeze({...config.repository});
 }
 assertSameIntake(intake:TrustedOperationalEpochIntake):void{
  if(intake!==this.#intake)
   deny("Feature HEAD reader belongs to another operational root");
 }
 async read(repository:Readonly<Repository>,branch:string):
  Promise<Readonly<TrustedFeatureRevision>>{
  if(!repository||!sameRepo(repository,this.#repository)||
     typeof branch!=="string")
   deny("requested repository is not pinned to the trusted Gateway");

  const history=await this.#intake.verifiedEpochHistory();
  const original=history[0],current=history.at(-1);
  if(!original||!current||
     !sameRepo(original.plan.repository,this.#repository)||
     approvedWorkBranch(original.plan)!==branch||
     approvedWorkBranch(current.plan)!==branch)
   deny("working branch differs from authenticated issued root");

  // GiteaClient independently checks owner and repo name against the
  // configured token's target. A surprising full_name still fails closed.
  const repo=await this.#client.getRepositoryMetadata();
  if(repo.full_name!==this.#repository.owner+"/"+this.#repository.repository)
   deny("provider repository identity differs from pinned repository");
  const observed=await this.#client.getBranchMetadata(branch);
  if(observed.name!==branch||!SHA.test(observed.commit_sha))
   deny("noncanonical provider branch HEAD");

  // Root revocation, expiry or epoch transition during the external read
  // invalidates the result; the Planner rechecks again after model inference.
  const after=await this.#intake.verifiedEpochHistory();
  if(after.length!==history.length||
     after.at(-1)?.plan_digest!==current.plan_digest)
   deny("operational root or plan epoch changed during Gitea observation");

  return Object.freeze({
   repository:Object.freeze({...this.#repository}),
   branch,head_sha:observed.commit_sha
  });
 }
}
