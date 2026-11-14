/**
 * R383.8 — privileged owner-only CREATE_FILE Prepare -> immutable intent ->
 * durable native Task flight. This is NOT a model FunctionTool, Gitea write,
 * Rust VP, OPA decision or Task completion. One Task, one request, one try.
 *
 * The agent's private IPC stage message contains ONLY runtimeTaskId and the
 * original Gateway request_id; HEAD/Task/Child/branch are owner-pinned here.
 * The credential is never supplied by an HTTP caller or model argument.
 */
import {InMemoryRequestStore} from "./prepare.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "./trusted-authority-only-admissions.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight}
 from "./trusted-authority-only-create-preflight.ts";
import {GiteaClient} from "./gitea-client.ts";
import {isProjectTestCreateGrant}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import type {TrustedEffectStagingPort}
 from "../../../packages/agent-runtime/src/gateway-tool-client.ts";
import {APPLICATION_ROLES} from "../../../packages/plan-contracts/src/agent-roles.mjs";

const SHA40=/^[a-f0-9]{40}$/u;
function deny(reason:string):never{
 throw Error("Authority-only native CREATE owner staging NO-GO: "+reason);
}
export class TrustedAuthorityOnlyCreateEffectStager implements TrustedEffectStagingPort{
 readonly stagedTool="create_file" as const;
 readonly #store:InMemoryRequestStore;
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #preflight:TrustedAuthorityOnlyGiteaCreatePreflight;
 readonly #runtimeTaskId:string;
 readonly #planTaskId:string;
 readonly #repository:string;
 readonly #branch:string;
 readonly #head:string;
 #attempted=false;
 constructor(opts:{
  store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  preflight:TrustedAuthorityOnlyGiteaCreatePreflight;
  giteaClient:GiteaClient;
  repository:string;
  branch:string;
  planTaskId:string;
  runtimeTaskId:string;
  expectedHeadSha:string;
 }){
  if(!opts||
     !(opts.store instanceof InMemoryRequestStore)||
     !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.preflight instanceof TrustedAuthorityOnlyGiteaCreatePreflight)||
     !(opts.giteaClient instanceof GiteaClient)||
     !TrustedAuthorityOnlyGiteaCreatePreflight.isNativeForOwner(
      opts.preflight,opts.admissions,opts.giteaClient,
      opts.repository,opts.branch)||
     typeof opts.planTaskId!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(opts.planTaskId)||
     typeof opts.runtimeTaskId!=="string"||
     !/^dispatch_[A-Za-z0-9_-]{22}$/u.test(opts.runtimeTaskId)||
     !SHA40.test(opts.expectedHeadSha))
   deny("original Gateway, owner Gitea preflight and pinned Task/HEAD required");
  this.#store=opts.store;
  this.#admissions=opts.admissions;
  this.#preflight=opts.preflight;
  this.#runtimeTaskId=opts.runtimeTaskId;
  this.#planTaskId=opts.planTaskId;
  this.#repository=opts.repository;
  this.#branch=opts.branch;
  this.#head=opts.expectedHeadSha;
 }
 static isNativeForOwner(value:unknown,
  admissions:TrustedAuthorityOnlyGatewayAdmissions,
  planTaskId:string,runtimeTaskId:string,
  repository:string,branch:string):
  value is TrustedAuthorityOnlyCreateEffectStager{
  return value instanceof TrustedAuthorityOnlyCreateEffectStager&&
   #admissions in value&&value.#admissions===admissions&&
   value.#planTaskId===planTaskId&&
   value.#runtimeTaskId===runtimeTaskId&&
   value.#repository===repository&&value.#branch===branch&&
   value.stagedTool==="create_file";
 }
 async stage(requestId:string):Promise<Readonly<{
  status:"create_owner_intent_and_task_flight_staged";
  task_id:string;runtime_task_id:string;
  gateway_execution_authorized:false;
  provider_write_authorized:false;
 }>>{
  if(this.#attempted)deny("create Task already attempted or outcome ambiguous");
  const record=this.#store.get(requestId);
  if(!record||
     record.request_id!==requestId||
     record.task_id!==this.#runtimeTaskId||
     record.authority_only_plan_task_id!==this.#planTaskId||
     record.request.tool!=="create_file"||
     !(APPLICATION_ROLES.includes(record.agent_role)||
       (record.agent_role==="test"&&
        isProjectTestCreateGrant([record.required_permission],
          this.#admissions.projectTestSourceProfile)))||
     record.consumed!==false||
     !Number.isSafeInteger(record.expires_at_ms)||
     record.expires_at_ms<=Date.now())
   deny("missing or changed original unconsumed CREATE Prepare/Task");
  // Burn the slot before any asynchronous provider GET or journal write.
  // Ambiguous preflight/flight reservations cannot be retried by the same
  // agent nor reconstructed by a different owner after an O_EXCL marker.
  this.#attempted=true;
  const staged=await this.#preflight.stageCreate(record,this.#head);
  if(staged.provider_write_authorized!==false||
     staged.intent.task_id!==this.#planTaskId||
     staged.intent.runtime_task_id!==this.#runtimeTaskId||
     staged.intent.expected_head_sha!==this.#head||
     staged.intent.request_id!==requestId)
   deny("original owner CREATE preflight did not pin immutable Task and HEAD");
  const flight=await this.#admissions.stageTrustedTaskFlight(record);
  if(flight.status!=="task_flight_reserved_no_provider_execution"||
     flight.task_id!==this.#planTaskId||
     flight.runtime_task_id!==this.#runtimeTaskId||
     flight.gateway_execution_authorized!==false)
   deny("native Child durable Task flight is not exactly reserved");
  return Object.freeze({
   status:"create_owner_intent_and_task_flight_staged",
   task_id:this.#planTaskId,runtime_task_id:this.#runtimeTaskId,
   gateway_execution_authorized:false,provider_write_authorized:false
  });
 }
}
