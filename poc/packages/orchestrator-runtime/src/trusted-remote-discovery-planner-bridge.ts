/**
 * R151.45 — owner-only, one-use dynamic discovery -> repair-planner bridge.
 *
 * The original dispatcher does NOT know the random Gateway runtime Task ID
 * before dispatch. This bridge accepts a result returned by the trusted
 * post-FAIL discovery handoff, then INDEPENDENTLY rereads the Gateway's
 * own exact-SHA Gitea provider ledger. A callback receipt (including one
 * invented by a model or A2A peer) is never sufficient to start planning.
 * This yields source-free Task selectors, NOT new credentials, source
 * content, repair authority or permission to create a PR.
 */
import {TrustedPlanIpcClient} from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import {TrustedOperationalEpochIntake} from "./trusted-operational-epoch-intake.ts";
import {prepareTrustedRemoteRepairFeedback,
 type TrustedRepairFeedbackSignal} from "./trusted-validation-repair-feedback.ts";
import type {TrustedExecutionCoordinator} from "./trusted-execution-coordinator.ts";
import type {TrustedRemoteDiscoveryA2AHandoff} from
 "./trusted-remote-discovery-a2a-handoff.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const fail=(why:string):never=>{
 throw Error("Trusted dynamic discovery planning NO-GO: "+why);
};
type DiscoveryResult=Awaited<ReturnType<
 TrustedRemoteDiscoveryA2AHandoff["dispatchIssuedChild"]
>>;
type Owner=Pick<TrustedExecutionCoordinator,
 "phase"|"trustedOperationalAuthority">;

export async function completeTrustedRemoteDiscoveryForPlanning(config:{
 gateway:TrustedPlanIpcClient;
 intake:TrustedOperationalEpochIntake;coordinator:Owner;
 signal:Readonly<TrustedRepairFeedbackSignal>;
 dispatchRemoteDiscovery:()=>Promise<DiscoveryResult>;
}):Promise<Readonly<{
 task_id:string;runtime_task_id:string;resource:string;
}>>{
 if(!(config?.gateway instanceof TrustedPlanIpcClient)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    !config.gateway.operationalLeaseConfigured()||
    !config.gateway.operationalSessionDurableConfigured()||
    !config.coordinator||
    config.coordinator.phase!=="execution"||
    typeof config.coordinator.trustedOperationalAuthority!=="function"||
    typeof config.dispatchRemoteDiscovery!=="function")
  fail("durable original Gateway, live root and trusted owner callback required");
 config.intake.assertSameCoordinator(config.coordinator);
 const s=config.signal;
 if(!s||s.status!=="repair_planning_eligible"||
    s.provenance!=="gateway_verified_docker_runner"||
    s.authority_kind!=="existing_rust_operational_root"||
    s.execution_authorized!==false||s.permission_granted!==false||
    s.first_failed_phase!=="typecheck"||
    !Array.isArray(s.typecheck_error_codes)||
    s.typecheck_error_codes.length===0||
    !ID.test(s.session_id)||!ID.test(s.failed_runtime_task_id)||
    !/^[0-9a-f]{40}$/u.test(s.tested_commit_sha))
  fail("only a finalized source-eligible real Test FAIL can dispatch discovery");
 // Recheck the Test FAIL and cryptographic root independently BEFORE
 // invoking any source-read callback or model. Do not re-finalize Test.
 const before=await prepareTrustedRemoteRepairFeedback({
  gateway:config.gateway,intake:config.intake,
  coordinator:config.coordinator,
  sessionId:s.session_id,runtimeTestTaskId:s.failed_runtime_task_id,
  alreadyFinalized:true
 });
 if(JSON.stringify(before)!==JSON.stringify(s)||
    config.coordinator.phase!=="execution")
  fail("Gateway Test FAIL or original signed root changed before discovery");
 // The callback is a private owner adapter around the concrete
 // TrustedRemoteDiscoveryA2AHandoff.dispatchIssuedChild path. One use
 // is enforced by the owner and that handoff, not by the model.
 const received=await config.dispatchRemoteDiscovery();
 if(!received||typeof received!=="object"||
    Object.keys(received).sort().join(",")!==
      "branch,credential_id,gateway_provider_corroborated,pr_authorized,repair_dag_authorized,resource,runtime_task_id,session_id,status,task_id,verified_revision"||
    received.status!=="remote_discovery_gateway_provider_confirmed"||
    received.session_id!==s.session_id||
    !ID.test(received.task_id)||!ID.test(received.runtime_task_id)||
    !ID.test(received.credential_id)||
    received.branch!==s.work_branch||
    received.verified_revision!==s.tested_commit_sha||
    typeof received.resource!=="string"||
    received.resource.length>2048||
    received.gateway_provider_corroborated!==true||
    received.repair_dag_authorized!==false||
    received.pr_authorized!==false)
  fail("Backend A2A discovery result has wrong immutable Test identity");
 // Model/A2A/owner response cannot forge an actual Gitea read: the
 // remote Gateway checks its own DONE binding, exact requested file,
 // native-verified Child credential and a singular provider effect.
 const ledger=await config.gateway.readConfirmedRemoteDiscoveryEffect({
  session_id:s.session_id,root_plan_digest:s.root_plan_digest,
  plan_digest:s.failed_plan_digest,epoch:s.failed_epoch,
  task_id:received.task_id,runtime_task_id:received.runtime_task_id,
  runtime_test_task_id:s.failed_runtime_task_id,
  resource:received.resource,tested_commit_sha:s.tested_commit_sha
 });
 if(ledger.credential_id!==received.credential_id||
    ledger.branch!==s.work_branch||
    ledger.revision!==s.tested_commit_sha||
    ledger.gateway_provider_corroborated!==true||
    ledger.source_disclosed!==false||
    ledger.repair_dag_authorized!==false||
    ledger.pr_authorized!==false)
  fail("trusted Gateway cannot independently corroborate A2A discovery read");
 // Test FAIL, root and durable epoch must still be identical after the
 // network/A2A work before the repair model is even considered.
 const after=await prepareTrustedRemoteRepairFeedback({
  gateway:config.gateway,intake:config.intake,
  coordinator:config.coordinator,
  sessionId:s.session_id,runtimeTestTaskId:s.failed_runtime_task_id,
  alreadyFinalized:true
 });
 if(JSON.stringify(after)!==JSON.stringify(before)||
    config.coordinator.phase!=="execution")
  fail("original Test FAIL or root changed after remote discovery");
 return Object.freeze({
  task_id:received.task_id,runtime_task_id:received.runtime_task_id,
  resource:received.resource
 });
}
