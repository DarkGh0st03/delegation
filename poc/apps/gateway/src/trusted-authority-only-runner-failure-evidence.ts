/**
 * R336 — durable MAC-protected, native owner Runner FAIL observation.
 * Failure is evidence for *preflight only*, never Gateway completion,
 * D1 authorization, an additional Child, or a successful Test Task.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,resolve,join} from "node:path";
import {safeAcceptanceFailureSummary} from "../../../runner/acceptance/failure-catalog.mjs";
import {GiteaClient} from "./gitea-client.ts";
import {sanitizeVitestFailureFiles} from "../../test-runner-controller/src/vitest-failure-files.ts";
import {sanitizeTypecheckErrorCodes}
 from "../../test-runner-controller/src/typecheck-diagnostics.ts";
import {RunnerClient,type RunnerClientRequest,type RunnerClientResult}
 from "./runner-client.ts";
import {validateTrustedRunnerFailure}
 from "./trusted-authority-only-runner-failure.ts";
import {DurableAuthorityOnlyRunnerIntentJournal,
 type TrustedAuthorityOnlyRunnerIntent}
 from "./trusted-authority-only-runner-intent-journal.ts";
import type {TrustedCompletionExpectation}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA40=/^[a-f0-9]{40}$/u,SHA64=/^[a-f0-9]{64}$/u;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOG=/^runner-log:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const BINDING=[
 "session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id",
 "request_id","request_fingerprint"
] as const;
const FIELDS=[
 "schema","kind",...BINDING,"repository","branch","tested_commit_sha",
 "first_failed_phase","repair_candidate","runner_profile","log_reference",
 "policy_version","completed_at_ms","verification","mac_sha256"
].sort().join(",");
function fail(reason:string):never{
 throw Error("Authority-only Runner FAIL evidence NO-GO: "+reason);
}
function canonical(v:unknown):string{
 if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
 if(v!==null&&typeof v==="object"){
  const o=v as Record<string,unknown>;
  return "{"+Object.keys(o).sort().map(k=>
   JSON.stringify(k)+":"+canonical(o[k])).join(",")+"}";
 }
 return JSON.stringify(v);
}
const digest=(v:string)=>createHash("sha256").update(v).digest("hex");
interface FailReceipt{
 readonly schema:"authority-only-runner-fail-evidence-v1";
 readonly kind:"gateway_controlled_docker_runner_fail";
 readonly session_id:string;readonly authority_digest:string;
 readonly root_credential_id:string;readonly task_id:string;
 readonly runtime_task_id:string;readonly epoch:number;
 readonly agent_did:string;readonly credential_id:string;
 readonly request_id:string;readonly request_fingerprint:string;
 readonly repository:string;readonly branch:string;
 readonly tested_commit_sha:string;readonly first_failed_phase:string;
 readonly typecheck_error_codes?:readonly string[];
 readonly failing_test_files?:readonly string[];
 readonly acceptance_failure?:RunnerClientResult["acceptance_failure"];
 readonly repair_candidate:boolean;readonly runner_profile:"poc-default";
 readonly log_reference:string;readonly policy_version:string;
 readonly completed_at_ms:number;
 readonly verification:Readonly<{
  native_rust_vp_verified:true;opa_allow:true;
  controlled_runner_authenticated:true;gitea_head_pinned:true;
 }>;
 readonly mac_sha256:string;
}
function filename(intent:TrustedAuthorityOnlyRunnerIntent){
 if(!NAME.test(intent.session_id)||!NAME.test(intent.request_id))
  fail("missing canonical Task/Runner identity");
 return digest(intent.session_id+"\n"+intent.request_id)+".runner-fail.json";
}
async function checkDirectory(directory:string){
 if(typeof directory!=="string"||!isAbsolute(directory)||
    resolve(directory)!==directory||directory.length>512)
  fail("owner-provisioned absolute receipt directory required");
 const st=await lstat(directory);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o777)!==0o700||
    (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  fail("unsafe private failure receipt directory");
}
async function writeOnce(directory:string,name:string,v:FailReceipt){
 await checkDirectory(directory);
 const fd=await open(join(directory,name),
  constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600)
   fail("unsafe Runner failure receipt file");
  await fd.writeFile(JSON.stringify(v)+"\n","utf8");
  await fd.sync();
 }finally{await fd.close();}
 const dir=await open(directory,
  constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await dir.sync();}finally{await dir.close();}
}
async function readOnce(directory:string,name:string):Promise<unknown>{
 await checkDirectory(directory);
 const fd=await open(join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
     (typeof process.getuid==="function"&&st.uid!==process.getuid())||
     st.size<180||st.size>8192)
   fail("unsafe or incomplete Runner failure receipt");
  return JSON.parse(await fd.readFile("utf8"));
 }finally{await fd.close();}
}
async function headMatches(gitea:GiteaClient,branch:string,sha:string){
 if((await gitea.getBranchMetadata(branch)).commit_sha!==sha)
  fail("Runner FAIL cannot attest a moved or stale Gitea HEAD");
}
function validateRow(raw:unknown,intent:TrustedAuthorityOnlyRunnerIntent,
 e:TrustedCompletionExpectation,repo:string,branch:string):FailReceipt{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
  fail("Runner failure receipt not a structured object");
 const v=raw as Record<string,unknown>;
 const codesPresent=Object.hasOwn(v,"typecheck_error_codes");
 const phase=v.first_failed_phase;
 const files=v.failing_test_files;
 if(Object.keys(v).filter(k=>!["typecheck_error_codes","acceptance_failure","failing_test_files"].includes(k)).sort().join(",")!==FIELDS||
    (Object.hasOwn(v,"failing_test_files")&&
     ((phase!=="backend_tests"&&phase!=="frontend_tests")||
      !Array.isArray(files)||!files.length||
      JSON.stringify(sanitizeVitestFailureFiles(files,phase))!==JSON.stringify(files)))||
    (Object.hasOwn(v,"acceptance_failure")&&
     (v.first_failed_phase!=="researcher_acceptance"||
      !safeAcceptanceFailureSummary(v.acceptance_failure)))||
    (codesPresent&&(v.first_failed_phase!=="typecheck"||
      !Array.isArray(v.typecheck_error_codes)||
      v.typecheck_error_codes.length===0||
      JSON.stringify(sanitizeTypecheckErrorCodes(v.typecheck_error_codes))!==
       JSON.stringify(v.typecheck_error_codes)))||
    v.schema!=="authority-only-runner-fail-evidence-v1"||
    v.kind!=="gateway_controlled_docker_runner_fail"||
    BINDING.some(k=>v[k]!==e[k]||v[k]!==intent[k])||
    v.repository!==repo||v.branch!==branch||
    v.tested_commit_sha!==intent.expected_head_sha||
    !SHA40.test(v.tested_commit_sha as string)||
    !SHA64.test(v.authority_digest as string)||
    !SHA64.test(v.request_fingerprint as string)||
    !SHA64.test(v.mac_sha256 as string)||
    v.runner_profile!=="poc-default"||
    typeof v.first_failed_phase!=="string"||
    !["dependency_install","typecheck","backend_tests","frontend_tests",
       "build","playwright_e2e","researcher_acceptance"].includes(v.first_failed_phase)||
    v.repair_candidate!==(v.first_failed_phase!=="dependency_install")||
    !LOG.test(v.log_reference as string)||
    typeof v.policy_version!=="string"||
    !v.policy_version.trim()||v.policy_version.length>128||
    !Number.isSafeInteger(v.completed_at_ms)||(v.completed_at_ms as number)<=0)
  fail("Runner FAIL receipt violates signed Task/Runner binding");
 const flags=v.verification;
 if(!flags||typeof flags!=="object"||Array.isArray(flags)||
    Object.keys(flags).sort().join(",")!==[
     "native_rust_vp_verified","opa_allow",
     "controlled_runner_authenticated","gitea_head_pinned"
    ].sort().join(",")||
    Object.values(flags).some(x=>x!==true))
  fail("Runner FAIL receipt lacks original Rust/OPA/provider checks");
 return v as unknown as FailReceipt;
}
function config(opts:{directory:string;key:Buffer;giteaClient:GiteaClient;
 repository:string;branch:string;nowMs?:()=>number}){
 if(!opts||!(opts.key instanceof Buffer)||opts.key.length<32||
    !(opts.giteaClient instanceof GiteaClient)||
    !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
    !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch)||
    opts.branch.includes("..")||opts.branch.includes("//"))
  fail("missing authenticated owner-only failure evidence dependencies");
 if(typeof opts.directory!=="string"||!isAbsolute(opts.directory)||
    resolve(opts.directory)!==opts.directory)fail("noncanonical receipt directory");
}
export class TrustedGatewayRunnerFailEvidencePublisher{
 readonly #journal:DurableAuthorityOnlyRunnerIntentJournal;
 readonly #directory:string;readonly #key:Buffer;readonly #runner:RunnerClient;
 readonly #gitea:GiteaClient;readonly #repo:string;readonly #branch:string;
 readonly #now:()=>number;
 constructor(opts:{directory:string;key:Buffer;runnerClient:RunnerClient;
  journal:DurableAuthorityOnlyRunnerIntentJournal;
  independentGiteaClient:GiteaClient;repository:string;branch:string;
  nowMs?:()=>number}){
  config({...opts,giteaClient:opts.independentGiteaClient});
  if(!(opts.runnerClient instanceof RunnerClient)||
     !(opts.journal instanceof DurableAuthorityOnlyRunnerIntentJournal))
   fail("concrete Runner and original durable attempt journal required");
  this.#journal=opts.journal;
  this.#directory=opts.directory;this.#key=Buffer.from(opts.key);
  this.#runner=opts.runnerClient;this.#gitea=opts.independentGiteaClient;
  this.#repo=opts.repository;this.#branch=opts.branch;
  this.#now=opts.nowMs??Date.now;
 }
 isForRunner(r:RunnerClient){return r===this.#runner;}
 isForGitea(g:GiteaClient){return g===this.#gitea;}
 isForJournal(j:DurableAuthorityOnlyRunnerIntentJournal){return j===this.#journal;}
 async publish(intent:TrustedAuthorityOnlyRunnerIntent,e:TrustedCompletionExpectation,
  request:RunnerClientRequest,result:RunnerClientResult,policyVersion:string
 ):Promise<string>{
  DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
  if(BINDING.some(k=>intent[k]!==e[k])||
     intent.repository!==this.#repo||intent.branch!==this.#branch||
     typeof policyVersion!=="string"||!policyVersion.trim()||
     policyVersion.length>128)
   fail("owner FAIL receipt requested for foreign Task or invalid policy");
  const stage=validateTrustedRunnerFailure(this.#runner,request,result,intent);
  await this.#journal.assertAttempted(intent);
  await headMatches(this.#gitea,intent.branch,intent.expected_head_sha);
  const now=this.#now();
  if(!Number.isSafeInteger(now)||now<=0)
   fail("invalid owner time");
  const unsigned:Omit<FailReceipt,"mac_sha256">={
   schema:"authority-only-runner-fail-evidence-v1",
   kind:"gateway_controlled_docker_runner_fail",...e,
   repository:this.#repo,branch:this.#branch,
   tested_commit_sha:stage.tested_commit_sha,
   first_failed_phase:stage.first_failed_phase,
   ...(stage.first_failed_phase==="typecheck"&&result.typecheck_error_codes?.length?
    {typecheck_error_codes:sanitizeTypecheckErrorCodes(result.typecheck_error_codes)}:{}),
   ...(stage.first_failed_phase==="researcher_acceptance"&&result.acceptance_failure?
    {acceptance_failure:result.acceptance_failure}:{}),
   ...((stage.first_failed_phase==="backend_tests"||stage.first_failed_phase==="frontend_tests")&&
    result.failing_test_files?.length?{failing_test_files:result.failing_test_files}:{}),
   repair_candidate:stage.repair_candidate,
   runner_profile:"poc-default",log_reference:result.log_reference!,
   policy_version:policyVersion,completed_at_ms:now,
   verification:{
    native_rust_vp_verified:true,opa_allow:true,
    controlled_runner_authenticated:true,gitea_head_pinned:true
   }
  };
  const mac_sha256=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest("hex");
  const receipt:FailReceipt={...unsigned,mac_sha256};
  await headMatches(this.#gitea,intent.branch,intent.expected_head_sha);
  await this.#journal.assertAttempted(intent);
  await writeOnce(this.#directory,filename(intent),receipt);
  return digest(canonical(receipt));
 }
}
export class AuthenticatedRunnerFailureObserver{
 readonly #journal:DurableAuthorityOnlyRunnerIntentJournal;
 readonly #directory:string;readonly #key:Buffer;readonly #gitea:GiteaClient;
 readonly #repo:string;readonly #branch:string;readonly #now:()=>number;
 constructor(opts:{directory:string;key:Buffer;giteaClient:GiteaClient;
  journal:DurableAuthorityOnlyRunnerIntentJournal;
  repository:string;branch:string;nowMs?:()=>number}){
  config(opts);
  if(!(opts.journal instanceof DurableAuthorityOnlyRunnerIntentJournal))
   fail("observer requires original durable Runner attempt journal");
  this.#journal=opts.journal;
  this.#directory=opts.directory;this.#key=Buffer.from(opts.key);
  this.#gitea=opts.giteaClient;this.#repo=opts.repository;
  this.#branch=opts.branch;this.#now=opts.nowMs??Date.now;
 }
 isForGitea(g:GiteaClient){return g===this.#gitea;}
 isForJournal(j:DurableAuthorityOnlyRunnerIntentJournal){return j===this.#journal;}
 async observe(intent:TrustedAuthorityOnlyRunnerIntent,e:TrustedCompletionExpectation):
 Promise<Readonly<TrustedCompletionExpectation & {
  status:"owner_authenticated_runner_failure_observed_staged";
  tested_commit_sha:string;first_failed_phase:string;
  typecheck_error_codes?:readonly string[];
  failing_test_files?:readonly string[];
  acceptance_failure?:RunnerClientResult["acceptance_failure"];
  repair_candidate:boolean;evidence_sha256:string;
  gateway_task_completed:false;recovery_authorized:false
 }>>{
  DurableAuthorityOnlyRunnerIntentJournal.assertValid(intent);
  await this.#journal.assertAttempted(intent);
  const raw=await readOnce(this.#directory,filename(intent));
  const v=validateRow(raw,intent,e,this.#repo,this.#branch);
  const {mac_sha256,...unsigned}=v;
  const actual=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest();
  const claimed=Buffer.from(mac_sha256,"hex");
  if(claimed.length!==32||!timingSafeEqual(actual,claimed))
   fail("Runner FAIL receipt MAC invalid");
  if(Math.abs(this.#now()-v.completed_at_ms)>30*60_000)
   fail("stale or future FAIL receipt");
  await headMatches(this.#gitea,v.branch,v.tested_commit_sha);
  await headMatches(this.#gitea,v.branch,v.tested_commit_sha);
  await this.#journal.assertAttempted(intent);
  return Object.freeze({...e,
   status:"owner_authenticated_runner_failure_observed_staged" as const,
   tested_commit_sha:v.tested_commit_sha,
   first_failed_phase:v.first_failed_phase,
   ...(v.typecheck_error_codes?.length?
    {typecheck_error_codes:Object.freeze([...v.typecheck_error_codes])}:{}),
   ...(v.acceptance_failure?{acceptance_failure:safeAcceptanceFailureSummary(v.acceptance_failure)!}:{}),
   ...(v.failing_test_files?.length?{failing_test_files:Object.freeze([...v.failing_test_files])}:{}),
   repair_candidate:v.repair_candidate,
   evidence_sha256:digest(canonical(v)),
   gateway_task_completed:false as const,recovery_authorized:false as const
  });
 }
}
