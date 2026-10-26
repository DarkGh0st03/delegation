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
    id:"r5_final_check_before_native_root_revocation",
    path:"poc/packages/orchestrator-runtime/test/trusted-approved-a2a-dispatcher.test.ts",
    title:"R5 final job check runs after ALL signed Tasks but BEFORE verified Gateway/Rust root close"
  },
  {
    id:"r5_final_cancellation_retires_native_root",
    path:"poc/packages/orchestrator-runtime/test/trusted-approved-a2a-dispatcher.test.ts",
    title:"R5 rejected final GitHub job check still closes root and never reports successful DAG"
  },
  {
    id:"r5_success_requires_verified_native_closure",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-approved-dag.test.ts",
    title:"R5 cannot accept a successful Task reply if native root closure was skipped"
  },
  {
    id:"r5_job_cancellation_during_revocation_denied",
    path:"poc/packages/orchestrator-runtime/test/trusted-reviewed-approved-dag.test.ts",
    title:"R5 GitHub cancellation during durable root retirement denies success"
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
    id:"r5_original_gateway_to_backend_signed_checkpoint",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-gateway-port.test.ts",
    title:"R5 zero-provider Planning issues original read-only root, performs two Gateway VP/OPA Gitea reads and persists signed human-review checkpoint"
  },
  {
    id:"r5_gateway_denial_never_materializes_review",
    path:"poc/packages/orchestrator-runtime/test/trusted-planning-gateway-port.test.ts",
    title:"R5 denied second Gateway Planning read never stages a partial signed Engineer plan"
  },
  {
    id:"r5_independent_human_backend_signers",
    path:"poc/apps/orchestrator/test/trusted-r5-scripted-owner-assembly.test.mjs",
    title:"R5 forbids using the Engineer signing identity as the Backend checkpoint key"
  },
  {
    id:"r5_genuine_ed25519_review_before_oidc",
    path:"poc/apps/orchestrator/test/trusted-r5-scripted-review-readiness.test.mjs",
    title:"R5 review readiness verifies a REAL Ed25519 receipt against pinned Engineer public key"
  },
  {
    id:"r5_signed_human_approval_precedes_one_use_oidc",
    path:"poc/apps/orchestrator/test/run-trusted-r5-scripted-owner.test.mjs",
    title:"R5 owner verifies real Engineer approval BEFORE consuming scripted GitHub OIDC admission"
  },
  {
    id:"r5_protected_owner_execution_transport_binding",
    path:"poc/apps/orchestrator/test/run-trusted-r5-scripted-owner.test.mjs",
    title:"R5 owner binds approved GitHub run exclusively to original protected Gateway and Adapter"
  },
  {
    id:"r5_reject_untrusted_owner_execution_overrides",
    path:"poc/apps/orchestrator/test/run-trusted-r5-scripted-owner.test.mjs",
    title:"R5 owner rejects arbitrary execution transport, fee-capable config or mismatched protected origin"
  },
  {
    id:"r5_private_foreground_owner_input",
    path:"poc/apps/orchestrator/test/run-trusted-r5-scripted-owner.test.mjs",
    title:"R5 protected owner loads exact original signed Planning input from 0600, without exposing signer path"
  },
  {
    id:"r5_owner_cli_no_github_runner_execution",
    path:"poc/apps/orchestrator/test/run-trusted-r5-scripted-owner.test.mjs",
    title:"R5 privileged owner refuses GitHub Actions and missing source SHA before any root"
  },
  {
    id:"r5_real_owner_gateway_ipc_planning_assembly",
    path:"poc/apps/orchestrator/test/trusted-r5-scripted-owner-assembly.test.mjs",
    title:"R5 original owner assembles SAME Coordinator with real durable Gateway IPC, no Planning root or approval"
  },
  {
    id:"r5_owner_rejects_undurable_gateway",
    path:"poc/apps/orchestrator/test/trusted-r5-scripted-owner-assembly.test.mjs",
    title:"R5 owner assembly rejects non-durable actual Gateway capabilities"
  },
  {
    id:"r5_real_private_planning_registration",
    path:"poc/apps/gateway/test/trusted-plan-ipc.test.ts",
    title:"R5 private IPC pins real Gitea Planning SHA and awaits durable remote retirement"
  },
  {
    id:"r5_async_gateway_retirement_before_rust_revoke",
    path:"poc/packages/orchestrator-runtime/test/trusted-r5-remote-planning-retirement.test.ts",
    title:"R5 async Gateway Planning retirement must be confirmed before native root revocation"
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
    id:"r5_verified_closure_only_after_exact_dag",
    path:"poc/apps/orchestrator/test/trusted-r5-scripted-completion-evidence.test.mjs",
    title:"R5 post-run evidence is only available after exact original signed DAG and CLOSED Coordinator"
  },
  {
    id:"r5_atomic_no_overwrite_owner_receipt",
    path:"poc/apps/orchestrator/test/trusted-r5-scripted-completion-evidence.test.mjs",
    title:"R5 local owner receipt is exclusive, 0600, no secrets and cannot overwrite same run"
  },
  {
    id:"r5_one_file_default_workflow_registration_pr_review",
    path:"poc/scripts/test/r5-scripted-registration-pr-audit.test.mjs",
    title:"R5 one-file draft registration PR audit verifies exact blob/base/source without merge, token or dispatch"
  },
  {
    id:"r5_registration_review_denies_unreviewed_changes",
    path:"poc/scripts/test/r5-scripted-registration-pr-audit.test.mjs",
    title:"R5 registration review denies any unexpected diff, base/head change, merge, or default-branch file"
  },
  {
    id:"r5_private_operator_reviewed_environment_and_runner",
    path:"poc/scripts/test/r5-private-github-readiness.test.mjs",
    title:"R5 confirms exactly one idle private runner, independent Engineer reviewer and same-SHA registered workflow without dispatch"
  },
  {
    id:"r5_private_environment_review_bypass_denied",
    path:"poc/scripts/test/r5-private-github-readiness.test.mjs",
    title:"R5 refuses absent reviewer protection, bypassable owner or unsafe deployment branch restrictions"
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
