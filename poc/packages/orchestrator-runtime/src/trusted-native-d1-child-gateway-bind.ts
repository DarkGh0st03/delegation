/**
 * R342 — same-root D1 native Child DC + independent Gateway registration.
 * This binds the first R341 Task only. The issued Child cannot be used until
 * a later owner-controlled A2A Task and canonical Gateway Rust VP/OPA Execute.
 */
import {randomBytes,createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "./trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "./trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {AuthenticatedRunnerFailureObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-failure-evidence.ts";
import type {TrustedAuthorityOnlyRunnerIntent}
 from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {DurableNativeD1FirstTaskAdmissionJournal,
 admitFirstNativeD1RepairTask}
 from "./trusted-native-d1-first-task-admission.ts";
import {preflightNativeD1FailureCandidate}
 from "./trusted-native-runner-failure-d1-preflight.ts";

type Admission=Awaited<ReturnType<typeof admitFirstNativeD1RepairTask>>;
type Role="backend"|"frontend"|"test";
const hex64=/^[a-f0-9]{64}$/u;
function deny(s:string):never{throw Error("Native D1 Child/Gateway NO-GO: "+s);}
export async function enrollFirstNativeD1ChildAtGateway(input:{
 coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 childIssuer:TrustedAuthorityOnlyChildIssuer;
 gateway:TrustedAuthorityOnlyGatewayAdmissions;
 failureObserver:AuthenticatedRunnerFailureObserver;
 failedRunnerIntent:TrustedAuthorityOnlyRunnerIntent;
 journal:DurableNativeD1FirstTaskAdmissionJournal;
 admission:Admission;
 freshStatusEntry:Readonly<{
  statusListCredential:string;statusListIndex:string
 }>;
 nowMs?:()=>number;
}):Promise<Readonly<{
 status:"native_d1_child_enrolled_no_provider_effect";
 task_id:string;runtime_task_id:string;epoch:number;
 new_child_credential_id:string;
 original_root_credential_id:string;
 source_evidence_sha256:string;
 task_registered:true;gateway_task_bound:true;
 native_child_issued:true;gateway_child_enrolled:true;
 provider_executed:false;recovery_completed:false;
 gateway_execution_authorized:false;
}>>{
 if(!(input?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
    !(input.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
    !(input.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
    !(input.failureObserver instanceof AuthenticatedRunnerFailureObserver)||
    !(input.journal instanceof DurableNativeD1FirstTaskAdmissionJournal)||
    input.coordinator.phase!=="active"||
    (input.nowMs!==undefined&&typeof input.nowMs!=="function"))
   deny("original live native owner dependencies required");
 const a=input.admission,intent=input.failedRunnerIntent;
 if(!a||a.status!=="native_d1_task_registered_without_gateway_or_child"||
    a.task_registered!==true||a.gateway_registered!==false||
    a.child_credential_issued!==false||
    a.recovery_execution_authorized!==false||
    a.epoch!==intent.epoch+1||
    a.failed_test_task_id!==intent.task_id)
   deny("not the previously verified first D1 Task admission");
 let row:ReturnType<TrustedAuthorityOnlyExecutionCoordinator[
  "assertTrustedGatewayRegisteredTask"]>;
 try{
  row=input.coordinator.assertTrustedGatewayRegisteredTask(a.task_id);
 }catch{
  // A model/foreign Task ID is not a trusted Coordinator admission.
  // Do not allow an internal lookup error to escape this D1 boundary.
  deny("no exact registered D1 Task under original failed Runner");
 }
 const root=input.coordinator.assertTrustedGatewayAuthorityBinding();
 if(row.status!=="task_registered_preflight_only"||
    row.task_id!==a.task_id||row.epoch!==a.epoch||
    row.session_id!==root.session_id||
    row.root_credential_id!==root.root_credential_id||
    row.authority_digest!==root.authority_digest||
    !["backend","frontend","test"].includes(row.agent_id)||
    !Array.isArray(row.permissions)||row.permissions.length<1||
    row.execution_authorized!==false||
    row.child_credential_issued!==false||
    row.gateway_registered!==false||
    a.original_root_credential_id!==root.root_credential_id)
   deny("registered D1 Task no longer matches original Engineer authority");
 const permDigest=createHash("sha256")
  .update(JSON.stringify(row.permissions)).digest("hex");
 const source=await input.journal.assertReservedOriginal({
  original:intent,admitted:a,permissionDigest:permDigest
 });
 const checked=await preflightNativeD1FailureCandidate({
  coordinator:input.coordinator,childIssuer:input.childIssuer,
  gateway:input.gateway,failureObserver:input.failureObserver,
  failedRunnerIntent:intent,
  candidate:{role:row.agent_id as Role,permissions:row.permissions},
  nowMs:input.nowMs
 });
 if(!hex64.test(checked.source_evidence_sha256)||
    checked.source_evidence_sha256!==source.source_evidence_sha256||
    checked.candidate_permissions_sha256!==permDigest||
    checked.original_session_id!==root.session_id)
   deny("verified first D1 authority or original failed Runner proof changed");
 const oldChild=input.childIssuer.assertTrustedIssuedChild(
  intent.task_id,input.coordinator);
 const status=input.freshStatusEntry;
 if(!status||typeof status.statusListCredential!=="string"||
    !status.statusListCredential.startsWith("https://")||
    typeof status.statusListIndex!=="string"||
    !/^\d{1,12}$/u.test(status.statusListIndex)||
    (status.statusListCredential===oldChild.status_list_credential&&
     status.statusListIndex===oldChild.status_list_index))
   deny("new Child needs distinct trusted revocable status allocation");
 const now=(input.nowMs??Date.now)();
 const seconds=Math.min(900,Math.floor((Math.min(
  Date.parse(root.expires_at),Date.parse(root.root_expires_at)
 )-now-2000)/1000));
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(seconds)||
    seconds<1)
   deny("original root no longer has time for new Child issuance");
 // Native ADK/A2A owner and private binder require exactly 22 suffix chars.
 const runtimeTaskId="dispatch_"+randomBytes(11).toString("hex");
 // Gateway chooses its actual bound row from the SAME live Coordinator.
 // A denial here cannot proceed to Rust issuance.
 const bound=await input.gateway.bindTrustedTask(
  a.task_id,runtimeTaskId,row.agent_id as Role);
 if(bound.status!=="gateway_task_bound_preflight_only"||
    bound.task_id!==a.task_id||
    bound.runtime_task_id!==runtimeTaskId||
    bound.authority_digest!==root.authority_digest||
    bound.gateway_execution_authorized!==false)
   deny("Gateway did not bind the exact new native D1 Task");
 const issued=await input.childIssuer.issueForRegisteredTask(a.task_id,{
  credential_id:"urn:d1:child:"+randomBytes(12).toString("hex"),
  valid_from:new Date(now).toISOString().replace(/\.\d{3}Z$/u,"Z"),
  validity_seconds:seconds,
  credential_status:{
   type:"BitstringStatusListEntry",statusPurpose:"revocation",
   statusListCredential:status.statusListCredential,
   statusListIndex:status.statusListIndex
  }
 });
 if(issued.status!=="native_child_response_verified_staged"||
    issued.task_id!==a.task_id||issued.epoch!==a.epoch||
    issued.session_id!==root.session_id||
    issued.root_credential_id!==root.root_credential_id||
    issued.authority_digest!==root.authority_digest||
    issued.agent_id!==row.agent_id||
    issued.agent_did!==row.agent_did||
    !isDeepStrictEqual(issued.permissions,row.permissions)||
    issued.gateway_execution_authorized!==false||
    issued.credential_id===intent.credential_id)
   deny("native Rust Child response differs from original D1 grant");
 const enrolled=await input.gateway.enrollTrustedIssuedChild(
  a.task_id,runtimeTaskId,input.childIssuer);
 if(enrolled.status!=="gateway_child_enrolled_preflight_only"||
    enrolled.task_id!==a.task_id||
    enrolled.runtime_task_id!==runtimeTaskId||
    enrolled.credential_id!==issued.credential_id||
    enrolled.gateway_execution_authorized!==false)
   deny("Gateway Child enrollment differs from new native Rust Child");
 const current=input.coordinator.assertTrustedGatewayAuthorityBinding();
 if(current.root_credential_id!==root.root_credential_id||
    current.authority_digest!==root.authority_digest||
    current.session_id!==root.session_id)
   deny("original operational root changed during D1 Child enrollment");
 return Object.freeze({
  status:"native_d1_child_enrolled_no_provider_effect" as const,
  task_id:a.task_id,runtime_task_id:runtimeTaskId,epoch:a.epoch,
  new_child_credential_id:issued.credential_id,
  original_root_credential_id:root.root_credential_id,
  source_evidence_sha256:source.source_evidence_sha256,
  task_registered:true as const,gateway_task_bound:true as const,
  native_child_issued:true as const,gateway_child_enrolled:true as const,
  provider_executed:false as const,recovery_completed:false as const,
  gateway_execution_authorized:false as const
 });
}
