import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {getApprovedOfflineScenario} from
  "../../apps/test-runner-controller/fixtures/approved-scenarios.mjs";
import {createHash} from "node:crypto";
import {ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES,
 ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT,
 ACCOUNT_SUSPENSION_BASELINE_GIT_BLOB_HASHES}
 from "../../apps/test-runner-controller/fixtures/account-suspension-unsolved-baseline.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
 from "../../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";
import {assessAccountSuspensionSourceGrantCoverage}
 from "../account-suspension-source-readiness.mjs";
import {makeIsolatedPlanningFixture,assertBillableFixtureOptIn,
  runIsolatedGeminiFixture,classifyPlannerProbeFailure,
  summarizeIsolatedPlannerGate,FIXTURE_SCENARIOS,CONSENT,
  ACCOUNT_SUSPENSION_PLANNER_MAX_TURNS}
  from "../run-gemini-planner-fixture.mjs";

const script=resolve(dirname(fileURLToPath(import.meta.url)),
  "../run-gemini-planner-fixture.mjs");

test("a non-billable dry run reports unsolved fixture scope with zero inference",()=>{
  for(const scenario of Object.keys(FIXTURE_SCENARIOS)){
    const text=execFileSync(process.execPath,[script,"--dry-run",scenario],
      {encoding:"utf8",timeout:10000,env:{PATH:process.env.PATH}});
    const report=JSON.parse(text);
    assert.equal(report.status,"no_model_or_network_called");
    assert.equal(report.gemini_inference_calls,0);
    assert.equal(report.can_write,false);
    assert.equal(report.can_approve,false);
    assert.match(report.fingerprint_not_git_sha,/^[a-f0-9]{40}$/);
    assert.ok(report.files>=5);
  }
});

test("read-only isolated fixture delivers bounded Gitea-shaped files and no writes",async()=>{
  for(const scenario of Object.keys(FIXTURE_SCENARIOS)){
    const fixture=makeIsolatedPlanningFixture(scenario);
    assert.equal(fixture.snapshot.repository.repository,"iam-console-poc");
    const metadata=await fixture.readPort.invoke("read_repository",{});
    assert.equal(metadata.revision,fixture.snapshot.base_revision);
    assert.equal(metadata.full_name,"thesis/iam-console-poc");
    const directory=await fixture.readPort.invoke("list_directory",{branch:"main",path:""});
    assert.ok(directory.entries.length>0);
    const target=fixture.snapshot.files[0];
    const source=await fixture.readPort.invoke("read_file",{branch:"main",path:target});
    assert.ok(source.content.length>0);
    assert.equal(source.revision,fixture.snapshot.base_revision);
    await assert.rejects(
      fixture.readPort.invoke("read_file",{branch:"feature/attack",path:target}),
      /outside approved scope/);
    await assert.rejects(
      fixture.readPort.invoke("update_file",{branch:"main",path:target}),
      /outside approved scope/);
    assert.equal(fixture.invokedReads.filter(x=>x.tool==="read_file").length,2);
  }
});

test("no paid execute action without exact operator phrase and fresh evidence location",()=>{
  for(const input of [
    {flag:"--dry-run",consent:CONSENT,apiKey:"dummy",outputDir:"/tmp/fixture-output"},
    {flag:"--execute",consent:"sure",apiKey:"dummy",outputDir:"/tmp/fixture-output"},
    {flag:"--execute",consent:CONSENT,apiKey:"",outputDir:"/tmp/fixture-output"},
    {flag:"--execute",consent:CONSENT,apiKey:"dummy",outputDir:"relative"},
    {flag:"--execute",consent:CONSENT,apiKey:"dummy",outputDir:"/tmp/../secret"}
  ])assert.throws(()=>assertBillableFixtureOptIn(input));
  assert.equal(assertBillableFixtureOptIn({
    flag:"--execute",consent:CONSENT,apiKey:"dummy",
    outputDir:"/tmp/never-created-evidence-dir"
  }),"/tmp/never-created-evidence-dir");
});

test("unknown or satisfied scenario cannot be silently substituted",()=>{
  assert.throws(()=>makeIsolatedPlanningFixture("account-suspension-unknown"),/unsupported/);
  assert.throws(()=>makeIsolatedPlanningFixture("__proto__"),/unsupported/);
});

test("exported billed runner also denies missing consent before touching the disk",async()=>{
  await assert.rejects(()=>runIsolatedGeminiFixture({
    scenario:"department-directory",apiKey:"dummy",
    modelName:"gemini-3.8-flash",
    outputDir:"/tmp/never-created-evidence-dir"
  }),/billable Gemini probe denied/);
});


test("API failure evidence uses a closed classification and never copies raw secrets",()=>{
  const issue=Object.assign(new Error("Provider failed on API key SECRET-DO-NOT-LOG or user source"),{
    status:400,request:{source:"PRIVATE_SOURCE"},apiKey:"PRIVATE_SECRET"
  });
  const result=classifyPlannerProbeFailure(issue);
  assert.equal(result.http_status,400);
  assert.equal(result.cause,"invalid_request_or_function_schema");
  assert.ok(!JSON.stringify(result).includes("SECRET-DO-NOT-LOG"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SOURCE"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SECRET"));
  assert.equal(classifyPlannerProbeFailure({status:429}).cause,"quota_or_rate_limit");
  assert.equal(classifyPlannerProbeFailure({response:{status:401}}).cause,"authentication");
  assert.equal(classifyPlannerProbeFailure({code:404}).cause,"model_or_endpoint_not_found");
  assert.equal(classifyPlannerProbeFailure(new Error("Unknown")).cause,"unknown");
});

test("Account Suspension isolated manual probe matches original real pilot domain and missing E2E",()=>{
 const f=makeIsolatedPlanningFixture("account-suspension");
 const original=getApprovedOfflineScenario("account-suspension");
 assert.equal(f.spec.requirement,original.requirement);
 assert.equal(f.spec.workBranch,original.workBranch);
 assert.ok(f.snapshot.files.includes("apps/backend/src/users/user.service.ts"));
 assert.ok(!f.snapshot.files.includes(original.planning_intent.newTestFile));
 assert.ok(f.snapshot.directories.includes("tests/e2e"));
 assert.equal(f.spec.gradeAs,"account-suspension");
});

test("Planner-only accepted and rejected gates emit bounded evidence without private paths",()=>{
 const secret="PRIVATE_REPO_PATH_AND_KEY_SHOULD_NOT_APPEAR";
 const rejected=[
  {kind:"model_turn",status:"started",turn:1,private_text:secret},
  {kind:"read",status:"verified",tool:"read_file",path:secret},
  {kind:"plan_rejection",stage:"contract",
   reason:"execution_pr_before_runner",payload:secret},
  {kind:"model_turn",status:"started",turn:2},
  {kind:"plan_rejection",stage:"contract",
   reason:"execution_update_without_read",payload:secret},
  {kind:"model_usage",source:"provider_reported",turn:1,
   input_tokens:200,output_tokens:100}
 ];
 const result=summarizeIsolatedPlannerGate({observations:rejected});
 assert.equal(result.outcome,"proposal_rejected");
 assert.equal(result.rejection_events,2);
 assert.equal(result.last_rejection_stage,"contract");
 assert.equal(result.last_rejection_reason,"execution_update_without_read");
 assert.equal(result.model_turns_started,2);
 assert.equal(result.verified_source_file_reads,1);
 assert.equal(result.provider_usage_reports,1);
 assert.equal(result.cost_and_invoice,"not_measured");
 assert.equal(result.operational_execution_authorized,false);
 assert.equal(JSON.stringify(result).includes(secret),false);
 const accepted=summarizeIsolatedPlannerGate({
  observations:[...rejected,{kind:"proposal",status:"unapproved",digest:secret}],
  accepted:true,benchmarkPass:true});
 assert.equal(accepted.outcome,"native_executable_dag_admitted");
 assert.equal(accepted.benchmark_technical_preflight_pass,true);
 assert.equal(accepted.rejection_events,2);
 assert.equal(JSON.stringify(accepted).includes(secret),false);
});
test("Planner-only rejects model failure strings and unknown diagnostic payloads",()=>{
 const diagnostics=summarizeIsolatedPlannerGate({observations:[
  {kind:"plan_rejection",stage:"contract",reason:"PRIVATE_SOURCE"},
  {kind:"model_failure",category:"private API key",phase:"delegate_exception"},
  {kind:"read",status:"denied",tool:"read_file",path:"private/secrets.env"}
 ]});
 assert.equal(diagnostics.outcome,"model_or_provider_failure");
 assert.equal(diagnostics.last_rejection_reason,"contract_validation_other");
 assert.equal(diagnostics.model_failure_category,"unknown");
 assert.ok(!JSON.stringify(diagnostics).includes("private API key"));
 assert.ok(!JSON.stringify(diagnostics).includes("private/secrets.env"));
 assert.throws(()=>summarizeIsolatedPlannerGate({observations:null}),/invalid/);
});

test("paid run 41464279775 exhausted local model budget, not a DAG preflight",()=>{
 const observations=Array.from({length:10},(_,i)=>[
  {kind:"model_turn",status:"started",turn:i+1},
  {kind:"read",status:"verified",tool:"read_file",path:"PRIVATE_FILE_"+i},
  {kind:"model_turn",status:"completed",turn:i+1}
 ]).flat();
 observations.push({kind:"budget_exhausted",budget:"model_turns",
  completed_turns:10,max_model_turns:10});
 observations.push({kind:"model_failure",phase:"adk_runner_error",
  category:"unknown",turn:11,http_status:null});
 observations.push({kind:"plan_rejection",stage:"grounding",
  reason:"ungrounded_or_missing_output"});
 const outcome=summarizeIsolatedPlannerGate({observations});
 assert.equal(outcome.outcome,"local_model_turn_budget_exhausted");
 assert.equal(outcome.local_turn_budget_exhausted,true);
 assert.equal(outcome.local_max_model_turns,10);
 assert.equal(outcome.verified_source_file_reads,10);
 assert.equal(outcome.rejection_events,1);
 assert.ok(!JSON.stringify(outcome).includes("PRIVATE_FILE"));
});

test("Account Suspension manual probe budget remains exactly 20 turns, not a billing cap",()=>{
 assert.equal(ACCOUNT_SUSPENSION_PLANNER_MAX_TURNS,20);
});

test("D0 unsolved main is byte-pinned and never exposes a solved answer to Gemini",async()=>{
 assert.equal(ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT,
  "405748b1e77992b6bd8630a3ab6f990658d32f6b");
 const expected=getApprovedOfflineScenario("account-suspension");
 const existing=Object.keys(ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES).sort();
 const future=expected.planning_intent.newTestFile;
 assert.equal(existing.length,10);
 assert.deepEqual([...existing,future].sort(),Object.keys(expected.files).sort());
 assert.equal(Object.keys(ACCOUNT_SUSPENSION_BASELINE_GIT_BLOB_HASHES).length,10);
 for(const path of existing){
  const source=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[path];
  const blob=createHash("sha1")
   .update("blob "+Buffer.byteLength(source,"utf8")+"\0")
   .update(source,"utf8").digest("hex");
  assert.equal(blob,ACCOUNT_SUSPENSION_BASELINE_GIT_BLOB_HASHES[path],
   "immutable Git blob mismatch for "+path);
 }
 const source=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES;
 assert.doesNotMatch(source["apps/backend/src/users/user.service.ts"],
  /suspendUser\(|reactivateUser\(/u);
 assert.doesNotMatch(source["apps/backend/src/users/user.routes.ts"],
  /\/:id\/(?:suspend|reactivate)/u);
 assert.doesNotMatch(source["apps/frontend/src/api/users-api.ts"],
  /suspendUser\(|reactivateUser\(/u);
 assert.doesNotMatch(source["apps/frontend/src/pages/UserDetailPage.tsx"],
  /changeStatus\(/u);
 assert.match(ACCOUNT_SUSPENSION_REFERENCE_FILES[
  "apps/backend/src/users/user.routes.ts"],/\/:id\/suspend/u);
 const fixture=makeIsolatedPlanningFixture("account-suspension");
 assert.equal(fixture.snapshot.files.length,10);
 assert.ok(fixture.snapshot.directories.includes("tests/e2e"));
 assert.ok(!fixture.snapshot.files.includes(future));
 for(const path of existing){
  const r=await fixture.readPort.invoke("read_file",{branch:"main",path});
  assert.equal(r.content,source[path]);
 }
 assert.deepEqual([...new Set(fixture.invokedReads.filter(x=>x.tool==="read_file")
  .map(x=>x.path))].sort(),existing);
});

test("D0 unsolved source flags structurally admissible but functionally restricted old grants",()=>{
 const root="gitea://gitea.local/thesis/iam-console-poc";
 const branch="feature/native-planning-read";
 const file=path=>root+"/branches/"+encodeURIComponent(branch)+"/files/"+path;
 const tasks=[
  {id:"branch",agent_id:"orchestrator"},
  {id:"backend",agent_id:"backend"},
  {id:"frontend",agent_id:"frontend"},
  {id:"test",agent_id:"test"}
 ];
 const partial=[
  {agent_id:"backend",task_id:"backend",operation:"read_file",
   resource:file("apps/backend/src/users/user.service.ts")},
  {agent_id:"backend",task_id:"backend",operation:"update_file",
   resource:file("apps/backend/src/users/user.service.ts")},
  {agent_id:"frontend",task_id:"frontend",operation:"read_file",
   resource:file("apps/frontend/src/pages/UserDetailPage.tsx")},
  {agent_id:"frontend",task_id:"frontend",operation:"update_file",
   resource:file("apps/frontend/src/pages/UserDetailPage.tsx")}
 ];
 const p={repository:{authority:"gitea.local",owner:"thesis",
  repository:"iam-console-poc"},tasks,requested_permissions:partial};
 const result=assessAccountSuspensionSourceGrantCoverage({
  plan:p,workBranch:branch});
 assert.equal(result.status,"manual_source_grant_review_required");
 assert.equal(result.contract_surfaces_missing_on_baseline,6);
 assert.equal(result.corresponding_read_and_update_capabilities,2);
 assert.deepEqual(result.missing_same_task_read_and_update,[
  "packages/shared/src/account-status.ts",
  "apps/backend/src/users/user.controller.ts",
  "apps/backend/src/users/user.routes.ts",
  "apps/frontend/src/api/users-api.ts"
 ]);
 assert.equal(result.advisory_only,true);
 assert.equal(result.permission_grants_issued,false);
 assert.equal(result.authorization_or_billing_gate,false);
 // Missing read in the SAME signed Task never counts as safe write authority.
 const broken={...p,requested_permissions:[
  ...partial.filter(x=>x.operation!=="read_file"||
   !x.resource.endsWith("user.service.ts")),
  {agent_id:"backend",task_id:"test",operation:"read_file",
   resource:file("apps/backend/src/users/user.service.ts")}
 ]};
 const denied=assessAccountSuspensionSourceGrantCoverage({
  plan:broken,workBranch:branch});
 assert.ok(denied.missing_same_task_read_and_update.includes(
  "apps/backend/src/users/user.service.ts"));
});
test("D0 source coverage is role- and Task-bound, not a new approval",()=>{
 const root="gitea://gitea.local/thesis/iam-console-poc";
 const branch="feature/native-planning-read";
 const plan={repository:{authority:"gitea.local",owner:"thesis",
  repository:"iam-console-poc"},
  tasks:[{id:"backend",agent_id:"backend"},
   {id:"frontend",agent_id:"frontend"}],
  requested_permissions:[]};
 for(const [role,files] of [
  ["backend",["packages/shared/src/account-status.ts",
   "apps/backend/src/users/user.service.ts",
   "apps/backend/src/users/user.controller.ts",
   "apps/backend/src/users/user.routes.ts"]],
  ["frontend",["apps/frontend/src/api/users-api.ts",
   "apps/frontend/src/pages/UserDetailPage.tsx"]]]){
  for(const path of files)for(const operation of ["read_file","update_file"])
   plan.requested_permissions.push({task_id:role,agent_id:role,
    operation,resource:root+"/branches/"+encodeURIComponent(branch)+"/files/"+path});
 }
 const report=assessAccountSuspensionSourceGrantCoverage({plan,workBranch:branch});
 assert.equal(report.status,"observed_capabilities_cover_known_missing_interfaces");
 assert.equal(report.corresponding_read_and_update_capabilities,6);
 assert.deepEqual(report.missing_same_task_read_and_update,[]);
 assert.equal(report.functional_correctness_not_proven,true);
 assert.equal(report.permission_grants_issued,false);
});
