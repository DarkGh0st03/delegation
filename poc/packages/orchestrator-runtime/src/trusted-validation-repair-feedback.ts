/**
 * R105: only a Gateway-confirmed, terminal failed Test plus the original
 * Engineer-root-bound operational epoch history can enter repair planning.
 *
 * This is NOT a model-facing permission source or a fresh Engineer consent.
 * It creates only a bounded, source-free planning signal. It cannot issue
 * a DC, admit a plan, mark a Task successful, or dispatch an Agent.
 */
import {planDigest} from "../../plan-contracts/src/plan.mjs";
import {approvedWorkBranch} from "../../plan-contracts/src/approved-work-branch.mjs";
import {TrustedApprovedExecutionPlans} from
  "../../../apps/gateway/src/approved-execution-plans.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const PHASES=new Set([
  "typecheck","backend_tests","frontend_tests","build",
  "playwright_e2e","researcher_acceptance"
]);
const MAX_TOTAL_EPOCHS=3;
const deny=(reason:string):never=>{
 throw Error("Trusted repair feedback NO-GO: "+reason);
};

export interface TrustedRepairFeedbackSignal{
 readonly status:"repair_planning_eligible"|"repair_budget_exhausted";
 readonly provenance:"gateway_verified_docker_runner";
 readonly authority_kind:"existing_rust_operational_root";
 readonly session_id:string;
 readonly failed_plan_digest:string;
 readonly root_plan_digest:string;
 readonly failed_task_id:string;
 readonly failed_runtime_task_id:string;
 readonly failed_request_id:string;
 readonly failed_epoch:number;
 readonly tested_commit_sha:string;
 readonly work_branch:string;
 readonly first_failed_phase:string;
 readonly typecheck_error_codes:ReadonlyArray<string>;
 readonly remaining_repair_epochs:number;
 readonly execution_authorized:false;
 readonly permission_granted:false;
}

/**
 * A private host-owned intake. A2A text, Gemini response, metadata from
 * unverified webhooks and model-chosen Task IDs must never construct this.
 */
export async function prepareTrustedRepairFeedback(config:{
 gateway:TrustedApprovedExecutionPlans;
 intake:TrustedOperationalEpochIntake;
 sessionId:string;
 runtimeTestTaskId:string;
}):Promise<Readonly<TrustedRepairFeedbackSignal>>{
 if(!(config?.gateway instanceof TrustedApprovedExecutionPlans)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    typeof config.sessionId!=="string"||!ID.test(config.sessionId)||
    typeof config.runtimeTestTaskId!=="string"||!ID.test(config.runtimeTestTaskId))
  deny("owner-private Gateway and Engineer-root-bound intake required");

 // The original signed approval and every sequential epoch are verified
 // against the ACTUALLY issued Rust operational DC by this private intake.
 const epochs=await config.intake.verifiedEpochHistory();
 if(epochs.length<1||epochs.length>MAX_TOTAL_EPOCHS)
  deny("unrecognized or out-of-budget operational epoch history");

 // This method rejects model-only FAILs, active/in-flight tasks and stale
 // Test Tasks. No inference is made from an A2A completion artifact.
 const failure=config.gateway.readVerifiedTestFailure(config.runtimeTestTaskId);
 const initial=epochs[0],current=epochs.at(-1);
 if(!initial||!current||
    initial.plan.session_id!==config.sessionId||
    current.plan.session_id!==config.sessionId||
    failure.session_id!==config.sessionId||
    failure.root_plan_digest!==initial.plan_digest||
    !SHA.test(failure.tested_commit_sha)||
    failure.runtime_task_id!==config.runtimeTestTaskId||
    failure.epoch_version!==epochs.length||
    failure.branch!==approvedWorkBranch(current.plan)||
    !PHASES.has(failure.first_failed_phase)||
    !current.plan.tasks.some((task:{id:string;agent_id:string})=>
      task.id===failure.plan_task_id&&task.agent_id==="test"))
  deny("failed Runner receipt not bound to latest authenticated epoch");
 if(current.plan_digest!==planDigest(current.plan)||
    initial.plan_digest!==planDigest(initial.plan))
  deny("operational epoch plan digest changed");

 // A revoked root during asynchronous validation must not produce a
 // planning-eligible result. This second check also verifies the most
 // recent persisted epoch still matches the one inspected above.
 const again=await config.intake.verifiedEpochHistory();
 if(again.length!==epochs.length||
    again.at(-1)?.plan_digest!==current.plan_digest)
  deny("operational history changed while obtaining validation evidence");

 const remaining=MAX_TOTAL_EPOCHS-epochs.length;
 const result:TrustedRepairFeedbackSignal={
  status:remaining>0?"repair_planning_eligible":"repair_budget_exhausted",
  provenance:"gateway_verified_docker_runner",
  authority_kind:"existing_rust_operational_root",
  session_id:config.sessionId,
  failed_plan_digest:current.plan_digest,
  root_plan_digest:initial.plan_digest,
  failed_task_id:failure.plan_task_id,
  failed_runtime_task_id:failure.runtime_task_id,
  failed_request_id:failure.request_id,
  failed_epoch:failure.epoch_version,
  tested_commit_sha:failure.tested_commit_sha,
  work_branch:failure.branch,
  first_failed_phase:failure.first_failed_phase,
  typecheck_error_codes:Object.freeze([...failure.typecheck_error_codes]),
  remaining_repair_epochs:remaining,
  execution_authorized:false,
  permission_granted:false
 };
 return Object.freeze(result);
}
