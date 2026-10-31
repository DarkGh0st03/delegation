/**
 * R137 — trusted owner drives the CURRENT signed repair DAG in dependency
 * order, one Task at a time. This is not an ADK tool, A2A route or MCP API.
 *
 * R133 verified the original root and admitted the second epoch.
 * R134/R135 issue a fresh scoped Child DC and send the protected A2A Task.
 * R136 asks the actual Gateway to confirm independently observed provider
 * effects before this controller can advance to a successor.
 *
 * A Test A2A Artifact, even with test_outcome=pass, does not prove a
 * Docker PASS or authorize a PR. Final acceptance requires separate
 * Gateway/Runner attestation on the exact SHA after all tasks.
 */
import type {ProtectedA2AClientPort} from "./a2a-workflow.ts";
import type {ChildIssuanceInput} from "./authority-client.ts";
import {dispatchTrustedAdmittedRepairA2A,
 confirmTrustedAdmittedRepairA2A} from "./trusted-admitted-repair-a2a.ts";
import {TrustedOperationalEpochIntake}
 from "./trusted-operational-epoch-intake.ts";
import {TrustedPlanIpcClient}
 from "../../../apps/gateway/src/trusted-plan-ipc.ts";
import type {TrustedExecutionCoordinator}
 from "./trusted-execution-coordinator.ts";
import {TrustedChildIssuanceJournal}
 from "./trusted-child-issuance-journal.mjs";

type Role="backend"|"frontend"|"test";
type Credential=Pick<ChildIssuanceInput,
 "credential_id"|"valid_from"|"validity_seconds"|"credential_status">;
const ROLES=new Set<string>(["backend","frontend","test"]);
const DIGEST=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const fail=(m:string):never=>{throw Error("R137 repair DAG NO-GO: "+m);};
// A second invocation must not recover an uncertain distributed issuance.
// The durable Gateway binding + issuance journal enforce this across process
// restarts. This additional local lock rejects reentrancy in the owner.
const ownerRuns=new WeakMap<object,Set<string>>();

export async function executeTrustedAdmittedRepairDag(config:Readonly<{
 sessionId:string;epoch:number;planDigest:string;
 coordinator:Pick<TrustedExecutionCoordinator,
  "phase"|"trustedOperationalAuthority">;
 intake:TrustedOperationalEpochIntake;
 gateway:TrustedPlanIpcClient;
 journal:TrustedChildIssuanceJournal;
 engineerDid:string;
 adapterBaseUrl:string;orchestratorToken:string;
 fetchFn?:typeof fetch;
 agentBaseUrls:Readonly<Record<Role,string>>;
 a2a:ProtectedA2AClientPort;
 /** R138: independent original GitHub run check; never a model port. */
 verifyLiveRun?:()=>Promise<void>;
 /** Local trusted owner supplies unique native child ID/status per task;
  * NO model or agent may supply or override these values. */
 credentialForTask:(task:Readonly<{id:string;role:Role;ordinal:number}>)
  =>Credential;
 /** R151.10: trusted original owner may bind the just-issued native
  * child to its already-running role Agent BEFORE protected A2A send.
  * No plan or authority is accepted from the role/model callback. */
 beforeProtectedSend?:(issued:Readonly<{
  task_id:string;role:Role;runtime_task_id:string;
  credential_id:string;epoch:number
 }>)=>Promise<void>;
 /** R151.10: progress only after the same Gateway independently confirms
  * signed VP/OPA and actual provider effects; owner can pin exact Gitea
  * SHA for a subsequent signed Test. No completion may be inferred from
  * the model or A2A result alone. */
 afterGatewayConfirmed?:(task:Readonly<{
  task_id:string;role:Role;runtime_task_id:string;
  credential_id:string;epoch:number
 }>)=>Promise<void>;
}>):Promise<Readonly<{
 status:"repair_dag_gateway_confirmed_not_final_runner_verified";
 session_id:string;epoch:number;plan_digest:string;
 tasks:ReadonlyArray<Readonly<{
  task_id:string;role:Role;runtime_task_id:string;
  credential_id:string;gateway_task_completed:true;
  docker_pass_verified:false;
 }>>;
 docker_pass_verified:false;pull_request_created:false;
}>>{
 if(!config||!ID.test(config.sessionId)||
    !Number.isSafeInteger(config.epoch)||config.epoch<2||config.epoch>3||
    !DIGEST.test(config.planDigest)||
    !(config.intake instanceof TrustedOperationalEpochIntake)||
    !(config.gateway instanceof TrustedPlanIpcClient)||
    !(config.journal instanceof TrustedChildIssuanceJournal)||
    !config.gateway.operationalLeaseConfigured()||
    !config.gateway.operationalSessionDurableConfigured()||
    config.coordinator?.phase!=="execution"||
    !config.a2a||typeof config.a2a.sendProtectedTask!=="function"||
    (config.verifyLiveRun!==undefined&&
     typeof config.verifyLiveRun!=="function")||
    typeof config.credentialForTask!=="function"||
    (config.beforeProtectedSend!==undefined&&
     typeof config.beforeProtectedSend!=="function")||
    (config.afterGatewayConfirmed!==undefined&&
     typeof config.afterGatewayConfirmed!=="function"))
   fail("live trusted owner and durable admitted remote epoch required");
 config.intake.assertSameCoordinator(config.coordinator);
 await config.verifyLiveRun?.();
 const originalRoot=config.coordinator.trustedOperationalAuthority();
 const history=await config.intake.verifiedEpochHistory();
 const last=history.at(-1);
 if(history.length!==config.epoch||!last||
    last.plan_digest!==config.planDigest||
    last.plan.session_id!==config.sessionId||
    last.root_credential_id!==originalRoot.credential_id)
  fail("current signed repair epoch or original root changed");
 const tasks=last.plan.tasks;
 if(tasks.length<1||tasks.length>16)
  fail("bounded signed repair DAG required");
 const byId=new Map<string,typeof tasks[number]>();
 for(const task of tasks){
  if(!ID.test(task.id)||!ROLES.has(task.agent_id)||
     byId.has(task.id)||!Array.isArray(task.depends_on)||
     task.depends_on.length>16||
     history.slice(0,-1).some(h=>
      h.plan.tasks.some(t=>t.id===task.id)))
   fail("signed repair Task ID or role invalid or reused");
  byId.set(task.id,task);
 }
 // Establish a deterministic topological order from the signed DAG,
 // never a model-proposed ordering. No tasks are skipped or parallelized.
 const queued=new Set<string>(),order:typeof tasks=[];
 while(order.length<tasks.length){
  const next=tasks.find(t=>!queued.has(t.id)&&
   t.depends_on.every(dep=>queued.has(dep)));
  if(!next)fail("cyclic or external dependency in signed repair DAG");
  if(next.depends_on.some(dep=>dep===next.id||!byId.has(dep)))
   fail("external or self-dependent repair Task");
  queued.add(next.id);order.push(next);
 }
 // Verify the owner can supply a separate credential for every Task
 // without issuing anything yet. The owner-side function is not exposed
 // to agent/model-provided inputs.
 const credentials=new Map<string,Credential>();
 const ids=new Set<string>();
 for(let i=0;i<order.length;i++){
  const task=order[i];
  const role=task.agent_id as Role;
  const credential=config.credentialForTask(Object.freeze({
   id:task.id,role,ordinal:i
  }));
  if(!credential||!ID.test(credential.credential_id)||
     credential.credential_id===originalRoot.credential_id||
     ids.has(credential.credential_id)||
     !Number.isSafeInteger(credential.validity_seconds)||
     credential.validity_seconds<=0||
     typeof credential.valid_from!=="string"||
     !credential.credential_status)
   fail("missing/duplicated or invalid trusted child allocation");
  ids.add(credential.credential_id);
  credentials.set(task.id,Object.freeze({...credential}));
 }
 const key=config.sessionId+":"+config.epoch+":"+config.planDigest;
 let active=ownerRuns.get(config.coordinator);
 if(!active){active=new Set();ownerRuns.set(config.coordinator,active);}
 if(active.has(key))fail("same owner cannot replay a repair DAG");
 active.add(key); // intentionally NOT released after uncertain external IO
 const rootPinned=originalRoot.plan_digest;
 const done=new Set<string>();
 const results:Array<Readonly<{
  task_id:string;role:Role;runtime_task_id:string;
  credential_id:string;gateway_task_completed:true;
  docker_pass_verified:false;
 }>>=[];
 for(const task of order){
  if(task.depends_on.some(dep=>!done.has(dep)))
   fail("predecessor not independently Gateway-completed");
  const live=config.coordinator.trustedOperationalAuthority();
  if(config.coordinator.phase!=="execution"||
     live.credential_id!==originalRoot.credential_id||
     live.plan_digest!==rootPinned)
   fail("original Rust root retired or replaced");
  const fresh=await config.intake.verifiedEpochHistory();
  if(fresh.length!==history.length||
     fresh.at(-1)?.plan_digest!==config.planDigest)
   fail("signed repair DAG changed during execution");
  // If the pinned GitHub job is lost, refuse new child issuance.
  await config.verifyLiveRun?.();
  const role=task.agent_id as Role;
  const dispatched=await dispatchTrustedAdmittedRepairA2A({
   sessionId:config.sessionId,epoch:config.epoch,
   planDigest:config.planDigest,taskId:task.id,role,
   coordinator:config.coordinator,intake:config.intake,
   gateway:config.gateway,journal:config.journal,
   engineerDid:config.engineerDid,
   adapterBaseUrl:config.adapterBaseUrl,
   orchestratorToken:config.orchestratorToken,
   ...(config.fetchFn?{fetchFn:config.fetchFn}:{}),
   credential:credentials.get(task.id)!,
   agentBaseUrls:config.agentBaseUrls,a2a:config.a2a,
   ...(config.beforeProtectedSend?{
    beforeProtectedSend:config.beforeProtectedSend
   }:{})
  });
  // A2A may have finished after an external cancellation.
  await config.verifyLiveRun?.();
  const confirmed=await confirmTrustedAdmittedRepairA2A({
   receipt:dispatched,gateway:config.gateway,intake:config.intake,
   coordinator:config.coordinator,sessionId:config.sessionId,
   planDigest:config.planDigest,epoch:config.epoch
  });
  if(confirmed.task_id!==task.id||
     confirmed.runtime_task_id!==dispatched.runtime_task_id||
     !confirmed.gateway_task_completed)
   fail("Gateway did not confirm exact signed predecessor");
  await config.verifyLiveRun?.();
  await config.afterGatewayConfirmed?.(Object.freeze({
   task_id:task.id,role,runtime_task_id:dispatched.runtime_task_id,
   credential_id:dispatched.credential_id,epoch:config.epoch
  }));
  // The trusted owner may have fetched exact SHA / Runner evidence; it
  // cannot override predecessor confirmation or mutate the signed DAG.
  if(config.coordinator.phase!=="execution"||
     config.coordinator.trustedOperationalAuthority().credential_id!==
       originalRoot.credential_id)
   fail("original Rust root retired during confirmed Task callback");
  done.add(task.id);
  results.push(Object.freeze({
   task_id:task.id,role,runtime_task_id:dispatched.runtime_task_id,
   credential_id:dispatched.credential_id,
   gateway_task_completed:true as const,
   docker_pass_verified:false as const
  }));
 }
 await config.verifyLiveRun?.();
 return Object.freeze({
  status:"repair_dag_gateway_confirmed_not_final_runner_verified" as const,
  session_id:config.sessionId,epoch:config.epoch,
  plan_digest:config.planDigest,tasks:Object.freeze(results),
  docker_pass_verified:false as const,pull_request_created:false as const
 });
}
