/**
 * R341 — first native D1 Task admission, under the ORIGINAL Engineer grant.
 *
 * This owner-only bridge consumes freshly reverified R338/R340 evidence and
 * reserves one admission per failed Test. Only the existing Coordinator may
 * register a new Task. No Child, Gateway effect, Docker retry or root issue.
 */
import {randomBytes,createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join,isAbsolute,resolve} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {TrustedAuthorityOnlyExecutionCoordinator,
 type AuthorityOnlyTaskProposal}
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
import {preflightNativeD1FailureCandidate}
 from "./trusted-native-runner-failure-d1-preflight.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA64=/^[a-f0-9]{64}$/u;
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const deny=(s:string):never=>{
 throw Error("Native D1 Task admission NO-GO: "+s);
};
type Candidate=Readonly<{
 role:"backend"|"frontend"|"test";
 permissions:readonly DelegatedPermission[];
}>;
type Admission=Readonly<{
 schema:"native-d1-first-task-admission-v1";
 session_id:string;
 authority_digest:string;
 original_root_credential_id:string;
 failed_test_task_id:string;
 failed_runner_request_id:string;
 failed_runner_request_fingerprint:string;
 verified_fail_evidence_sha256:string;
 candidate_permission_digest:string;
 recovery_task_id:string;
 recovery_epoch:number;
}>;
export class DurableNativeD1FirstTaskAdmissionJournal{
 readonly #dir:string;
 constructor(directory:string){
  if(typeof directory!=="string"||!isAbsolute(directory)||
     resolve(directory)!==directory||directory.length>512)
   deny("canonical owner-only absolute admission directory required");
  this.#dir=directory;
 }
 async reserve(v:Admission):Promise<void>{
  if(!v||Object.keys(v).sort().join(",")!==[
   "schema","session_id","authority_digest","original_root_credential_id",
   "failed_test_task_id","failed_runner_request_id",
   "failed_runner_request_fingerprint","verified_fail_evidence_sha256",
   "candidate_permission_digest","recovery_task_id","recovery_epoch"
  ].sort().join(",")||
   v.schema!=="native-d1-first-task-admission-v1"||
   ![v.session_id,v.original_root_credential_id,
     v.failed_test_task_id,v.failed_runner_request_id,
     v.recovery_task_id].every(x=>typeof x==="string"&&ID.test(x))||
   ![v.authority_digest,v.failed_runner_request_fingerprint,
     v.verified_fail_evidence_sha256,v.candidate_permission_digest]
    .every(x=>typeof x==="string"&&SHA64.test(x))||
   !Number.isSafeInteger(v.recovery_epoch)||v.recovery_epoch<2||
   v.recovery_epoch>256)
   deny("malformed immutable native D1 admission request");
  const dir=await lstat(this.#dir);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   deny("unsafe native D1 owner admission directory");
  const name=sha(v.session_id+"\n"+v.failed_test_task_id+"\n"+
   v.failed_runner_request_id)+".d1-first-task.json";
  // O_EXCL makes a crash, partial write or concurrent double-admission
  // terminal. No implicit retry or reuse of one failed-Runner proof.
  const fd=await open(join(this.#dir,name),constants.O_WRONLY|
   constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
   const stat=await fd.stat();
   if(!stat.isFile()||stat.nlink!==1||
      (stat.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&stat.uid!==process.getuid()))
    deny("unsafe native D1 admission record");
   await fd.writeFile(JSON.stringify(v)+"\n","utf8");
   await fd.sync();
  }finally{await fd.close();}
  const d=await open(this.#dir,constants.O_RDONLY|
   constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await d.sync();}finally{await d.close();}
 }
 /**
  * R342: reopen the one-shot source, never trust a serialized Task receipt.
  * The original file must remain private, exact and non-replaced.
  */
 async assertReservedOriginal(input:{
  original:TrustedAuthorityOnlyRunnerIntent;
  admitted:Readonly<{task_id:string;epoch:number;
   failed_test_task_id:string;source_evidence_sha256:string;
   original_root_credential_id:string}>;
  permissionDigest:string;
 }):Promise<Readonly<{
  original_session_id:string;root_credential_id:string;
  admitted_task_id:string;admitted_epoch:number;
  source_evidence_sha256:string
 }>>{
  const {original,admitted,permissionDigest}=input;
  DurableAuthorityOnlyRunnerIntentJournal.assertValid(original);
  if(!admitted||!SHA64.test(permissionDigest)||
     !ID.test(admitted.task_id)||!Number.isSafeInteger(admitted.epoch))
   deny("invalid immutable original D1 lookup");
  const dir=await lstat(this.#dir);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o777)!==0o700||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
   deny("unsafe original D1 journal");
  const name=sha(original.session_id+"\n"+original.task_id+"\n"+
   original.request_id)+".d1-first-task.json";
  const fd=await open(join(this.#dir,name),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw:unknown;
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
      (typeof process.getuid==="function"&&st.uid!==process.getuid())||
      st.size<200||st.size>4096)
    deny("unsafe original one-shot D1 admission entry");
   raw=JSON.parse(await fd.readFile("utf8")) as unknown;
  }finally{await fd.close();}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   deny("malformed original D1 admission entry");
  const record=raw as Record<string,unknown>;
  if(Object.keys(record).sort().join(",")!==[
   "schema","session_id","authority_digest","original_root_credential_id",
   "failed_test_task_id","failed_runner_request_id",
   "failed_runner_request_fingerprint","verified_fail_evidence_sha256",
   "candidate_permission_digest","recovery_task_id","recovery_epoch"
  ].sort().join(",")||
   record.schema!=="native-d1-first-task-admission-v1"||
   record.session_id!==original.session_id||
   record.authority_digest!==original.authority_digest||
   record.original_root_credential_id!==original.root_credential_id||
   record.failed_test_task_id!==original.task_id||
   record.failed_runner_request_id!==original.request_id||
   record.failed_runner_request_fingerprint!==original.request_fingerprint||
   record.verified_fail_evidence_sha256!==admitted.source_evidence_sha256||
   record.candidate_permission_digest!==permissionDigest||
   record.recovery_task_id!==admitted.task_id||
   record.recovery_epoch!==admitted.epoch||
   admitted.failed_test_task_id!==original.task_id||
   admitted.original_root_credential_id!==original.root_credential_id)
   deny("original failed Runner source or registered D1 Task changed");
  return Object.freeze({
   original_session_id:original.session_id,
   root_credential_id:original.root_credential_id,
   admitted_task_id:admitted.task_id,
   admitted_epoch:admitted.epoch,
   source_evidence_sha256:admitted.source_evidence_sha256
  });
 }
}
export async function admitFirstNativeD1RepairTask(input:{
 coordinator:TrustedAuthorityOnlyExecutionCoordinator;
 childIssuer:TrustedAuthorityOnlyChildIssuer;
 gateway:TrustedAuthorityOnlyGatewayAdmissions;
 failureObserver:AuthenticatedRunnerFailureObserver;
 failedRunnerIntent:TrustedAuthorityOnlyRunnerIntent;
 candidate:Candidate;
 journal:DurableNativeD1FirstTaskAdmissionJournal;
 nowMs?:()=>number;
}):Promise<Readonly<{
 status:"native_d1_task_registered_without_gateway_or_child";
 task_id:string;epoch:number;
 failed_test_task_id:string;
 source_evidence_sha256:string;
 original_root_credential_id:string;
 task_registered:true;
 gateway_registered:false;
 child_credential_issued:false;
 recovery_execution_authorized:false;
}>>{
 if(!(input?.journal instanceof DurableNativeD1FirstTaskAdmissionJournal)||
    !(input.coordinator instanceof TrustedAuthorityOnlyExecutionCoordinator)||
    !(input.gateway instanceof TrustedAuthorityOnlyGatewayAdmissions)||
    !(input.childIssuer instanceof TrustedAuthorityOnlyChildIssuer)||
    !(input.failureObserver instanceof AuthenticatedRunnerFailureObserver))
   deny("live owner-only D1 dependencies required");
 const intent=input.failedRunnerIntent;
 DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
 // Never accept an untrusted/model-authored preflight receipt. Re-run its
 // Rust-root, Gateway flight, HMAC FAIL and Gitea HEAD checks right here.
 const verified=await preflightNativeD1FailureCandidate({
  coordinator:input.coordinator,childIssuer:input.childIssuer,
  gateway:input.gateway,failureObserver:input.failureObserver,
  failedRunnerIntent:intent,candidate:input.candidate,nowMs:input.nowMs
 });
 if(verified.recovery_authorized!==false||
    verified.task_registered!==false||
    verified.child_credential_issued!==false||
    verified.failed_task_id!==intent.task_id)
  deny("noncanonical original Test FAIL preflight");
 const failedTask=input.coordinator.assertTrustedGatewayRegisteredTask(
  intent.task_id);
 const root=input.coordinator.assertTrustedGatewayAuthorityBinding();
 const epoch=input.coordinator.registeredTaskCount+1;
 if(failedTask.epoch!==intent.epoch||
    epoch!==intent.epoch+1||epoch>256||
    failedTask.agent_id!=="test"||
    failedTask.session_id!==root.session_id||
    root.session_id!==verified.original_session_id||
    root.root_credential_id!==intent.root_credential_id||
    root.authority_digest!==intent.authority_digest||
    !SHA64.test(root.requirement_sha256)||
    !Array.isArray(failedTask.depends_on)||
    failedTask.depends_on.includes(intent.task_id))
  deny("first D1 must directly follow the original Test epoch");
 const permissions=structuredClone(input.candidate.permissions);
 if(sha(JSON.stringify(permissions))!==verified.candidate_permissions_sha256||
    verified.candidate_role!==input.candidate.role)
  deny("candidate changed after independently verified preflight");
 const proposal:AuthorityOnlyTaskProposal={
  session_id:root.session_id,
  requirement_sha256:root.requirement_sha256,
  base_revision:root.base_revision,
  branch:root.branch,
  task_id:"d1-"+String(epoch)+"-"+randomBytes(10).toString("hex"),
  epoch,
  agent_id:input.candidate.role,
  // The failed Test must NOT be a dependency. Its previously completed
  // prerequisites remain valid; no model-supplied dependency list.
  depends_on:[...failedTask.depends_on],
  permissions
 };
 const current=input.coordinator.assertTrustedGatewayAuthorityBinding();
 if(current.authority_digest!==root.authority_digest||
    current.root_credential_id!==root.root_credential_id||
    !isDeepStrictEqual(current.root_permissions,root.root_permissions)||
    input.coordinator.registeredTaskCount+1!==epoch)
  deny("original Engineer authority changed before D1 reservation");
 // Reservation is intentionally BEFORE any Coordinator write. An ambiguous
 // registration consumes the source and requires explicit reconciliation.
 await input.journal.reserve({
  schema:"native-d1-first-task-admission-v1",
  session_id:root.session_id,
  authority_digest:root.authority_digest,
  original_root_credential_id:root.root_credential_id,
  failed_test_task_id:intent.task_id,
  failed_runner_request_id:intent.request_id,
  failed_runner_request_fingerprint:intent.request_fingerprint,
  verified_fail_evidence_sha256:verified.source_evidence_sha256,
  candidate_permission_digest:verified.candidate_permissions_sha256,
  recovery_task_id:proposal.task_id,recovery_epoch:proposal.epoch
 });
 const admitted=await input.coordinator.registerTask(proposal);
 if(admitted.status!=="task_registered_preflight_only"||
    admitted.task_id!==proposal.task_id||
    admitted.epoch!==epoch||admitted.agent_id!==proposal.agent_id||
    admitted.session_id!==root.session_id||
    admitted.root_credential_id!==root.root_credential_id||
    admitted.authority_digest!==root.authority_digest||
    !isDeepStrictEqual(admitted.permissions,permissions)||
    admitted.child_credential_issued!==false||
    admitted.gateway_registered!==false||
    admitted.execution_authorized!==false)
  deny("Coordinator admission did not match reserved one-shot D1 Task");
 return Object.freeze({
  status:"native_d1_task_registered_without_gateway_or_child" as const,
  task_id:admitted.task_id,epoch:admitted.epoch,
  failed_test_task_id:intent.task_id,
  source_evidence_sha256:verified.source_evidence_sha256,
  original_root_credential_id:root.root_credential_id,
  task_registered:true as const,gateway_registered:false as const,
  child_credential_issued:false as const,
  recovery_execution_authorized:false as const
 });
}
