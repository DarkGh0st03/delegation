#!/usr/bin/env node
/**
 * Compare SAVED unsigned F1 Planner runs without a single new Gemini call.
 *
 * This is research diagnostics, not a provider receipt, billing statement,
 * Engineer signature, authorization, execution result, or R5 acceptance.
 * Source, prompts, proposal descriptions, paths, credentials and original
 * model traces are never copied into the output.
 */
import {readFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {evaluatePlannerFeasibility} from "./planner-feasibility-eval.mjs";
import {assessF1DepartmentDirectoryPlan}
  from "./f1-department-directory-functional-review.mjs";
import {planDigest} from "../packages/plan-contracts/src/plan.mjs";

const SHA=/^[a-f0-9]{40}$/u;
const LABEL=/^[a-z][a-z0-9_-]{0,31}$/u;
const MAX_RUNS=6;
function deny(){throw Error("F1 offline Planner comparison NO-GO");}
function plain(x){return x!==null&&typeof x==="object"&&!Array.isArray(x);}
function verifiedUnsignedProposal(p,sha){
  if(!plain(p)||p.status!=="unapproved_proposal"||
     !plain(p.plan)||p.plan.base_revision!==sha||
     !SHA.test(p.plan.base_revision??"")||
     typeof p.digest!=="string"||
     !/^[a-f0-9]{64}$/u.test(p.digest)||
     !Number.isSafeInteger(p.verified_source_reads)||
     p.verified_source_reads<1||
     p.verified_source_reads>64||
     "approval" in p||"credential" in p)
    deny();
  let recomputed;
  try{recomputed=planDigest(p.plan);}
  catch{deny();}
  if(recomputed!==p.digest)deny();
}
const score=r=>Number(r.technical_preflight_pass)*100+
  Number(r.functional_design_plausible)*100+
  r.technical_criteria_passed+r.functional_checks_passed;

/** Labels are operator-provided aliases, NOT authenticated model identities.
 * All scores are derived again from saved complete unsigned proposals and
 * source-read traces rather than trusting serialized precomputed scores.
 */
export function compareSavedF1PlannerRuns({expectedBaseRevision,runs}={}){
  if(!SHA.test(expectedBaseRevision??"")||!Array.isArray(runs)||
     runs.length<1||runs.length>MAX_RUNS)
    deny();
  const names=new Set(),rows=[];
  for(const run of runs){
    if(!plain(run)||!LABEL.test(run.label??"")||names.has(run.label)||
       !Array.isArray(run.observations)||run.observations.length>512)
      deny();
    names.add(run.label);
    verifiedUnsignedProposal(run.proposal,expectedBaseRevision);
    let tech,quality;
    try{
      tech=evaluatePlannerFeasibility({
        scenario:"department-directory",
        expectedBaseRevision,
        proposal:run.proposal,observations:run.observations
      });
      quality=assessF1DepartmentDirectoryPlan({
        proposal:run.proposal,expectedBaseRevision
      });
    }catch{deny();}
    const checked=tech.criteria.length;
    const passed=tech.criteria.filter(x=>x.pass).length;
    const reported=tech.evidence.provider_token_usage;
    rows.push({
      label:run.label,
      source_revision:expectedBaseRevision,
      unsigned_plan_digest:run.proposal.digest,
      technical_preflight_pass:tech.technical_preflight_pass,
      technical_criteria_passed:passed,
      technical_criteria_count:checked,
      functional_design_plausible:quality.functional_design_plausible,
      functional_checks_passed:quality.passed_count,
      functional_checks_count:quality.checked_count,
      missing_functional_checks:[...quality.failed_checks],
      scenario_anchor_coverage_pass:tech.criteria.find(
        x=>x.key==="scenario_anchor_coverage")?.pass===true,
      observed_model_turns:tech.evidence.model_turn_attempts,
      verified_file_reads:tech.evidence.verified_file_reads,
      provider_usage_source:reported.source,
      provider_reported_input_tokens:reported.input_tokens,
      provider_reported_output_tokens:reported.output_tokens,
      actual_billed_cost:"not_measured",
      model_identity_authenticated:false,
      real_gemini_inference_authenticated:false,
      implementation_verified:false,
      engineer_approved:false,
      execution_permitted:false,
      external_r5_go:false
    });
  }
  rows.sort((a,b)=>score(b)-score(a)||a.label.localeCompare(b.label));
  return Object.freeze({
    schema:"f1-saved-planner-offline-comparison-v1",
    status:"offline_engineer_review_diagnostics_only",
    scenario_id:"department-directory",
    expected_base_revision:expectedBaseRevision,
    compared_runs:rows.length,
    comparison_order:"functional_and_technical_diagnostic_score_then_label",
    rows:Object.freeze(rows.map(x=>Object.freeze(x))),
    ranking_is_not_engineer_approval:true,
    model_call_count_during_comparison:0,
    provider_charge_incurred_by_comparison:false,
    source_or_raw_model_output_included:false,
    external_r5_go:false
  });
}
async function boundedJson(path){
  if(typeof path!=="string"||path.length>1024)deny();
  let source;
  try{source=await readFile(path,"utf8");}
  catch{deny();}
  if(Buffer.byteLength(source)>384000)deny();
  try{return JSON.parse(source);}catch{deny();}
}
async function main(){
  const [sha,...specs]=process.argv.slice(2);
  if(!SHA.test(sha??"")||!specs.length||specs.length>MAX_RUNS)
    deny();
  const runs=[];
  for(const spec of specs){
    // Example: medium=/private/f1-medium. No secrets in command arguments.
    const equals=spec.indexOf("=");
    if(equals<1)deny();
    const label=spec.slice(0,equals),dir=spec.slice(equals+1);
    if(!LABEL.test(label)||!dir.startsWith("/")||dir.length>512)deny();
    runs.push({label,
      proposal:await boundedJson(join(dir,"unapproved-proposal.json")),
      observations:await boundedJson(join(dir,"observations.json"))
    });
  }
  process.stdout.write(JSON.stringify(compareSavedF1PlannerRuns({
    expectedBaseRevision:sha,runs
  }),null,2)+"\n");
}
if(process.argv[1]&&import.meta.url===
   pathToFileURL(resolve(process.argv[1])).href){
  main().catch(()=>{
    // Deliberately suppress untrusted provider/source/path text.
    process.stderr.write("F1 offline Planner comparison NO-GO\n");
    process.exitCode=1;
  });
}
