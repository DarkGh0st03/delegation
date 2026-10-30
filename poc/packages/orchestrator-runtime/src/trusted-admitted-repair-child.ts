/**
 * R134 owner-only bridge: use R133's ACTUALLY admitted remote Gateway
 * epoch to bind one NEW runtime Task, then ask the existing Rust child
 * issuer for a fresh attenuated credential from the original live root.
 *
 * Not a model/A2A/MCP API. No proof of provider execution, no A2A send.
 * A failed bind cannot issue. An uncertain issuance leaves a journalled
 * intent and an unusable-but-bound Task: NEVER retry automatically.
 */
import {TrustedOperationalEpochIntake}
 from "./trusted-operational-epoch-intake.ts";
import {TrustedApprovedPlanChildAuthorityIssuer}
 from "./trusted-approved-child-issuer.ts";
import {TrustedChildIssuanceJournal}
 from "./trusted-child-issuance-journal.mjs";
import {TrustedPlanIpcClient}
 from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {TrustedExecutionCoordinator}
 from "./trusted-execution-coordinator.ts";
import type {ChildIssuanceInput,IssuedDelegationCredential}
 from "./authority-client.ts";

type Role="backend"|"frontend"|"test";
const ROLES=new Set<string>(["backend","frontend","test"]);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const fail=(reason:string):never=>{throw Error("R134 repair child NO-GO: "+reason);};

export async function issueAdmittedRepairTaskChild(config:{
 sessionId:string;
 epoch:number;
 planDigest:string;
 taskId:string;
 role:Role;
 runtimeTaskId:string;
 coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">;
 intake:TrustedOperationalEpochIntake;
 gateway:TrustedPlanIpcClient;
 journal:TrustedChildIssuanceJournal;
 engineerDid:string;
 adapterBaseUrl:string;
 orchestratorToken:string;
 credential:Pick<ChildIssuanceInput,
  "credential_id"|"valid_from"|"validity_seconds"|"credential_status">;
 fetchFn?:typeof fetch;
}):Promise<Readonly<{
 status:"repair_child_issued_not_dispatched";
 session_id:string;epoch:number;plan_digest:string;task_id:string;
 runtime_task_id:string;role:Role;credential_id:string;
 credential:IssuedDelegationCredential;
 gateway_task_bound:true;child_credential_issued:true;
 a2a_dispatched:false;provider_executed:false;
}>>{
 if(!config||!ID.test(config.sessionId)||
    !ID.test(config.taskId)||!ID.test(config.runtimeTaskId)||
    !Number.isSafeInteger(config.epoch)||config.epoch<2||config.epoch>3||
    !DIGEST.test(config.planDigest)||!ROLES.has(config.role)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    !(config.gateway instanceof TrustedPlanIpcClient)||
    !(config.journal instanceof TrustedChildIssuanceJournal)||
    !config.gateway.operationalLeaseConfigured()||
    !config.gateway.operationalSessionDurableConfigured()||
    config.coordinator?.phase!=="execution"||
    typeof config.coordinator.trustedOperationalAuthority!=="function"||
    !config.engineerDid?.startsWith("did:")||
    !config.adapterBaseUrl||!config.orchestratorToken)
  fail("active owner, durable Gateway IPC and pinned repair Task required");
 config.intake.assertSameCoordinator(config.coordinator);
 const history=await config.intake.verifiedEpochHistory();
 const current=history.at(-1);
 if(history.length!==config.epoch||!current||
    current.plan_digest!==config.planDigest||
    current.plan.session_id!==config.sessionId||
    history.slice(0,-1).some(e=>e.plan.tasks.some(
      (t:{id:string})=>t.id===config.taskId)))
  fail("new Task must belong to exact latest signed repair epoch");
 const task=current.plan.tasks.find(
  (t:{id:string})=>t.id===config.taskId);
 if(!task||task.agent_id!==config.role||
    !current.plan.requested_permissions.some(
     (p:{task_id:string;agent_id:string})=>
      p.task_id===config.taskId&&p.agent_id===config.role))
  fail("Task role or grants not found in pinned repair DAG");
 const root=config.coordinator.trustedOperationalAuthority();
 if(root.credential_id===config.credential?.credential_id||
    !ID.test(config.credential?.credential_id)||
    root.plan_digest!==history[0].plan_digest||
    current.root_credential_id!==root.credential_id)
  fail("new child identifier or original Rust root mismatched");
 // Reuse the original strict Rust attenuation/expiry/status path and
 // the existing fsynced R5 child issuance-intent ledger. No parallel
 // credential format, permission authority or additional issuer.
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer
  .createForOperationalEpoch({
   coordinator:config.coordinator,intake:config.intake,
   issuanceJournal:config.journal,epochVersion:config.epoch,
   sessionId:config.sessionId,engineerDid:config.engineerDid,
   adapterBaseUrl:config.adapterBaseUrl,
   bearerToken:config.orchestratorToken,
   ...(config.fetchFn?{fetchFn:config.fetchFn}:{})
  });
 // R133 is the gate: no admitted plan, no Gateway bind, no Child DC.
 // A failed/broken ACK leaves the Task unusable rather than issuing
 // under a model-asserted or merely journalled (unadmitted) epoch.
 await config.gateway.bindTask(
  config.sessionId,config.taskId,config.runtimeTaskId,config.role
 );
 // Never retry a bind/issuance pair after an uncertain network result.
 const issued=await issuer.issueSpecializedChild({
  parent_credential_id:root.credential_id,
  credential_id:config.credential.credential_id,
  valid_from:config.credential.valid_from,
  validity_seconds:config.credential.validity_seconds,
  credential_status:config.credential.credential_status,
  selection:{role:config.role},
  approved_task_id:config.taskId
 });
 issuer.assertActiveBeforeA2ASend();
 const final=await config.intake.verifiedEpochHistory();
 if(final.length!==history.length||
    final.at(-1)?.plan_digest!==current.plan_digest||
    config.coordinator.phase!=="execution")
  fail("root or epoch changed after issuing child; dispatch forbidden");
 return Object.freeze({
  status:"repair_child_issued_not_dispatched" as const,
  session_id:config.sessionId,epoch:config.epoch,
  plan_digest:config.planDigest,task_id:config.taskId,
  runtime_task_id:config.runtimeTaskId,role:config.role,
  credential_id:issued.credential.id,credential:issued.credential,
  gateway_task_bound:true as const,
  child_credential_issued:true as const,
  a2a_dispatched:false as const,provider_executed:false as const
 });
}
