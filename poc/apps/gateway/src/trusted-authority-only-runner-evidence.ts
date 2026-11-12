/**
 * R303.3 — authenticated, owner-only PASS receipt for controlled Docker
 * Runner. Must be called only after real native Rust VP + OPA allow,
 * original immutable Runner intent and durable one-shot attempt.
 *
 * HMAC protects provenance within the trusted Gateway owner; it is NOT
 * itself a Docker scheduler signature. The real controlled RunnerClient
 * response, all six project phases, researcher acceptance, and the pinned
 * Gitea HEAD must independently corroborate PASS before Task completion.
 */
import {isRunnerPhaseName,MAX_PROJECT_PHASES} from "../../../packages/plan-contracts/src/project-profile.mjs";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {GiteaClient} from "./gitea-client.ts";
import {RunnerClient,type RunnerClientRequest,type RunnerClientResult}
 from "./runner-client.ts";
import {validateTrustedRunnerPass} from "./trusted-authority-only-runner-pass.ts";
import type {TrustedAuthorityOnlyRunnerIntent}
 from "./trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver,
 type TrustedCompletionExpectation,type ObservedTrustedTaskCompletion}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA40=/^[a-f0-9]{40}$/u,SHA64=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
function deny(reason:string):never{
 throw Error("Authority-only Runner evidence NO-GO: "+reason);
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
const BINDING=[
 "session_id","authority_digest","root_credential_id","task_id",
 "runtime_task_id","epoch","agent_did","credential_id","request_id",
 "request_fingerprint"
] as const;
const FIELDS=[
 "schema","kind",...BINDING,"repository","branch","tested_commit_sha",
 "runner_profile","project_profile_sha256","project_tests","researcher_acceptance",
 "phase_names","log_reference","policy_version","completed_at_ms",
 "verification","mac_sha256"
].sort().join(",");
interface OwnerRunnerPassReceipt{
 readonly schema:"authority-only-runner-pass-evidence-v1";
 readonly kind:"gateway_controlled_docker_runner_pass";
 readonly session_id:string;
 readonly authority_digest:string;
 readonly root_credential_id:string;
 readonly task_id:string;
 readonly runtime_task_id:string;
 readonly epoch:number;
 readonly agent_did:string;
 readonly credential_id:string;
 readonly request_id:string;
 readonly request_fingerprint:string;
 readonly repository:string;
 readonly branch:string;
 readonly tested_commit_sha:string;
 readonly runner_profile:"poc-default";
 readonly project_profile_sha256:string;
 readonly project_tests:"pass";
 readonly researcher_acceptance:"skipped"|"pass";
 readonly phase_names:readonly string[];
 readonly log_reference:string;
 readonly policy_version:string;
 readonly completed_at_ms:number;
 readonly verification:Readonly<{
  native_rust_vp_verified:true;opa_allow:true;
  controlled_runner_authenticated:true;gitea_head_pinned:true;
 }>;
 readonly mac_sha256:string;
}
function validateDir(dir:string){
 if(typeof dir!=="string"||!isAbsolute(dir)||resolve(dir)!==dir||
    dir.length>512)
  deny("owner-provisioned absolute receipt directory required");
}
async function privateDir(dir:string){
 const st=await lstat(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o777)!==0o700||
    (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  deny("unsafe Runner evidence directory");
}
function receiptName(e:TrustedCompletionExpectation){
 if(!ID.test(e.session_id)||!ID.test(e.request_id))
  deny("invalid protected Test Task request ID");
 return sha(e.session_id+"\n"+e.request_id)+".runner.json";
}
async function writeReceipt(dir:string,name:string,receipt:OwnerRunnerPassReceipt){
 await privateDir(dir);
 const fd=await open(join(dir,name),
  constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,
  0o600);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600)
   deny("untrusted or shared Runner receipt file");
  await fd.writeFile(JSON.stringify(receipt)+"\n","utf8");
  await fd.sync();
 }finally{await fd.close();}
 const parent=await open(dir,constants.O_RDONLY|constants.O_DIRECTORY|
  constants.O_NOFOLLOW);
 try{await parent.sync();}finally{await parent.close();}
}
async function readReceipt(dir:string,name:string):Promise<unknown>{
 await privateDir(dir);
 const fd=await open(join(dir,name),
  constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.nlink!==1||(st.mode&0o777)!==0o600||
     (typeof process.getuid==="function"&&st.uid!==process.getuid())||
     st.size<180||st.size>8192)
   deny("missing or unsafe protected Runner receipt");
  return JSON.parse(await fd.readFile("utf8")) as unknown;
 }finally{await fd.close();}
}
function assertFields(
 value:unknown,e:TrustedCompletionExpectation,repo:string,branch:string
):OwnerRunnerPassReceipt{
 if(!value||typeof value!=="object"||Array.isArray(value))
  deny("Runner receipt is not a protected object");
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(",")!==FIELDS||
    v.schema!=="authority-only-runner-pass-evidence-v2"||
    v.kind!=="gateway_controlled_docker_runner_pass"||
    v.repository!==repo||v.branch!==branch||
    BINDING.some(k=>v[k]!==e[k])||
    !SHA64.test(v.authority_digest as string)||
    !SHA64.test(v.request_fingerprint as string)||
    !SHA64.test(v.mac_sha256 as string)||
    !SHA40.test(v.tested_commit_sha as string)||
    v.runner_profile!=="poc-default"||
    !SHA64.test(v.project_profile_sha256 as string)||
    v.project_tests!=="pass"||
    (v.researcher_acceptance!=="skipped"&&v.researcher_acceptance!=="pass")||
    !Array.isArray(v.phase_names)||
    v.phase_names.length<2||v.phase_names.length>MAX_PROJECT_PHASES+1||
    !v.phase_names.every(isRunnerPhaseName)||
    new Set(v.phase_names).size!==v.phase_names.length||
    v.phase_names.at(-1)!=="researcher_acceptance"||
    typeof v.log_reference!=="string"||
    !/^runner-log:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
      .test(v.log_reference)||
    typeof v.policy_version!=="string"||
    !v.policy_version.trim()||v.policy_version.length>128||
    !Number.isSafeInteger(v.completed_at_ms)||(v.completed_at_ms as number)<=0)
  deny("Runner pass receipt differs from signed Task or exact phase result");
 const verdict=v.verification;
 if(!verdict||typeof verdict!=="object"||Array.isArray(verdict)||
    Object.keys(verdict).sort().join(",")!==[
     "native_rust_vp_verified","opa_allow",
     "controlled_runner_authenticated","gitea_head_pinned"
    ].sort().join(",")||
    Object.values(verdict).some(x=>x!==true))
  deny("Runner receipt lacks independent cryptographic/policy flags");
 return v as unknown as OwnerRunnerPassReceipt;
}
async function assertHead(client:GiteaClient,branch:string,sha40:string){
 const h=await client.getBranchMetadata(branch);
 if(h.commit_sha!==sha40)
  deny("Runner tested a stale or moved feature branch HEAD");
}
export class AuthenticatedRunnerCompletionObserver{
 readonly #directory:string;
 readonly #key:Buffer;
 readonly #client:GiteaClient;
 readonly #repo:string;
 readonly #branch:string;
 readonly #now:()=>number;
 constructor(opts:{
  directory:string;key:Buffer;giteaClient:GiteaClient;
  repository:string;branch:string;nowMs?:()=>number
 }){
  if(!opts||!(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.giteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch))
   deny("independent observer missing trusted owner dependencies");
  validateDir(opts.directory);
  this.#directory=opts.directory;
  this.#key=Buffer.from(opts.key);
  this.#client=opts.giteaClient;
  this.#repo=opts.repository;this.#branch=opts.branch;
  this.#now=opts.nowMs??Date.now;
 }
 /** Owner-only evidence projection for the subsequent application PR gate.
  * A PASS is useful only while Gitea still points at the exact tested SHA. */
 static isForRepository(value:unknown,repository:string,branch:string):
  value is AuthenticatedRunnerCompletionObserver{
  return value instanceof AuthenticatedRunnerCompletionObserver &&
   #repo in value && value.#repo===repository && value.#branch===branch &&
   GiteaClient.isPinnedRepositoryClient(value.#client,
    repository.split("/")[0],repository.split("/")[1]);
 }
 async observe(e:TrustedCompletionExpectation):Promise<ObservedTrustedTaskCompletion>{
  return (await this.#readTestedHead(e)).completion;
 }
 async observeTestedHead(e:TrustedCompletionExpectation){
  return this.#readTestedHead(e);
 }
 async #readTestedHead(e:TrustedCompletionExpectation):Promise<Readonly<{
  completion:ObservedTrustedTaskCompletion;
  repository:string;branch:string;tested_commit_sha:string;
  project_tests:"pass";researcher_acceptance:"skipped"|"pass";
 }>>{
  const raw=await readReceipt(this.#directory,receiptName(e));
  const r=assertFields(raw,e,this.#repo,this.#branch);
  const {mac_sha256,...without}=r;
  const real=createHmac("sha256",this.#key)
   .update(canonical(without)).digest();
  const received=Buffer.from(mac_sha256,"hex");
  if(received.length!==32||!timingSafeEqual(real,received))
   deny("Runner PASS receipt has invalid owner MAC");
  if(Math.abs(this.#now()-r.completed_at_ms)>30*60_000)
   deny("stale or future Runner PASS receipt");
  // Independent of the RunnerService and the publishing client.
  await assertHead(this.#client,r.branch,r.tested_commit_sha);
  await assertHead(this.#client,r.branch,r.tested_commit_sha);
  return Object.freeze({
   completion:Object.freeze({...e,
    status:"owner_verified_provider_result" as const,
    evidence_sha256:sha(canonical(r)),
    completed_at_ms:r.completed_at_ms
   }),
   repository:r.repository,branch:r.branch,
   tested_commit_sha:r.tested_commit_sha,
   project_tests:r.project_tests,researcher_acceptance:r.researcher_acceptance
  });
 }
 toTrustedObserver():TrustedAuthorityOnlyCompletionObserver{
  return new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:e=>this.observe(e)
  });
 }
}
export class TrustedGatewayRunnerPassEvidencePublisher{
 readonly #directory:string;
 readonly #key:Buffer;
 readonly #runner:RunnerClient;
 readonly #gitea:GiteaClient;
 readonly #repo:string;
 readonly #branch:string;
 readonly #now:()=>number;
 constructor(opts:{
  directory:string;key:Buffer;runnerClient:RunnerClient;
  independentGiteaClient:GiteaClient;
  repository:string;branch:string;nowMs?:()=>number
 }){
  if(!opts||!(opts.key instanceof Buffer)||opts.key.length<32||
     !(opts.runnerClient instanceof RunnerClient)||
     !(opts.independentGiteaClient instanceof GiteaClient)||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch))
   deny("trusted Runner publisher dependencies missing");
  validateDir(opts.directory);
  this.#directory=opts.directory;
  this.#key=Buffer.from(opts.key);
  this.#runner=opts.runnerClient;
  this.#gitea=opts.independentGiteaClient;
  this.#repo=opts.repository;this.#branch=opts.branch;
  this.#now=opts.nowMs??Date.now;
 }
 isForRunner(client:RunnerClient){return this.#runner===client;}
 async publish(
  intent:TrustedAuthorityOnlyRunnerIntent,
  binding:TrustedCompletionExpectation,
  request:RunnerClientRequest,result:RunnerClientResult,
  policyVersion:string
 ):Promise<string>{
  if(BINDING.some(k=>intent[k]!==binding[k])||
     intent.repository!==this.#repo||
     intent.branch!==this.#branch||
     intent.request_id!==request.request_id||
     request.repository!=="gitea://gitea.local/"+intent.repository||
     request.branch!==intent.branch||
     request.commit_sha!==intent.expected_head_sha||
     request.profile!==intent.runner_profile||
     typeof policyVersion!=="string"||
     !policyVersion.trim()||policyVersion.length>128)
   deny("Runner provider result belongs to another Task or signed SHA");
  const pass=validateTrustedRunnerPass(this.#runner,request,result);
  if(pass.tested_commit_sha!==intent.expected_head_sha||
     pass.runner_execution_authorized!==false)
   deny("Runner PASS is not bound to pinned owner intent");
  await assertHead(this.#gitea,intent.branch,intent.expected_head_sha);
  const now=this.#now();
  if(!Number.isSafeInteger(now)||now<=0)
   deny("invalid owner time for Runner result receipt");
  const unsigned:Omit<OwnerRunnerPassReceipt,"mac_sha256">={
   schema:"authority-only-runner-pass-evidence-v2",
   kind:"gateway_controlled_docker_runner_pass",
   ...binding,
   repository:this.#repo,
   branch:this.#branch,
   tested_commit_sha:pass.tested_commit_sha,
   runner_profile:"poc-default",
   project_profile_sha256:pass.project_profile_sha256,
   project_tests:"pass",researcher_acceptance:pass.researcher_acceptance,
   phase_names:[...pass.completed_phases],
   log_reference:pass.log_reference,
   policy_version:policyVersion,completed_at_ms:now,
   verification:{
    native_rust_vp_verified:true,opa_allow:true,
    controlled_runner_authenticated:true,gitea_head_pinned:true
   }
  };
  const mac_sha256=createHmac("sha256",this.#key)
   .update(canonical(unsigned)).digest("hex");
  const receipt={...unsigned,mac_sha256};
  await assertHead(this.#gitea,intent.branch,intent.expected_head_sha);
  await writeReceipt(this.#directory,receiptName(binding),receipt);
  return sha(canonical(receipt));
 }
}
