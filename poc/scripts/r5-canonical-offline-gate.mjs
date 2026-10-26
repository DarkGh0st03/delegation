#!/usr/bin/env node
/**
 * R5 reproducible, ZERO-BILLING contract evidence in one command.
 *
 * This aggregates distinct, independently meaningful tests on ONE checked-out
 * Git SHA. It is NOT yet a single deployed host/runner/real-Gitea/EVM end-to-end
 * and MUST NOT be represented as such. The real paid route is never invoked.
 *
 * Deliberately a fixed allowlist of existing tests, not arbitrary workflow
 * inputs or an operator-selectable shell command.
 */
import {spawnSync} from "node:child_process";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const SUITES=Object.freeze([
  {
    id:"signed_planning_and_strict_host_bootstrap",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-gateway-port.test.ts",
    title:"R5 protected owner service composes signed ADK Planning with strict host and revokes when IPC unavailable"
  },
  {
    id:"real_private_ipc_human_approval_and_oidc",
    path:"poc/apps/orchestrator/test/trusted-engineer-host.test.mjs",
    title:"strict LIVE Engineer Host joins authenticated Unix IPC with durable Gateway planning and operational fences"
  },
  {
    id:"scripted_offline_private_oidc_intake",
    path:"poc/packages/orchestrator-runtime/test/trusted-scripted-github-oidc-intake.test.ts",
    title:"loopback trusted admission independently validates OIDC and run, consumes replay, never authorizes Gemini"
  },
  {
    id:"runner_terminal_requires_dag_and_root_closure",
    path:"poc/apps/orchestrator/test/trusted-engineer-run-status.test.mjs",
    title:"R5 paid and scripted runner status requires selected run AND fully closed verified native authority"
  },
  {
    id:"cold_runner_never_waits_for_fake_planning",
    path:"poc/apps/orchestrator/test/trusted-engineer-run-status.test.mjs",
    title:"R5 cold Engineer host and canceled paid or scripted sessions NEVER strand GitHub worker"
  },
  {
    id:"engineer_review_freezes_during_both_handoffs",
    path:"poc/apps/orchestrator/test/trusted-engineer-host.test.mjs",
    title:"R5 Engineer approval and rejection freeze at the start of either one-shot handoff"
  },
  {
    id:"scripted_offline_same_engineer_mtls",
    path:"poc/apps/orchestrator/test/trusted-engineer-host.test.mjs",
    title:"same Engineer process isolates paid and offline OIDC HTTPS listeners and never promotes offline identity into authority"
  },
  {
    id:"scripted_offline_pinned_private_runner",
    path:"poc/packages/orchestrator-runtime/test/trusted-private-scripted-runner-oidc.test.ts",
    title:"private runner binds all local trust pins and emits only nonauthorization"
  },
  {
    id:"scripted_offline_oidc_no_billing",
    path:"poc/packages/orchestrator-runtime/test/trusted-scripted-github-admission.test.ts",
    title:"R5 signed offline GitHub OIDC and REST corroboration produce one-use HMAC receipt only"
  },
  {
    id:"scripted_offline_cross_profile_denial",
    path:"poc/packages/orchestrator-runtime/test/trusted-scripted-github-admission.test.ts",
    title:"R5 offline identity denies cross-profile consent, paid workflow, ref or extra inputs"
  },
  {
    id:"scripted_offline_signed_handoff",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 scripted_offline verified Engineer handoff starts three genuine A2A servers without Gemini"
  },
  {
    id:"scripted_offline_root_revocation",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 scripted_offline role-bind error revokes operational root before returning to owner"
  },
  {
    id:"scripted_admitted_engineer_root",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 admitted scripted OIDC + signed Engineer activates exactly one root and watches live GitHub run"
  },
  {
    id:"scripted_job_cancellation_revocation",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 canceled scripted GitHub run retires real operational root and all three A2A servers"
  },
  {
    id:"scripted_cancellation_before_first_dag_task",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 scripted signed DAG cannot start any Task when GitHub run is canceled after root activation"
  },
  {
    id:"scripted_missing_oidc_denies_root",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 missing offline OIDC receipt or canceled job cannot issue the operational root"
  },
  {
    id:"scripted_unsigned_engineer_retires_preliminary",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-review-gate.test.ts",
    title:"R5 consumed offline OIDC denies missing Engineer signature and retires preliminary root"
  },
  {
    id:"live_agent_card_roles",
    path:"poc/packages/orchestrator-runtime/test/trusted-a2a-startup-probe.test.ts",
    title:"R5 only genuine, distinct localhost delegated A2A HTTP Agent Cards are ready"
  },
  {
    id:"final_task_github_cancellation_denied",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-approved-dag.test.ts",
    title:"R5 GitHub cancellation during the LAST signed Task denies terminal success and still retires root"
  },
  {
    id:"final_task_github_freshness_confirmed",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-approved-dag.test.ts",
    title:"R5 final GitHub revalidation accepts a still-active job before root retirement"
  },
  {
    id:"private_engineer_actual_mtls_negative_status",
    path:"poc/scripts/test/r5-scripted-mtls-network-probe.test.mjs",
    title:"R5 REAL local mTLS HTTP negative probe accepts pinned host and client without granting authority"
  },
  {
    id:"scripted_runner_mtls_client_leaf",
    path:"poc/scripts/test/r5-scripted-runner-tls-preflight.test.mjs",
    title:"R5 protected private runner accepts valid clientAuth TLS config but never declares connected"
  },
  {
    id:"scripted_runner_client_tls_before_oidc",
    path:"poc/packages/orchestrator-runtime/test/trusted-private-scripted-runner-oidc.test.ts",
    title:"R5 private hold verifies protected client TLS BEFORE requesting OIDC"
  },
  {
    id:"scripted_runner_inline_install_check_before_oidc",
    path:"poc/packages/orchestrator-runtime/test/trusted-private-scripted-runner-oidc.test.ts",
    title:"scripted runner hold rejects unverified local source before OIDC"
  },
  {
    id:"scripted_host_preplanning_requires_absent_plan",
    path:"poc/scripts/test/r5-scripted-host-deployment-preflight.test.mjs",
    title:"R5 pre-Planning host preflight requires absent plan and real owner-protected settings"
  },
  {
    id:"scripted_zero_billing_planning_model",
    path:"poc/packages/orchestrator-runtime/test/trusted-r5-scripted-planning-model.test.ts",
    title:"R5 bounded no-provider ADK model produces original-snapshot scoped plan after genuine Gateway-shaped reads"
  },
  {
    id:"scripted_no_provider_model_cannot_be_subclassed",
    path:"poc/packages/orchestrator-runtime/test/trusted-r5-scripted-planning-model.test.ts",
    title:"R5 rejects paid-capable subclasses and method replacement after original model construction"
  },
  {
    id:"scripted_paid_model_refused",
    path:"poc/packages/orchestrator-runtime/test/trusted-r5-scripted-planning-model.test.ts",
    title:"R5 rejects fee-capable BaseLlm and altered snapshot/branch binding"
  },
  {
    id:"scripted_owner_host_pinned_tls_preflight",
    path:"poc/scripts/test/r5-scripted-host-deployment-preflight.test.mjs",
    title:"R5 valid pinned scripted Engineer deployment is configuration-only, never operational GO"
  },
  {
    id:"scripted_immutable_local_source_guard",
    path:"poc/scripts/test/r5-scripted-install-integrity.test.mjs",
    title:"R5 refuses unexpected installed SHA and dirty worktree"
  },
  {
    id:"scripted_default_workflow_registration_guard",
    path:"poc/scripts/test/r5-scripted-dispatch-registration.test.mjs",
    title:"R5 refuses missing default-branch manual workflow, without dispatching"
  },
  {
    id:"signed_dag_with_pr_and_acceptance",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-adk-dag.test.ts",
    title:"R5 approved full HTTP A2A workflow creates signed PR only AFTER Gateway-correlated Runner acceptance"
  },
  {
    id:"signed_dag_pr_denial",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-adk-dag.test.ts",
    title:"R5 signed PR is denied without independently accepted exact-SHA Runner output"
  },
  {
    id:"live_http_a2a_cancellation",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-adk-dag.test.ts",
    title:"R5 real HTTP A2A cancels after Backend without contacting Frontend/Test"
  }
]);

function fatal(message){
  process.stderr.write("R5 offline canonical gate: "+message+"\n");
  process.exitCode=1;
}
const env={...process.env};
// Invariant: even if CI or a local shell has billable credentials configured,
// no provider/model secret is made visible to ANY child process.
for(const k of Object.keys(env)){
  if(/(?:GEMINI|OPENAI|ANTHROPIC|GOOGLE)_.*(?:KEY|TOKEN|CREDENTIAL|SECRET)/i.test(k)||
     /^(?:GOOGLE_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|GOOGLE_APPLICATION_CREDENTIALS)$/i.test(k))
    delete env[k];
}
env.NO_PAID_PROVIDER_CALLS="1";

const git=spawnSync("git",["rev-parse","HEAD"],{
  cwd:root,encoding:"utf8",timeout:10_000,env
});
if(git.status!==0||!/^[a-f0-9]{40}$/u.test(git.stdout.trim())){
  fatal("exact repository SHA is unavailable; no R5 evidence generated");
}else{
  const sha=git.stdout.trim();
  const result={
    schema_version:1,
    status:"offline_contract_only_not_deployed_end_to_end",
    git_sha:sha,
    model_api_calls:0,
    actual_model_inference:false,
    real_runner_github_job:false,
    one_physical_host_full_e2e:false,
    suites:[]
  };
  for(const suite of SUITES){
    // --test-name-pattern is a REGULAR EXPRESSION, not a literal name.
    // Escape metacharacters (e.g. the '+' in 'OIDC + signed Engineer')
    // and anchor the exact test to avoid false passes from a sibling.
    const literal=suite.title.split("").map(char=>
      "*+?^${}()|.[]\\".includes(char)?"\\"+char:char
    ).join("");
    const child=spawnSync(process.execPath,[
      "--experimental-strip-types","--test",
      "--test-name-pattern=^"+literal+"$",
      suite.path
    ],{
      cwd:root,env,encoding:"utf8",timeout:180_000,
      maxBuffer:8*1024*1024
    });
    const log=(child.stdout??"")+"\n"+(child.stderr??"");
    const ran=log.split("\n").some(x=>
      /^ok \d+ - /u.test(x)&&x.includes(suite.title));
    const passed=child.status===0&&!child.error&&ran&&
      /^# fail 0\s*$/mu.test(log)&&
      !/^# pass 0\s*$/mu.test(log);
    result.suites.push({
      id:suite.id,passed,
      log_sha256:createHash("sha256").update(log).digest("hex"),
      ...(passed?{}:{error:child.error?.message??"offline test failed"})
    });
    process.stdout.write(
      (passed?"PASS ":"FAIL ")+suite.id+" @ "+sha.slice(0,8)+"\n");
    if(!passed){
      process.stderr.write(log.slice(-12000)+"\n");
      break;
    }
  }
  const passed=result.suites.length===SUITES.length&&
    result.suites.every(x=>x.passed);
  process.stdout.write("R5_OFFLINE_GATE_EVIDENCE "+
    JSON.stringify({...result,passed})+"\n");
  if(!passed)fatal("one or more required same-SHA contract checks failed");
}
