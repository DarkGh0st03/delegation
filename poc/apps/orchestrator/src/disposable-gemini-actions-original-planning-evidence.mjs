/**
 * Actions-only post-Planning evidence gate.
 *
 * The ORIGINAL signed Backend checkpoint and signed Engineer receipt remain
 * independently verified by the existing Review Host. This module provides
 * a missing, additional owner-memory guard: the admitted, bounded Gemini
 * Planning model must have a completed metered response before the CI
 * Engineer simulation may write its Ed25519 review.
 *
 * A call counter alone is insufficient (timeouts/failures can start calls).
 * The budgeted wrapper commits usage ONLY after an entire valid response.
 * This is NOT proof of model-authored source, a billed amount or a monetary
 * cap, and is NOT permission to start an inference.
 */
import {DisposablePrivateBudgetedAdkModel}
 from "./disposable-gemini-live-budgeted-model.mjs";

const EXPECTED_MODEL="gemini-3.8-flash";
const deny=()=>{throw Error("Disposable Actions original Planning evidence NO-GO");};
const nonneg=n=>Number.isSafeInteger(n)&&n>=0;
const positive=n=>nonneg(n)&&n>0;

/**
 * This must be invoked with the SAME original authority's Planner model
 * immediately after original signed Planning and before CI Engineer signing.
 * No model-provided JSON, ADK Tool/A2A output, caller-supplied counters
 * or workflow environment can substitute for this in-process model object.
 */
export function attestDisposableActionsOriginalPlanningCompletion(authority){
 const model=authority?.planner?.model;
 if(!(model instanceof DisposablePrivateBudgetedAdkModel)||
    model.phase!=="planning"||
    model.model!==EXPECTED_MODEL)deny();
 let report;
 try{report=model.publicSummary();}
 catch{deny();}
 if(!report||typeof report!=="object"||Array.isArray(report)||
    report.profile!=="private-gemini-model-budget-not-proof-of-billing"||
    report.phase!=="planning"||
    report.model_name!==EXPECTED_MODEL||
    !positive(report.calls_started)||
    !positive(report.max_calls)||
    report.calls_started>report.max_calls||
    !positive(report.reported_input_tokens)||
    !nonneg(report.reported_output_tokens)||
    !positive(report.reported_total_tokens)||
    !positive(report.max_reported_tokens)||
    report.reported_total_tokens>report.max_reported_tokens||
    report.reported_total_tokens<
     report.reported_input_tokens+report.reported_output_tokens||
    report.blocked!==false||
    report.real_generated_source_proven!==false||
    report.billed_amount_measured!==false||
    report.monetary_cap_enforced!==false)deny();
 return Object.freeze({
  status:"original_gemini_planning_metered_completion_owner_memory_only",
  model_name:EXPECTED_MODEL,
  completed_metered_planning_calls_at_least_one:true,
  calls_started:report.calls_started,
  reported_total_tokens:report.reported_total_tokens,
  original_backend_signed_checkpoint_verified_here:false,
  authenticated_engineer_review_verified_here:false,
  model_authored_code_proven:false,
  actual_provider_billing_verified:false,
  monetary_cap_enforced:false,
  root_issued_here:false
 });
}
