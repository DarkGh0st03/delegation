/**
 * R339: only a trusted owner can PREFLIGHT a possible D1 task after a
 * durable, independently verified native Runner FAIL. This is not a
 * recovery admission, a new child grant or a successful Test Task.
 */
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {canonicalBranchUri,canonicalFileUri}
 from "../../../apps/gateway/src/canonical.ts";
import {giteaPermissionCovers}
 from "../../plan-contracts/src/gitea-permission-containment.mjs";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "./trusted-authority-only-execution-coordinator.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "./trusted-authority-only-child-issuer.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {AuthenticatedRunnerFailureObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-failure-evidence.ts";
import {DurableAuthorityOnlyRunnerIntentJournal,
 type TrustedAuthorityOnlyRunnerIntent}
 from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

type Role="backend"|"frontend"|"test";
const SHA64=/^[a-f0-9]{64}$/u;
const actionable=new Set(["typecheck","backend_tests","frontend_tests",
 "build","playwright_e2e","researcher_acceptance"]);
const keys=["session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint"] as const;
function deny(s:string):never{throw Error("Native D1 failure preflight NO-GO: "+s);}
type NativeFailedTestSource={
 coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 childIssuer:TrustedAuthorityOnlyChildIssuer;
 gateway:TrustedAuthorityOnlyGatewayAdmissions;
 failureObserver:AuthenticatedRunnerFailureObserver;
 failedRunnerIntent:TrustedAuthorityOnlyRunnerIntent;
 nowMs?:()=>number;
};
type NativeVerifiedFailedTest=Readonly<{
 status:"native_test_failure_evidence_verified_only";
 failed_task_id:string;failed_runtime_task_id:string;
 original_session_id:string;tested_commit_sha:string;
 failed_phase:string;source_evidence_sha256:string;
 typecheck_error_codes?:readonly string[];
 acceptance_failure?:import("../../../apps/gateway/src/runner-client.ts").RunnerClientResult["acceptance_failure"];
 recovery_authorized:false;child_credential_issued:false;
 gateway_task_completed:false;task_registered:false;
}>;
/** R355.3: independently observe a native Test FAIL WITHOUT preselecting
 * a correction role or permissions. No Task/DC is admitted or completed.
 * A2A/provider errors alone do not qualify as authenticated evidence. */
export async function observeTrustedNativeTestFailure(
 input:NativeFailedTestSource
):Promise<NativeVerifiedFailedTest>{
 if(!(input?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
    !(input.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
    !(input.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
    !(input.failureObserver instanceof AuthenticatedRunnerFailureObserver)||
    input.coordinator.phase!=="active"||
    (input.nowMs!==undefined&&typeof input.nowMs!=="function"))
   deny("original live Engineer, Child and owner-only FAIL observer required");
 const intent=input.failedRunnerIntent;
 DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
 const root=input.coordinator.assertTrustedGatewayAuthorityBinding();
 const row=input.coordinator.assertTrustedGatewayRegisteredTask(intent.task_id);
 const child=input.childIssuer.assertTrustedIssuedChild(
  intent.task_id,input.coordinator);
 const now=(input.nowMs??Date.now)();
 const branchUri=canonicalBranchUri(root.repository,root.branch);
 if(!Number.isSafeInteger(now)||
    now>=Date.parse(root.expires_at)||now>=Date.parse(root.root_expires_at)||
    root.session_id!==intent.session_id||
    root.root_credential_id!==intent.root_credential_id||
    root.authority_digest!==intent.authority_digest||
    root.branch!==intent.branch||
    row.status!=="task_registered_preflight_only"||
    row.task_id!==intent.task_id||
    row.epoch!==intent.epoch||row.agent_id!=="test"||
    row.agent_did!==intent.agent_did||
    row.authority_digest!==root.authority_digest||
    row.root_credential_id!==root.root_credential_id||
    !row.permissions.some(p=>p.operation==="run_tests"&&p.resource===branchUri)||
    child.status!=="native_child_response_verified_staged"||
    child.credential_id!==intent.credential_id||
    child.root_credential_id!==root.root_credential_id||
    child.task_id!==intent.task_id||child.epoch!==intent.epoch||
    child.agent_id!=="test"||child.agent_did!==intent.agent_did||
    child.authority_digest!==root.authority_digest||
    !isDeepStrictEqual(child.permissions,row.permissions))
   deny("failed Test/Child not bound to original signed Engineer root");
 // The Gateway must independently re-read its ORIGINAL reserved flight.
 // An A2A or caller-supplied Test ID cannot manufacture this evidence.
 const nativeFlight=input.gateway.assertTrustedFailedRunnerFlight(
  intent.task_id,intent.runtime_task_id);
 if(nativeFlight.status!=="gateway_original_test_flight_preflight_only"||
    nativeFlight.gateway_task_completed!==false||
    nativeFlight.gateway_execution_authorized!==false||
    nativeFlight.recovery_authorized!==false||
    keys.some(k=>nativeFlight[k]!==intent[k]))
  deny("Runner FAIL does not match original Gateway Test flight");
 const expected=Object.fromEntries(keys.map(k=>[k,nativeFlight[k]]));
 // R336/R337 observer: original one-shot POST, authenticated FAIL
 // receipt, current exact Gitea HEAD. A2A/model text is not evidence.
 const fail=await input.failureObserver.observe(intent,expected as never);
 if(fail.status!=="owner_authenticated_runner_failure_observed_staged"||
    keys.some(k=>fail[k]!==intent[k])||
    fail.tested_commit_sha!==intent.expected_head_sha||
    !SHA64.test(fail.evidence_sha256)||
    !actionable.has(fail.first_failed_phase)||
    fail.repair_candidate!==true||
    fail.recovery_authorized!==false||
    fail.gateway_task_completed!==false)
   deny("original Runner FAIL is not independently actionable");
 const lastFlight=input.gateway.assertTrustedFailedRunnerFlight(
  intent.task_id,intent.runtime_task_id);
 if(!isDeepStrictEqual(lastFlight,nativeFlight))
  deny("Gateway Test flight changed during independent FAIL observation");
 const live=input.coordinator.assertTrustedGatewayAuthorityBinding();
 const liveChild=input.childIssuer.assertTrustedIssuedChild(
  intent.task_id,input.coordinator);
 if(input.coordinator.phase!=="active"||
    live.session_id!==root.session_id||
    live.root_credential_id!==root.root_credential_id||
    live.authority_digest!==root.authority_digest||
    !isDeepStrictEqual(live.root_permissions,root.root_permissions)||
    liveChild.credential_id!==child.credential_id||
    (input.nowMs??Date.now)()>=Date.parse(live.expires_at)||
    (input.nowMs??Date.now)()>=Date.parse(live.root_expires_at))
   deny("original authority changed while reading independent FAIL");
 return Object.freeze({
  status:"native_test_failure_evidence_verified_only" as const,
  failed_task_id:intent.task_id,failed_runtime_task_id:intent.runtime_task_id,
  original_session_id:root.session_id,
  tested_commit_sha:fail.tested_commit_sha,
  failed_phase:fail.first_failed_phase,
  source_evidence_sha256:fail.evidence_sha256,
  ...(fail.typecheck_error_codes?.length?
   {typecheck_error_codes:Object.freeze([...fail.typecheck_error_codes])}:{}),
  ...(fail.acceptance_failure?{acceptance_failure:fail.acceptance_failure}:{}),
  recovery_authorized:false as const,
  child_credential_issued:false as const,
  gateway_task_completed:false as const,
  task_registered:false as const
 });
}
/** Original D1 admission path remains candidate-scoped and fail-closed.
 * Its candidate does NOT influence the independent FAIL observation. */
export async function preflightNativeD1FailureCandidate(input:
 NativeFailedTestSource & {
  candidate:{role:Role;permissions:readonly DelegatedPermission[]};
 }):Promise<Readonly<Omit<NativeVerifiedFailedTest,"status"> & {
  status:"native_d1_failure_source_preflight_only";
  candidate_role:Role;candidate_permissions_sha256:string;
 }>>{
 if(!(input?.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator))
  deny("original live Engineer required");
 const root=input.coordinator.assertTrustedGatewayAuthorityBinding();
 const branchUri=canonicalBranchUri(root.repository,root.branch);
 const proposed=input.candidate;
 if(!proposed||!["backend","frontend","test"].includes(proposed.role)||
    !Array.isArray(proposed.permissions)||proposed.permissions.length<1||
    proposed.permissions.length>32)
  deny("bounded, trusted owner-selected D1 candidate required");
 let effects=0;
 const seen=new Set<string>();
 for(const permission of proposed.permissions){
  if(!permission||Object.keys(permission).sort().join(",")!=="operation,resource"||
     typeof permission.resource!=="string"||
     typeof permission.operation!=="string")
   deny("malformed permission pair");
  const key=JSON.stringify([permission.resource,permission.operation]);
  if(seen.has(key)||!root.root_permissions.some(parent=>
     giteaPermissionCovers(parent,permission)))
   deny("proposed D1 permission exceeds original Engineer ceiling");
  seen.add(key);
  if(permission.operation==="run_tests"){
   if(proposed.role!=="test"||permission.resource!==branchUri)
    deny("branch Runner effect must be a signed Test Task");
   effects++;continue;
  }
  if(!["read_file","update_file"].includes(permission.operation)||
     proposed.role==="test")
   deny("unsupported D1 operation for specialized role");
  const prefix=branchUri+"/files/";
  if(!permission.resource.startsWith(prefix))
   deny("noncanonical file permission branch");
  let file:string;
  try{file=permission.resource.slice(prefix.length).split("/")
    .map(decodeURIComponent).join("/");}
  catch{deny("invalid encoded file scope");}
  if(!file||file.startsWith("/")||file.includes("\\")||file.includes("%")||
     file.split("/").some(s=>!s||s==="."||s==="..")||
     canonicalFileUri(root.repository,root.branch,file)!==permission.resource)
   deny("noncanonical D1 path");
  if(permission.operation==="update_file")effects++;
 }
 if(effects!==1)deny("exactly one approved side effect per candidate Task");
 const observed=await observeTrustedNativeTestFailure(input);
 return Object.freeze({
  ...observed,
  status:"native_d1_failure_source_preflight_only" as const,
  candidate_role:proposed.role,
  candidate_permissions_sha256:createHash("sha256")
   .update(JSON.stringify(proposed.permissions)).digest("hex")
 });
}
