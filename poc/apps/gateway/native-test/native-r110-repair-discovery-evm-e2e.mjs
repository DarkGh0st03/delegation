/**
 * R110 (nonbillable): after a Runner FAIL, a NEW discovery Task absent from
 * the Engineer-approved DAG receives a REAL Rust Adapter child DC and
 * signed JWT VP. Native Core verifies the VP against EVM trust and live OPA
 * controls the exact read_file before the Gateway's provider boundary.
 *
 * Provider Gitea / Docker effects are SCRIPTED in this test. This IS NOT
 * the final real Gitea + real Docker acceptance test.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {SoftwareEngineerAuthorityBootstrap} from
  "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {TrustedEngineerAuthoritySession} from
  "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from
  "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedOperationalEpochIntake} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-intake.ts";
import {TrustedOperationalEpochJournal} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-epoch-journal.mjs";
import {TrustedApprovedPlanChildAuthorityIssuer} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-child-issuer.ts";
import {TrustedChildIssuanceJournal} from
  "../../../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {TrustedOperationalRepairSourceReader} from
  "../../../packages/orchestrator-runtime/src/trusted-operational-repair-source-reader.ts";
import {TrustedOperationalFeatureHeadReader} from
  "../src/trusted-operational-feature-head.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {GatewayRuntime} from "../src/runtime.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";

const adapter="http://127.0.0.1:8090";
const opa=process.env.OPA_URL??"http://127.0.0.1:8181";
if(process.env.GATEWAY_VERIFIER_MODE!=="core-rust"||
   process.env.ADAPTER_TRUST_PROFILE!=="evm")
 throw Error("R110 requires real native Core Rust and public EVM trust, not fixtures");
const engineer=process.env.ADAPTER_ID_ENGINEER;
const backend=process.env.ADAPTER_ID_BACKEND;
const testDid=process.env.ADAPTER_ID_TEST;
const tokens={
 engineer:process.env.ADAPTER_CALLER_ENGINEER,
 orchestrator:process.env.ADAPTER_CALLER_ORCHESTRATOR,
 backend:process.env.ADAPTER_CALLER_BACKEND,
 test:process.env.ADAPTER_CALLER_TEST
};
if(![engineer,backend,testDid,...Object.values(tokens)]
   .every(x=>typeof x==="string"&&x.length>4))
 throw Error("R110 missing actual EVM/Adapter role identities");
const unique=randomBytes(5).toString("hex");
const session="r110-native-"+unique,sha="a".repeat(40),failedSha="b".repeat(40);
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const branch="feature/account-suspension",file="apps/backend/src/users/user.service.ts";
const repoUri="gitea://gitea.local/thesis/iam-console-poc";
const branchUri=repoUri+"/branches/"+encodeURIComponent(branch);
const fileUri=branchUri+"/files/"+file;
const initial={
 schema_version:"1.0.0",plan_id:"r110-initial-"+unique,
 session_id:session,version:1,repository:repo,base_revision:sha,
 requirement:"Repair a source error within the exact granted branch file",
 candidate_agents:[
  {agent_id:"backend",did:backend,card_ref:"trusted:backend"},
  {agent_id:"test",did:testDid,card_ref:"trusted:test"}
 ],
 tasks:[
  {id:"backend",agent_id:"backend",title:"Initial implementation",
   description:"Make the first attempted update",depends_on:[],
   resources:[fileUri]},
  {id:"test",agent_id:"test",title:"Validate TypeScript",
   description:"Run controlled Docker validation",depends_on:["backend"],
   resources:[branchUri]}
 ],
 requested_permissions:[
  {id:"backend-write",task_id:"backend",agent_id:"backend",
   resource:fileUri,operation:"update_file",reason:"Approved write"},
  {id:"backend-read",task_id:"backend",agent_id:"backend",
   resource:fileUri,operation:"read_file",reason:"Maximum read scope"},
  {id:"test-run",task_id:"test",agent_id:"test",
   resource:branchUri,operation:"run_tests",reason:"Check revision"}
 ],
 assumptions:[],uncertainties:[]
};
function parameters(id,index,seconds=600){
 return {credential_id:id,valid_from:new Date(Date.now()-3000).toISOString(),
  validity_seconds:seconds,credential_status:{
   type:"BitstringStatusListEntry",statusPurpose:"revocation",
   statusListIndex:String(index),
   statusListCredential:"https://status.example/lists/r110-dynamic"
  }};
}
function phasesFail(){
 const names=["dependency_install","typecheck","backend_tests","frontend_tests",
  "build","playwright_e2e","researcher_acceptance"];
 return names.map((phase,i)=>({phase,status:i===0?"pass":i===1?"fail":"skipped"}));
}
async function vp(credentialId,token,prepared){
 const response=await fetch(adapter+"/v1/presentations",{
  method:"POST",headers:{authorization:"Bearer "+token,
   "content-type":"application/json"},
  body:JSON.stringify({
   credential_id:credentialId,
   disclosed_permissions:[prepared.required_permission],
   audience:prepared.audience,challenge:prepared.challenge
  }),signal:AbortSignal.timeout(15_000)
 });
 const body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));
 assert.equal(typeof body.signed_vp,"string");
 return body.signed_vp;
}
const home=await mkdtemp(join(tmpdir(),"r110-real-native-"));
let coordinator,openedRoot;
try{
 const approvalsDir=join(home,"approvals");
 const epochDir=join(home,"epochs");
 const childDir=join(home,"children");
 for(const d of [approvalsDir,epochDir,childDir])await mkdir(d,{mode:0o700});
 const keys=generateKeyPairSync("ed25519"),keyId="r110-engineer";
 const approval=makeApproval(initial,{
  allowedOperations:new Set(RUST_OPERATIONS),
  decision_id:"r110-signed-"+unique,approved_by:engineer,
  approved_at:new Date().toISOString(),
  approved_permission_ids:initial.requested_permissions.map(x=>x.id)
 });
 await writeFile(join(approvalsDir,session+".json"),JSON.stringify(
  signEngineerApproval({
   plan:initial,approval,engineerDid:engineer,keyId,
   privateKeyPem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
   issuedAt:new Date().toISOString(),
   expiresAt:new Date(Date.now()+30*60*1000).toISOString()
  })),{mode:0o600});
 const approvals=new SignedEngineerApprovalFileStore({
  directory:approvalsDir,engineerDid:engineer,
  trustedKeys:{[keyId]:{
   engineer_did:engineer,
   public_key_pem:keys.publicKey.export({format:"pem",type:"spki"}).toString()
  }}
 });
 const credentials=new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl:adapter,bearerToken:tokens.engineer,timeoutMs:25_000
 });
 let gates;
 const trustedGatewayControl={
  activate:(id,revision)=>gates.activate(id,revision),
  bindTask:(id,task,runtime,role)=>gates.bindTask(id,task,runtime,role),
  confirmTaskCompletion:(runtime,observation)=>gates.confirmTaskCompletion(runtime,observation),
  closeSession:id=>gates.closeSession(id),
  retireSession:id=>gates.retireSession(id)
 };
 const authority=new TrustedEngineerAuthoritySession({
  snapshot:{session_id:session,repository:repo,base_revision:sha,
   directories:[""],files:[]},
  credentials,approvals,authenticatedEngineerDid:engineer
 });
 coordinator=new TrustedExecutionCoordinator({
  authority,approvedGatewayPlans:trustedGatewayControl,
  credentials,sessionId:session,baseRevision:sha
 });
 const intake=TrustedOperationalEpochIntake.create({
  coordinator,approvals,journal:new TrustedOperationalEpochJournal({
   directory:epochDir,sessionId:session,baseRevision:sha,
   rootCredentialId:"urn:r110:operational-"+unique,
   originalPlanDigest:planDigest(initial),allowedOperations:new Set(RUST_OPERATIONS)
  }),sessionId:session,engineerDid:engineer,
  pinnedAgentRegistry:[
   {agent_id:"backend",did:backend,card_ref:"trusted:backend"},
   {agent_id:"test",did:testDid,card_ref:"trusted:test"}
  ]
 });
 gates=new TrustedApprovedExecutionPlans({
  repository:repo,engineerDid:engineer,approvals,
  operationalEpochIntake:intake,
  completionAttestor:{
   async confirmCompleted(observed){
    return observed.provider_effects.length>0&&
     observed.successful_gateway_request_ids.length===observed.provider_effects.length;
   }
  }
 });
 let effects=0;
 const gateway=new GatewayRuntime({
  bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-access-gateway",request_ttl_ms:120_000,repository:repo},
  opa_url:opa,opa_timeout_ms:5000,
  provider_mode:"gitea",gitea_timeout_ms:3000
 },{
  approvedPlans:gates,verifier:loadDirectCoreRustVerifier(),
  policy:new OpaPolicyClient({baseUrl:opa,timeoutMs:5000}),
  executor:{
   provider:"gitea",
   providerFor:record=>record.request.tool==="run_tests"?"runner":"gitea",
   async execute(record){
    effects++;
    const {tool,arguments:arg}=record.request;
    if(arg.branch!==branch)throw Error("Provider fixture denies a changed branch");
    if(tool==="update_file"&&arg.path===file)
     return {provider:"gitea",performed:true,tool,branch,
      path:file,revision:failedSha,commit_sha:failedSha,
      blob_sha:"d".repeat(40),precondition_blob_sha:"e".repeat(40)};
    if(tool==="run_tests")
     return {provider:"runner",performed:true,tool,branch,
      revision:failedSha,tested_commit_sha:failedSha,
      runner_profile:"poc-default",status:"fail",phases:phasesFail(),
      typecheck_error_codes:["TS2339"],project_tests:{status:"fail"}};
    if(tool==="read_file"&&arg.path===file){
     const content="export function accountSuspension() { return true; }\n";
     return {provider:"gitea",performed:true,tool,branch,path:file,
      revision:failedSha,blob_sha:"e".repeat(40),
      last_commit_sha:failedSha,size:Buffer.byteLength(content),
      encoding:"utf-8",content};
    }
    throw Error("Provider fixture denied an unknown tool/file");
   }
  }
 });
 await coordinator.beginPlanning(parameters("urn:r110:planning-"+unique,"29880",180));
 openedRoot="urn:r110:operational-"+unique;
 const active=await coordinator.beginExecution(parameters(openedRoot,"29881",900));
 assert.equal(active.plan_digest,planDigest(initial));
 await intake.reserveInitialEpoch();
 const root=coordinator.trustedOperationalAuthority();
 assert.deepEqual(new Set(root.permissions.map(p=>p.operation)),
  new Set(["read_file","update_file","run_tests"]));
 const issuanceJournal=new TrustedChildIssuanceJournal({
  directory:childDir,sessionId:session,baseRevision:sha,
  planDigest:root.plan_digest,parentCredentialId:root.credential_id
 });
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.create({
  approvals,coordinator,sessionId:session,engineerDid:engineer,
  adapterBaseUrl:adapter,bearerToken:tokens.orchestrator,
  issuanceJournal
 });
 async function issue(taskId,role,index){
  const id="urn:r110:"+taskId+"-"+unique;
  const {credential}=await issuer.issueSpecializedChild({
   parent_credential_id:root.credential_id,
   approved_task_id:taskId,selection:{role},
   ...parameters(id,index,300)
  });
  assert.equal(credential.id,id);
  return id;
 }
 const backendChild=await issue("backend","backend","29882");
 const testChild=await issue("test","test","29883");
 gates.bindTask(session,"backend","native-r110-backend","backend");
 gates.bindTask(session,"test","native-r110-test","test");
 async function executeWithChild(runtime,role,tool,args,credentialId,token){
  const prepared=gateway.prepare({
   task_id:runtime,agent_role:role,tool,arguments:args
  });
  const signed_vp=await vp(credentialId,token,prepared);
  return gateway.execute({request_id:prepared.request_id,signed_vp});
 }
 const write=await executeWithChild(
  "native-r110-backend","backend","update_file",
  {branch,path:file,content:"// intentionally broken"},
  backendChild,tokens.backend
 );
 assert.equal(write.verified_delegation.presenter_id,backend);
 assert.equal(write.verified_delegation.credential_id,backendChild);
 await gates.confirmTaskCompletion("native-r110-backend");
 const failed=await executeWithChild(
  "native-r110-test","test","run_tests",
  {branch,profile:"poc-default"},testChild,tokens.test
 );
 assert.equal(failed.execution.status,"fail");
 assert.equal(failed.verified_delegation.presenter_id,testDid);
 assert.equal(failed.verified_delegation.credential_id,testChild);
 const evidence=gates.confirmTestValidationFailure("native-r110-test");
 assert.equal(evidence.first_failed_phase,"typecheck");
 assert.equal(evidence.tested_commit_sha,failedSha);
 // New Task ID does not occur in signed original DAG.
 const discovery="r110-discovery-"+unique;
 assert(!initial.tasks.some(t=>t.id===discovery));
 const discoveryIssuer=await TrustedApprovedPlanChildAuthorityIssuer
  .createForRepairDiscovery({
   intake,gateway:gates,coordinator,
   sessionId:session,engineerDid:engineer,
   failedRuntimeTestTaskId:"native-r110-test",
   discoveryTaskId:discovery,role:"backend",resource:fileUri,
   adapterBaseUrl:adapter,bearerToken:tokens.orchestrator,
   issuanceJournal
  });
 const discoveryChild="urn:r110:discovery-"+unique;
 const {credential}=await discoveryIssuer.issueSpecializedChild({
  parent_credential_id:root.credential_id,
  approved_task_id:discovery,selection:{role:"backend"},
  ...parameters(discoveryChild,"29884",300)
 });
 assert.deepEqual(credential.credentialSubject.per,
  [{resource:fileUri,operation:"read_file"}]);
 const admitted=await gates.admitRepairDiscoveryTask({
  sessionId:session,failedRuntimeTestTaskId:"native-r110-test",
  taskId:discovery,agentRole:"backend",resource:fileUri,
  credentialId:discoveryChild,childIssuanceJournal:issuanceJournal
 });
 assert.equal(admitted.status,"discovery_read_admitted_not_executed");
 gates.bindTask(session,discovery,"native-r110-discovery","backend");
 assert.throws(()=>gateway.prepare({
  task_id:"native-r110-discovery",agent_role:"backend",tool:"update_file",
  arguments:{branch,path:file,content:"// denied"}
 }),/Discovery Task can only read/);
 const forged=gateway.prepare({
  task_id:"native-r110-discovery",agent_role:"backend",
  tool:"read_file",arguments:{branch,path:file}
 });
 // This original backend child has read_file, BUT is not the newly
 // journalled child. Native Rust could otherwise verify it; the Gateway
 // must additionally enforce the exact discovery credential ID.
 await assert.rejects(gateway.execute({
  request_id:forged.request_id,
  signed_vp:await vp(backendChild,tokens.backend,forged)
 }),/approved_plan_denied|credential|Trusted approved plan rejected/i);
 const client=new GiteaClient({
  baseUrl:"http://127.0.0.1:9999",token:"r110-scripted-gitea-metadata",
  owner:repo.owner,repository:repo.repository,
  fetchFn:async url=>{
   if(String(url).includes("/branches/"))
    return new Response(JSON.stringify({name:branch,commit:{id:failedSha}}),
      {status:200});
   return new Response(JSON.stringify({
    name:repo.repository,owner:{login:repo.owner},
    full_name:repo.owner+"/"+repo.repository,default_branch:"main"
   }),{status:200});
  }
 });
 const feature=new TrustedOperationalFeatureHeadReader({
  giteaClient:client,intake,repository:repo
 });
 const reader=new TrustedOperationalRepairSourceReader({
  gateway,trustedGatewayPlans:gates,
  failedRuntimeTestTaskId:"native-r110-test",
  intake,featureHeadReader:feature,
  sessionId:session,runtimeTaskId:"native-r110-discovery",
  agentRole:"backend",expectedTestedSha:failedSha,
  issueSignedVp:prepared=>vp(discoveryChild,tokens.backend,prepared)
 });
 const code=await reader.read(file);
 assert.equal(code.revision,failedSha);
 assert.equal(code.status,"gateway_verified_read");
 assert.match(code.content,/accountSuspension/);
 assert.equal(effects,3);
 await gates.confirmTaskCompletion("native-r110-discovery");
 assert.equal((await issuanceJournal.records()).length,3);
 process.stdout.write(JSON.stringify({
  result:"r110-native-evm-repair-discovery-pass",
  existing_engineer_approval:true,existing_rust_operational_root:true,
  first_test_native_vp_verified:true,
  gateway_verified_test_failure:true,
  child_dc_signed_by_real_rust_adapter:true,
  fresh_task_not_in_approved_dag:true,
  exact_attenuated_read_permission:true,
  child_vp_native_core_verified:true,
  real_opa_authorization:true,
  mismatched_valid_child_vp_rejected:true,
  source_revision:failedSha,
  gitea_provider_scripted:true,docker_runner_scripted:true,
  paid_gemini_calls:0
 },null,2)+"\n");
}finally{
 if(coordinator?.phase==="execution")
  await coordinator.closeExecution().catch(()=>{});
 await rm(home,{recursive:true,force:true});
}
