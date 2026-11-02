#!/usr/bin/env node
/**
 * Experimental REAL Gemini planning-only probe over a FROZEN, IN-MEMORY
 * IAM Console baseline. Intentionally NOT a live Gitea/Gateway/OPA or
 * credential-backed Planning session. No Engineer approval, DC or code writes.
 *
 * Default dry-run imports NO model. Billable inference requires an explicit
 * --execute switch AND a separate exact operator opt-in environment variable.
 */
import {createHash} from "node:crypto";
import {mkdir,lstat,open} from "node:fs/promises";
import {isAbsolute,normalize,resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
  "../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_REQUIREMENT,getApprovedOfflineScenario} from
  "../apps/test-runner-controller/fixtures/approved-scenarios.mjs";
import {evaluatePlannerFeasibility} from "./planner-feasibility-eval.mjs";

export const CONSENT="I AUTHORIZE GEMINI API CHARGES";
export const FIXTURE_SCENARIOS=Object.freeze({
  "account-suspension":{
    requirement:ACCOUNT_SUSPENSION_REQUIREMENT,
    workBranch:getApprovedOfflineScenario("account-suspension").workBranch,
    gradeAs:"account-suspension"
  },
  "department-directory":{
    requirement:"Enable an administrator to search the IAM user directory by department (case-insensitive), with an authenticated API, accessible frontend and meaningful tests. Preserve existing account suspension/reactivation semantics.",
    workBranch:"feature/experiment-department-directory",
    gradeAs:"department-directory"
  },
  "suspension-feedback":{
    requirement:"Improve the accessibility of IAM Console suspension and reactivation feedback: the existing success message must be announced non-interruptively to assistive technology, and an action failure must be announced assertively. Keep the existing visible messages and backend lifecycle/API unchanged, with frontend regression tests.",
    workBranch:"feature/experiment-suspension-feedback",
    gradeAs:"suspension-feedback"
  }
});

function requireCase(id){
  if(!Object.hasOwn(FIXTURE_SCENARIOS,id))
    throw Error("unsupported isolated feasibility scenario");
  return FIXTURE_SCENARIOS[id];
}
const validPath=p=>typeof p==="string"&&p.length>0&&
  !p.startsWith("/")&&!p.includes("\\")&&
  !p.split("/").some(v=>!v||v==="."||v==="..");

export function makeIsolatedPlanningFixture(scenario){
  const spec=requireCase(scenario);
  const files=ACCOUNT_SUSPENSION_REFERENCE_FILES;
  const entries=Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length<5||entries.some(([p,body])=>!validPath(p)||
       typeof body!=="string"||!body))
    throw Error("invalid independent IAM source baseline");
  // Novelty is explicitly defined against the unsolved fixture, not a
  // pre-generated department-directory or enhancement result.
  if(scenario==="department-directory"&&
      files["apps/backend/src/users/user.service.ts"].includes("listUsersByDepartment("))
    throw Error("baseline already implements the department feature");
  if(scenario==="suspension-feedback"){
    const page=files["apps/frontend/src/pages/UserDetailPage.tsx"];
    if(!page.includes('className="success-message"')||
       !page.includes('className="error-message"'))
      throw Error("accessibility fixture requires existing visible feedback");
    // Status/alert semantic roles are ABSENT, though visible text already
    // exists. Avoid giving the model any specific file-path solution.
    if(/\brole\s*=\s*["'](?:status|alert)["']/u.test(page))
      throw Error("baseline already includes the requested accessibility semantics");
  }

  const allPaths=entries.map(([p])=>p);
  // The complete original pilot reference contains the E2E expected output,
  // but the disposable baseline presents that file as NOT YET CREATED.
  const paths=scenario==="account-suspension"?
    allPaths.filter(p=>p!==getApprovedOfflineScenario("account-suspension")
      .planning_intent.newTestFile):allPaths;
  const dirs=new Set([""]);
  for(const p of allPaths){
    const parts=p.split("/");
    for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join("/"));
  }
  // This is a synthetic fixture content fingerprint, NOT a Git commit SHA,
  // native verification receipt or an authenticated Gitea base revision.
  const fingerprint=createHash("sha1").update(JSON.stringify(entries)).digest("hex");
  const snapshot=Object.freeze({
    session_id:"isolated_"+scenario.replaceAll("-","_"),
    repository:Object.freeze({
      authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"
    }),
    base_revision:fingerprint,
    directories:Object.freeze([...dirs].sort()),
    files:Object.freeze(paths)
  });
  const invoked=[];
  const readPort={
    async invoke(tool,args,signal){
      if(signal?.aborted)throw Error("read cancelled");
      invoked.push(Object.freeze({tool,path:args.path??null}));
      const common={provider:"gitea",performed:true,tool,
        revision:fingerprint};
      if(tool==="read_repository"&&Object.keys(args).length===0)
        return {...common,default_branch:"main",full_name:"thesis/iam-console-poc"};
      if((tool==="list_directory"||tool==="read_file")&&
          args.branch==="main"&&typeof args.path==="string"){
        if(tool==="read_file"&&paths.includes(args.path)&&
           Object.hasOwn(files,args.path))
          return {...common,branch:"main",path:args.path,content:files[args.path]};
        if(tool==="list_directory"&&dirs.has(args.path)){
          const prefix=args.path?args.path+"/":"";
          const descendants=[...dirs].filter(x=>x&&x.startsWith(prefix)&&
            x!==args.path).map(x=>({type:"dir",path:x}));
          const childDirs=descendants.filter(x=>!x.path.slice(prefix.length).includes("/"));
          const childFiles=paths.filter(x=>x.startsWith(prefix)&&
            !x.slice(prefix.length).includes("/")).map(x=>({type:"file",path:x}));
          return {...common,branch:"main",path:args.path,entries:[
            ...childDirs,...childFiles].sort((a,b)=>a.path.localeCompare(b.path))};
        }
      }
      throw Error("isolated fixture read outside approved scope");
    }
  };
  return Object.freeze({
    spec,snapshot,readPort,
    get invokedReads(){return invoked.map(x=>({...x}));},
    agents:Object.freeze({
      backend:Object.freeze({did:"did:example:fixture-backend",card_ref:"fixture:backend"}),
      frontend:Object.freeze({did:"did:example:fixture-frontend",card_ref:"fixture:frontend"}),
      test:Object.freeze({did:"did:example:fixture-test",card_ref:"fixture:test"})
    })
  });
}

export function assertBillableFixtureOptIn({flag,consent,apiKey,outputDir}){
  if(flag!=="--execute"||consent!==CONSENT||
     typeof apiKey!=="string"||!apiKey.trim())
    throw Error("billable Gemini probe denied: explicit --execute, exact consent and API key required");
  if(typeof outputDir!=="string"||!isAbsolute(outputDir)||
     normalize(outputDir)!==outputDir||resolve(outputDir)!==outputDir)
    throw Error("absolute normalized new output directory required");
  return outputDir;
}

/**
 * Keep only allowlisted error categories. Never persist raw provider errors:
 * SDK messages can include request contents, source code or API keys.
 */
export function classifyPlannerProbeFailure(error){
  const obj=error&&typeof error==="object"?error:{};
  const statusCandidates=[obj.status,obj.code,obj.response?.status];
  const http_status=statusCandidates.find(n=>Number.isInteger(n)&&n>=400&&n<=599)??null;
  const message=typeof obj.message==="string"?obj.message:"";
  let cause="unknown";
  if(http_status===401||/API_KEY_INVALID|UNAUTHENTICATED/i.test(message))
    cause="authentication";
  else if(http_status===403||/PERMISSION_DENIED/i.test(message))
    cause="permission_or_billing";
  else if(http_status===429||/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message))
    cause="quota_or_rate_limit";
  else if(http_status===404||/NOT_FOUND/i.test(message))
    cause="model_or_endpoint_not_found";
  else if(http_status===400||/INVALID_ARGUMENT|tool.*schema|function.*declaration/i.test(message))
    cause="invalid_request_or_function_schema";
  else if(http_status!==null&&http_status>=500)
    cause="provider_server_failure";
  else if(/abort|deadline|timeout/i.test(message))
    cause="timeout_or_cancellation";
  else if(/fetch failed|ECONN|ENOTFOUND|network/i.test(message))
    cause="transport";
  return Object.freeze({
    schema_version:"1.0.0",
    phase:"planning_inference_or_validation",
    cause,http_status,
    raw_exception_message_recorded:false,
    api_key_or_source_recorded:false,
    provider_cost:"unknown"
  });
}


/** Safe F5->D0 gate telemetry. The only diagnostic strings permitted here
 * are closed, host-defined categories from the trusted Planner. Paths,
 * prompt text, error messages, provider request/response bodies and cost
 * estimates never enter the published gate outcome. */
const SAFE_PLANNER_GATE_REASONS=new Set([
  "ungrounded_or_missing_output","invalid_json","invalid_proposal_shape",
  "invalid_task_count","invalid_task_identity","unsupported_agent_role",
  "unsupported_tool_for_role","unauthorized_existing_file",
  "unauthorized_new_file","invalid_path","invalid_permission_path",
  "missing_branch_task","missing_branch_dependency",
  "conflicting_unordered_writes","duplicate_task_permission",
  "incorrect_work_branch","invalid_dependencies","invalid_permissions",
  "execution_dag_incompatible","execution_unsupported_bounds",
  "execution_duplicate_task_ids","execution_missing_specialist",
  "execution_permission_not_in_task","execution_duplicate_permission",
  "execution_task_without_grants","execution_required_operation_count",
  "execution_first_branch","execution_cycle","execution_unknown_task",
  "execution_branch_dependency","execution_pr_before_runner",
  "execution_update_without_read","execution_unordered_writes",
  "execution_runner_before_edit","execution_pr_before_edit",
  "execution_duplicate_creation","execution_read_before_creation",
  "execution_wrong_runner_branch","execution_bad_file_resource",
  "contract_validation_other"
]);
const SAFE_MODEL_FAILURE_CATEGORIES=new Set([
  "authentication","permission_or_billing","quota_or_rate_limit",
  "model_or_endpoint_not_found","invalid_request_or_tool_schema",
  "provider_server_error","transport_or_timeout","unknown"
]);
export function summarizeIsolatedPlannerGate({observations,accepted=false,
 benchmarkPass=null}={}){
  if(!Array.isArray(observations)||observations.length>512||
     typeof accepted!=="boolean"||
     (benchmarkPass!==null&&typeof benchmarkPass!=="boolean"))
    throw Error("invalid trusted Planner gate observations");
  const rejections=observations.filter(e=>e?.kind==="plan_rejection");
  const last=rejections.at(-1);
  const modelFailures=observations.filter(e=>e?.kind==="model_failure");
  const lastModelFailure=modelFailures.at(-1);
  const started=observations.filter(e=>e?.kind==="model_turn"&&e.status==="started");
  const verifiedReads=observations.filter(e=>e?.kind==="read"&&
    e.status==="verified"&&e.tool==="read_file");
  const usage=observations.filter(e=>e?.kind==="model_usage"&&
    e.source==="provider_reported");
  const rejectionReason=SAFE_PLANNER_GATE_REASONS.has(last?.reason)
    ?last.reason:last?"contract_validation_other":null;
  const phase=["contract","json","grounding"].includes(last?.stage)
    ?last.stage:last?"unknown":null;
  const modelCategory=SAFE_MODEL_FAILURE_CATEGORIES.has(lastModelFailure?.category)
    ?lastModelFailure.category:lastModelFailure?"unknown":null;
  const exhausted=observations.find(e=>e?.kind==="budget_exhausted"&&
    e.budget==="model_turns"&&
    Number.isSafeInteger(e.completed_turns)&&e.completed_turns>=0&&
    Number.isSafeInteger(e.max_model_turns)&&e.max_model_turns>=1&&
    e.completed_turns===e.max_model_turns);
  const outcome=accepted?"native_executable_dag_admitted":
    exhausted?"local_model_turn_budget_exhausted":
    lastModelFailure?"model_or_provider_failure":
    last?"proposal_rejected":"no_accepted_proposal";
  return Object.freeze({
    schema_version:"1.0.0",
    outcome,
    last_rejection_stage:phase,
    last_rejection_reason:rejectionReason,
    rejection_events:rejections.length,
    model_failure_category:modelCategory,
    model_turns_started:started.length,
    local_turn_budget_exhausted:!accepted&&Boolean(exhausted),
    local_max_model_turns:exhausted?.max_model_turns??null,
    verified_source_file_reads:verifiedReads.length,
    provider_usage_reports:usage.length,
    benchmark_technical_preflight_pass:benchmarkPass,
    operational_execution_authorized:false,
    cost_and_invoice:"not_measured",
    model_turns_not_provider_billing_evidence:true,
    untrusted_source_or_model_text_recorded:false
  });
}

async function createPrivateDirectory(directory){
  await mkdir(directory,{recursive:false,mode:0o700});
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (stat.mode&0o077)!==0||
     (process.getuid?.()!==undefined&&stat.uid!==process.getuid()))
    throw Error("untrusted output directory");
}
async function persistJson(directory,name,value){
  const file=await open(join(directory,name),"wx",0o600);
  try{
    await file.writeFile(JSON.stringify(value,null,2)+"\n","utf8");
  }finally{await file.close();}
}

export async function runIsolatedGeminiFixture({scenario,apiKey,modelName,
  outputDir,billingConsent}){
  // Enforce charge consent at the exported API boundary too, not just CLI.
  assertBillableFixtureOptIn({flag:"--execute",consent:billingConsent,
    apiKey,outputDir});
  const fixture=makeIsolatedPlanningFixture(scenario);
  // Own a private evidence directory before consuming a model budget.
  await createPrivateDirectory(outputDir);
  const {createGeminiAdkModel}=await import(
    "../packages/agent-runtime/src/gemini-adk-model.ts");
  const {TrustedAdkReadOnlyPlanner}=await import(
    "../packages/orchestrator-runtime/src/trusted-adk-planner.ts");
  const observations=[];
  let status="failed_closed";
  try{
    const model=createGeminiAdkModel({apiKey,model:modelName});
    const originalD0=scenario==="account-suspension";
    // Only this scenario uses the same EXECUTABLE DAG validation and bounded
    // same-session correction feedback as the original failed paid pilot.
    const executablePreflight=originalD0?
      (await import("../apps/gateway/native-test/approved-dag-preflight.mjs"))
        .preflightApprovedPilotDag:null;
    const planner=new TrustedAdkReadOnlyPlanner({
      model,snapshot:fixture.snapshot,requirement:fixture.spec.requirement,
      planId:"isolated_"+scenario.replaceAll("-","_")+"_v1",
      workBranch:fixture.spec.workBranch,
      agents:fixture.agents,readPort:fixture.readPort,
      onObservation(e){observations.push(e);},
      // High limits are failsafes, not normal stopping targets.
      // The model should stop as soon as its complete proposal is ready.
      // Paid #41464279775: ten file reads consumed all ten turns.
      // Fourteen allows ten reads, draft and two bounded corrections.
      // Still one consented session; no automatic paid retry.
      maxModelTurns:originalD0?14:96,maxModelCallMs:120000,
      maxPlanningMs:originalD0?180000:900000,
      maxOutputTokens:originalD0?12000:16384,
      thinkingLevel:originalD0?"LOW":"MEDIUM",
      ...(originalD0?{
        maxProposalRevisions:2,
        validateProposedPlan:p=>executablePreflight({
          plan:p.plan,grants:p.plan.requested_permissions,
          repo:fixture.snapshot.repository,
          branch:fixture.spec.workBranch
        })
      }:{})
    });
    const proposal=await planner.propose();
    // This benchmark checks model feasibility only. The in-memory port
    // deliberately imitates Gitea's response SHAPE, not its trust properties.
    const report=evaluatePlannerFeasibility({
      scenario:fixture.spec.gradeAs,
      expectedBaseRevision:fixture.snapshot.base_revision,
      proposal,observations,
      ...(originalD0?{trustedSnapshot:fixture.snapshot}:{})
    });
    if(originalD0)report.native_executable_dag_preflight="pass";
    await persistJson(outputDir,"proposal.json",proposal);
    await persistJson(outputDir,"observations.json",observations);
    await persistJson(outputDir,"evaluation.json",report);
    await persistJson(outputDir,"planner-gate-outcome.json",
      summarizeIsolatedPlannerGate({observations,accepted:true,
        benchmarkPass:report.technical_preflight_pass}));
    status="unapproved_isolated_proposal";
    return {status,report};
  }catch(error){
    const classified=classifyPlannerProbeFailure(error);
    // Prefer the provider/ADK boundary's sanitized status over the generic
    // "no verified read-only grounded proposal" exception after Runner.runAsync.
    const signal=observations.find(e=>e.kind==="model_failure"&&
      e.phase==="delegate_exception")??
      observations.find(e=>e.kind==="model_failure"&&
      e.phase==="model_error_response")??
      observations.find(e=>e.kind==="model_failure"&&
      e.phase==="adk_runner_error");
    const diagnostics=signal?{
      ...classified,phase:signal.phase,
      cause:signal.category,http_status:signal.http_status,
      failure_from:"model_boundary"
    }:{...classified,failure_from:"planner_outer_boundary"};
    await persistJson(outputDir,"failure-diagnostics.json",diagnostics);
    await persistJson(outputDir,"planner-gate-outcome.json",
      summarizeIsolatedPlannerGate({observations}));
    throw error;
  }finally{
    // Preserve ONLY bounded observer metadata even when Gemini is unable to
    // produce a valid plan. This evidence has no prompts, source or API key.
    if(status==="failed_closed")
      await persistJson(outputDir,"failed-observations.json",observations);
    // The local marker is not a provider usage receipt; invoices/tokens
    // must be checked separately with the API provider.
    await persistJson(outputDir,"fixture-run.json",{
      schema_version:"1.0.0",scenario,model_name:modelName,
      status,baseline_kind:"synthetic_in_memory_fixture",
      base_revision:fixture.snapshot.base_revision,
      native_rust_gateway_opa_gitea:"not_tested",
      engineer_approval:"not_requested",
      operational_delegations:"not_issued",
      can_authorize_execution:false,
      planner_safety_budgets:{max_model_turns:scenario==="account-suspension"?14:96,
        max_read_calls:64,max_total_read_bytes:524288,
        max_planning_ms:scenario==="account-suspension"?180000:900000,
        max_model_call_ms:120000,
        max_output_tokens:scenario==="account-suspension"?12000:16384,
        thinking_level:scenario==="account-suspension"?"LOW":"MEDIUM",
        max_proposal_revisions:scenario==="account-suspension"?2:0},
      provider_tokens_and_cost:"not_measured"
    });
  }
}

async function main(){
  const [flag,scenario]=process.argv.slice(2);
  if(process.argv.length!==4||
     !["--dry-run","--execute"].includes(flag))
    throw Error("usage: --dry-run|--execute account-suspension|department-directory|suspension-feedback");
  const fixture=makeIsolatedPlanningFixture(scenario);
  if(flag==="--dry-run"){
    process.stdout.write(JSON.stringify({
      status:"no_model_or_network_called",
      case:scenario,requirement:fixture.spec.requirement,
      baseline_kind:"synthetic_in_memory_fixture",
      fingerprint_not_git_sha:fixture.snapshot.base_revision,
      files:fixture.snapshot.files.length,
      directories:fixture.snapshot.directories.length,
      available_tools:["read_repository","list_directory","read_file"],
      can_write:false,can_approve:false,gemini_inference_calls:0
    },null,2)+"\n");
    return;
  }
  const dir=assertBillableFixtureOptIn({
    flag,consent:process.env.DELEGATION_PLANNER_BILLING_CONSENT,
    apiKey:process.env.GEMINI_API_KEY,
    outputDir:process.env.DELEGATION_PLANNER_OUTPUT_DIR
  });
  const out=await runIsolatedGeminiFixture({
    scenario,apiKey:process.env.GEMINI_API_KEY,
    modelName:process.env.DELEGATION_PLANNER_MODEL||"gemini-3.8-flash",
    billingConsent:process.env.DELEGATION_PLANNER_BILLING_CONSENT,
    outputDir:dir
  });
  process.stdout.write(JSON.stringify({
    status:out.status,technical_preflight_pass:out.report.technical_preflight_pass,
    baseline_kind:"synthetic_in_memory_fixture",
    artifact_directory:dir,provider_cost:"not_measured",
    authorized_execution:false
  })+"\n");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(e=>{
    // Never print secrets, source snippets, provider request body or errors.
    process.stderr.write("Isolated Planner experiment refused or failed: "+
      (String(e?.message??"unknown").startsWith("billable Gemini probe denied")?
        "operator opt-in missing":"see private host diagnostics")+"\n");
    process.exitCode=1;
  });
}
