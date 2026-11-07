/** R364.1 — ONE authentic Engineer root, TWO dependent signed native Children.
 * Same approved account-suspension plan: Backend read->HEAD-CAS followed by
 * Frontend read->HEAD-CAS using the predecessor's independently observed HEAD.
 * Real SDK A2A/Google ADK (local scripted models), role-pinned HMAC Unix IPC,
 * Rust EVM, OPA and disposable Gitea. No Test/Docker/PR or paid Gemini.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {BaseLlm} from "@google/adk";
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";

import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {InMemoryAuditSink,InMemoryRequestStore,prepareAuthorization}
 from "../../../apps/gateway/src/prepare.ts";
import {executeAuthorization} from "../../../apps/gateway/src/execute.ts";
import {OpaPolicyClient} from "../../../apps/gateway/src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../../../apps/gateway/src/direct-core-loader.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedOperationalSessionStore}
 from "../../../apps/gateway/src/trusted-operational-session-store.ts";
import {createTrustedEngineerCredentialPort}
 from "../src/trusted-engineer-crypto-port.ts";
import {createNativeRustChildCryptographyPort}
 from "../src/trusted-child-crypto-port.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {DurableAuthorityOnlyChildJournal}
 from "../src/trusted-authority-only-child-journal.ts";
import {SignedAuthorityOnlyFileStore}
 from "../src/signed-authority-only-store.ts";
import {DurableAuthorityOnlyActivationJournal}
 from "../src/authority-only-activation-journal.ts";
import {DurableAuthorityTaskJournal}
 from "../src/trusted-authority-task-journal.ts";
import {TrustedAuthorityOnlyEngineerSession}
 from "../src/trusted-authority-only-engineer-session.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {signAuthorityOnlyGrant,selectAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {invokeNativeCrypto}
 from "../../agent-runtime/src/native-crypto-ipc.ts";

import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../../apps/gateway/src/gitea-executor.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight} from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-mutation-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor} from "../../../apps/gateway/src/trusted-authority-only-mutation-executor.ts";
import {TrustedGatewayGiteaMutationEvidencePublisher,
 AuthenticatedGiteaMutationCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../src/trusted-authority-only-sequential-effect-journal.ts";
import {TrustedGatewayGiteaReadEvidencePublisher}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-publisher.ts";
import {AuthenticatedGiteaReadCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-evidence.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-read-update-stager.ts";

import {TrustedEffectStagingTaskRegistry}
 from "../../agent-runtime/src/trusted-effect-staging-task-registry.ts";
import {PrivateMcpTaskRegistry}
 from "../../agent-runtime/src/private-mcp-task-registry.ts";
import {DelegationEvidenceHandler}
 from "../../agent-runtime/src/delegation-evidence-handler.ts";
import {connectTrustedOwnerEffectStagingClient,
 createTrustedEffectAgentBindingServer}
 from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

assert.equal(process.env.R233_NATIVE_EVM,"1");
assert.equal(process.env.ENGINEER_CORE_NATIVE_MODE,"1");
assert.equal(process.env.ADAPTER_TRUST_PROFILE,"evm");
assert.equal(process.env.GATEWAY_VERIFIER_MODE,"core-rust");
assert.equal(process.env.APPROVED_RUNNER_NATIVE_MCP,"1");
assert.equal(process.env.GEMINI_API_KEY,undefined);
assert.equal(process.env.OPENAI_API_KEY,undefined);
const requireAddon=createRequire(import.meta.url);
assert.equal(typeof requireAddon("../src/native/delegation-engineer.node")
 .issue_engineer_root,"function");
const tokens=Object.fromEntries(["ENGINEER","ORCHESTRATOR","BACKEND","FRONTEND","GATEWAY"].map(role=>{
 const token=process.env["ADAPTER_CALLER_"+role];
 assert.ok(token,role+" private native bearer missing");
 return [role.toLowerCase(),token];
}));
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
const frontendDid=process.env.ADAPTER_ID_FRONTEND;
const backendDid=process.env.ADAPTER_ID_BACKEND;
assert.match(engineerDid??"",/^did:/u);
assert.match(frontendDid??"",/^did:/u);
assert.match(backendDid??"",/^did:/u);
const sessionId="r364-authority-native-e2e";
class ScriptedReadThenCas extends BaseLlm {
 constructor(branch,path,oldContent,newContent){
  super({model:"r364-local-adk-read-then-cas-no-paid-inference"});
  this.branch=branch;this.path=path;
  this.oldContent=oldContent;this.newContent=newContent;
  this.requests=[];
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const turn=this.requests.length;
  if(turn===1){
   yield {content:{role:"model",parts:[{functionCall:{
    name:"read_file",id:"r364-read",args:{
     branch:this.branch,path:this.path
    }
   }}]}};
  }else if(turn===2){
   // An actual ADK FunctionResponse must carry the independently authorized
   // real Gitea source. A blind precomputed update is NOT a pass here.
   // Compare JSON-escaped UTF-8 bytes because ADK LlmRequest serializes
   // source newlines and quotes in functionResponse parts.
   const sourceEvidence=JSON.stringify(request);
   if(!sourceEvidence.includes(JSON.stringify(this.oldContent).slice(1,-1)))
    throw Error("R364 scripted ADK did not observe authenticated source bytes");
   yield {content:{role:"model",parts:[{functionCall:{
    name:"update_file",id:"r364-update",args:{
     branch:this.branch,path:this.path,content:this.newContent
    }
   }}]}};
  }else if(turn===3){
   yield {content:{role:"model",parts:[{
    text:"Native source read and CAS update completed"
   }]}};
  }else{
   throw Error("R364 unexpected ADK turn beyond the signed two-effect Task");
  }
 }
 connect(){return Promise.reject(Error("Paid model connections disabled in R364"));}
}
async function freeRolePort(){
 const server=createServer();
 await new Promise((ok,bad)=>{
  server.once("error",bad);server.listen(0,"127.0.0.1",ok);
 });
 const value=server.address();
 if(!value||typeof value==="string")throw Error("no A2A loopback port");
 await new Promise((ok,bad)=>server.close(err=>err?bad(err):ok()));
 return value.port;
}
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
let gatewayCasWrites=0;
class ObservedGiteaClient extends GiteaClient{
 async updateFileWithHeadCas(input){gatewayCasWrites++;return super.updateFileWithHeadCas(input);}
}
const client=new ObservedGiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository});
assert.ok(process.env.GITEA_RUNNER_TOKEN,"Independent read-only token required");
const independentClient=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository});
// Disposable CI owner provisioning, outside delegated execution.
const created=await client.createBranch("main","feature/account-suspension");
assert.match(created.commit_sha,/^[a-f0-9]{40}$/u);
const branch="feature/account-suspension";
const backendPath="apps/backend/users/account.ts";
const mutationPath="apps/frontend/src/account/AccountSuspension.ts";
const backendOldContent="export const backendAccountSuspended = false;\n";
const backendNewContent="export const backendAccountSuspended = true;\n";
const oldContent="export const accountSuspended = false;\n";
const newContent="export const accountSuspended = true;\n";
// Owner-only disposable CI fixture, created BEFORE the Engineer root.
// No delegated write or Docker provider effect is enabled.
const backendSeed=await client.createFile(branch,backendPath,backendOldContent,
 "R364 owner-only disposable Backend fixture");
const seeded=await client.createFile(branch,mutationPath,oldContent,
 "R364 owner-only disposable Frontend fixture");
const baseRevision=seeded.commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
const requirement="R364 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermissions=["backend","frontend"].flatMap(role=>
 ["read_file","update_file"].map(operation=>({
  resource:resourcePrefix+"/directories/apps/"+role,operation
 })));
assert.equal(grantPermissions.length,4);
const readPermission={resource:resourcePrefix+"/files/"+mutationPath,
 operation:"read_file"};
const updatePermission={resource:resourcePrefix+"/files/"+mutationPath,
 operation:"update_file"};
const taskPermissions=[readPermission,updatePermission];
const backendReadPermission={resource:resourcePrefix+"/files/"+backendPath,
 operation:"read_file"};
const backendUpdatePermission={resource:resourcePrefix+"/files/"+backendPath,
 operation:"update_file"};
const backendPermissions=[backendReadPermission,backendUpdatePermission];
assert.equal(readPermission.resource,updatePermission.resource);
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r364-disposable-ed25519";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const proposed={
 schema_version:"1.0.0",session_id:sessionId,repository:repo,branch,
 base_revision:baseRevision,requirement,
 requested_permissions:grantPermissions
};
const grant=selectAuthorityOnlyGrant(proposed,grantPermissions,{
 allowedOperations:new Set(RUST_OPERATIONS)
});
const receipt=signAuthorityOnlyGrant({
 authorization:grant,engineerDid,keyId:authKey,
 privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}),
 issuedAt,expiresAt:approvalExpiresAt,
 allowedOperations:new Set(RUST_OPERATIONS)
});
const parent=await mkdtemp(join(tmpdir(),"delegation-r364-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents","sequences","intent","receipts"];
try{
 for(const name of names)await mkdir(path(name),{mode:0o700});
 await writeFile(path("approvals")+"/"+sessionId+".json",
  JSON.stringify(receipt),{mode:0o600,flag:"wx"});
 const approvals=new SignedAuthorityOnlyFileStore({
  directory:path("approvals"),engineerDid,nowMs,
  trustedKeys:{[authKey]:{
   engineer_did:engineerDid,
   public_key_pem:publicKey.export({format:"pem",type:"spki"})
  }}
 });
 const credentialPort=createTrustedEngineerCredentialPort({
  bearerToken:tokens.engineer,timeoutMs:60000
 });
 const snapshot={
  session_id:sessionId,repository:repo,base_revision:baseRevision,
  directories:[""],files:[]
 };
 const session=new TrustedAuthorityOnlyEngineerSession({
  snapshot,requirement,credentials:credentialPort,approvals,
  authenticatedEngineerDid:engineerDid,
  journal:new DurableAuthorityOnlyActivationJournal(path("root-journal")),
  nowMs,
  planningRevisions:{
   async begin(taskId){return {task_id:taskId,
    base_revision:baseRevision,
    expires_at:new Date(Date.now()+8*60_000).toISOString()};},
   async end(){return;}
  }
 });
 const status=index=>({type:"BitstringStatusListEntry",
  statusPurpose:"revocation",statusListIndex:String(index),
  statusListCredential:"https://status.example/r364"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r364:preliminary",29101,360);
 const operational=params("urn:r364:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,grantPermissions);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{
   backend:{did:backendDid,card_ref:"trusted:r364-backend",
    capabilities:["read_file","update_file"]},
   frontend:{did:frontendDid,card_ref:"trusted:r364-frontend",
    capabilities:["read_file","update_file"]}
  },nowMs
 });
 await coordinator.activate();
 const taskId="r364-frontend-task",runtimeTaskId="dispatch_"+"F".repeat(22);
 const backendTaskId="r364-backend-task",backendRuntimeId="dispatch_"+"B".repeat(22);
 const requirementSha=createHash("sha256").update(requirement).digest("hex");
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:requirementSha,
  base_revision:baseRevision,branch,task_id:backendTaskId,epoch:1,
  agent_id:"backend",depends_on:[],permissions:backendPermissions
 });
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:requirementSha,
  base_revision:baseRevision,branch,task_id:taskId,epoch:2,
  agent_id:"frontend",depends_on:[backendTaskId],permissions:taskPermissions
 });
 assert.ok(socketPath.startsWith("/"));
 const nativePort=createNativeRustChildCryptographyPort({
  bearerToken:tokens.orchestrator,timeoutMs:60000
 },socketPath);
 const issuer=new TrustedAuthorityOnlyChildIssuer({
  coordinator,nativeCryptoPort:nativePort,
  journal:new DurableAuthorityOnlyChildJournal(path("child-intents")),
  nowMs
 });
 const backendChild=await issuer.issueForRegisteredTask(backendTaskId,
  params("urn:r364:child:backend",29103,600));
 assert.equal(backendChild.gateway_execution_authorized,false);
 assert.equal(backendChild.root_credential_id,operational.credential_id);
 assert.deepEqual(backendChild.permissions,backendPermissions);
 // Dependent Frontend Child is issued only when the native Backend finishes:
 // do not activate a future Task's signer before independent predecessors.
 let child;
 assert.deepEqual(approved.permissions,grantPermissions);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(path("sequences")),
  completionObserver:new AuthenticatedGiteaReadCompletionObserver({
   directory:path("receipts"),key:evidenceKey,repository:"thesis/iam-console-poc",
   branch,giteaClient:independentClient,nowMs
  }).toTrustedObserver(),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(backendTaskId,backendRuntimeId,"backend");
 await gate.bindTrustedTask(taskId,runtimeTaskId,"frontend");
 const backendEnrolled=await gate.enrollTrustedIssuedChild(
  backendTaskId,backendRuntimeId,issuer);
 assert.equal(backendEnrolled.credential_id,backendChild.credential_id);
 // Frontend remains registered at epoch 2 but has NO issued or enrolled Child.
 assert.throws(()=>gate.assertTrustedOwnerRemoteEffectBinding(
  taskId,runtimeTaskId));
 const verifier=loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true});
 assert.equal(verifier.allowsGiteaScopeCoverage,true);
 const policy=new OpaPolicyClient({baseUrl:"http://127.0.0.1:8181",
  timeoutMs:6000});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let legacyWriteCalls=0;
 class ObservedGiteaExecutor extends GiteaExecutor {
  async execute(...args){if(args[0]?.request?.tool==="update_file")
    legacyWriteCalls++;return super.execute(...args);}
 }
 const executor=new ObservedGiteaExecutor(client);
 const journal=new DurableAuthorityOnlyGiteaMutationIntentJournal(path("intent"));
 const preflight=new TrustedAuthorityOnlyGiteaMutationPreflight({
  admissions:gate,giteaClient:client,journal,repository:"thesis/iam-console-poc",
  branch,nowMs
 });
 const observer=new AuthenticatedGiteaMutationCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,giteaClient:independentClient,nowMs
 });
 const mutationExecutor=new TrustedAuthorityOnlyGiteaMutationExecutor({
  admissions:gate,preflight,journal,giteaClient:client,
  publisher:new TrustedGatewayGiteaMutationEvidencePublisher({
   directory:path("receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
  }),observer,repository:"thesis/iam-console-poc",branch
 });
 const readPublisher=new TrustedGatewayGiteaReadEvidencePublisher({
  directory:path("receipts"),key:evidenceKey,admissions:gate,
  // Authenticated read-only client is independent from the Gateway writer.
  independentGiteaClient:independentClient,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const backendStager=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
  store,admissions:gate,mutation:preflight,mutationObserver:observer,
  planTaskId:backendTaskId,runtimeTaskId:backendRuntimeId,
  expectedHeadSha:baseRevision
 });
 assert.equal(backendStager.stagedTool,"read_then_update");
 // R364.4: owner-private, test-only stage observation. This instruments the
 // original native stager INSTANCE (not a proxy), preserving Rust/Gateway
 // identity and exact signed Task pins. Export only fixed safe classifications.
 const backendStageEvents=[];
 const realBackendStage=backendStager.stage.bind(backendStager);
 backendStager.stage=async requestId=>{
  const record=store.get(requestId);
  backendStageEvents.push({
   phase:"entered_owner_stager",tool:record?.request?.tool??"missing",
   exact_runtime_task:record?.task_id===backendRuntimeId,
   exact_pin:record?.pinned_revision===baseRevision,
   live:record?.consumed===false&&record?.expires_at_ms>Date.now()
  });
  try{
   const result=await realBackendStage(requestId);
   backendStageEvents.push({phase:"owner_stage_success",status:result?.status??"unknown"});
   return result;
  }catch(error){
   const allowedReasons=[
    "read/update Prepare lacks original Task, path or expected HEAD",
    "sequential read lacks trusted Task, Child or previous evidence",
    "missing or concurrent sequential read reservation",
    "first typed effect must read the existing file",
    "original immutable read/update manifest is not durably reserved",
    "out-of-order, duplicate or terminated owner effect"
   ];
   const code=allowedReasons.find(known=>
    String(error?.message??"").includes(known))??"other_owner_stage_error";
   backendStageEvents.push({phase:"owner_stage_rejected",reason_code:code});
   throw error;
  }
 };
 // A signed dependency rejects Frontend even after native Child enrollment.
 await assert.rejects(
  TrustedAuthorityOnlySequentialReadUpdateStager.begin({
   store,admissions:gate,mutation:preflight,mutationObserver:observer,
   planTaskId:taskId,runtimeTaskId,expectedHeadSha:baseRevision
  }),/mixed read\/update requires one exact native Child file grant/u);
 assert.equal(gate.stagedSequentialTaskCount,1);
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:readPublisher,
  authorityOnlyMutationEnabled:true,authorityOnlyMutationExecutor:mutationExecutor};
 const prepare=(tool)=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"frontend",tool,
  arguments:{branch,path:mutationPath,
   ...(tool==="update_file"?{content:newContent}:{})}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const sign=async(prepared,permission)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.frontend,timeoutMs:60000
  },"create_presentation",{
   credential_id:child.credential_id,disclosed_permissions:[permission],
   audience:prepared.audience,challenge:prepared.challenge
  });
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 // R364: three distinct pairs of role-pinned HMAC IPC channels; separate
 // agent registries and signing keys, but one original native Engineer root.
 const roles=["backend","frontend","test"],stageChannels={},agentBindingChannels={};
 const registries={},bindingServers=[],roleServers=[],urls={},events=[],prepared=[];
 const models={
  backend:new ScriptedReadThenCas(branch,backendPath,
   backendOldContent,backendNewContent),
  frontend:new ScriptedReadThenCas(branch,mutationPath,oldContent,newContent)
 };
 // R364.7 diagnostic: observe internal phase ACKs without changing the
 // actual owner Stager, signed Task, crypto registry or MCP tool semantics.
 // All hooks delegate to the original implementations and are restored.
 const cryptoTrace=[];
 const recordPhase=(phase)=>{if(cryptoTrace.length<24)cryptoTrace.push(phase);};
 const originalSelect=TrustedEffectStagingTaskRegistry.prototype.selectFor;
 const originalChallenge=PrivateMcpTaskRegistry.prototype.stageGatewayChallenge;
 const originalCryptoInvoke=PrivateMcpTaskRegistry.prototype.invokeCrypto;
 const originalProofTake=PrivateMcpTaskRegistry.prototype.takeSignedPresentation;
 const originalCreate=DelegationEvidenceHandler.prototype.createPresentation;
 TrustedEffectStagingTaskRegistry.prototype.selectFor=function(context){
  const port=originalSelect.call(this,context);
  if(context?.role!=="backend")return port;
  recordPhase("agent_port_selected");
  return Object.freeze({...port,
   stage:async requestId=>{
    recordPhase("agent_stage_entered");
    try{
     const result=await port.stage(requestId);
     recordPhase("agent_stage_ack_ok");return result;
    }catch(error){recordPhase("agent_stage_ack_rejected");throw error;}
   },
   ...(typeof port.attest==="function"?{
    attest:async(requestId,tool)=>port.attest(requestId,tool)
   }:{})
  });
 };
 PrivateMcpTaskRegistry.prototype.stageGatewayChallenge=function(taskId,prepared){
  recordPhase("crypto_challenge_entered");
  try{
   const result=originalChallenge.call(this,taskId,prepared);
   recordPhase("crypto_challenge_registered");return result;
  }catch(error){recordPhase("crypto_challenge_rejected");throw error;}
 };
 PrivateMcpTaskRegistry.prototype.invokeCrypto=async function(...args){
  recordPhase("mcp_crypto_invoke_entered");
  try{
   const result=await originalCryptoInvoke.apply(this,args);
   recordPhase("mcp_crypto_invoke_ok");return result;
  }catch(error){recordPhase("mcp_crypto_invoke_rejected");throw error;}
 };
 PrivateMcpTaskRegistry.prototype.takeSignedPresentation=function(...args){
  recordPhase("crypto_proof_take_entered");
  try{
   const result=originalProofTake.apply(this,args);
   recordPhase("crypto_proof_taken");return result;
  }catch(error){recordPhase("crypto_proof_take_rejected");throw error;}
 };
 DelegationEvidenceHandler.prototype.createPresentation=async function(prepared){
  recordPhase("private_rust_presentation_entered");
  try{
   const result=await originalCreate.call(this,prepared);
   recordPhase("private_rust_presentation_signed");return result;
  }catch(error){recordPhase("private_rust_presentation_denied");throw error;}
 };
 let owner;
 try{
  for(const role of roles){
   const stageSocket=path("stage-"+role+".sock");
   const stageSecret=path("stage-"+role+".hex");
   const bindingSocket=path("bind-"+role+".sock");
   const bindingSecret=path("bind-"+role+".hex");
   for(const secretFile of [stageSecret,bindingSecret])
    await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
   stageChannels[role]={socketPath:stageSocket,secretFile:stageSecret};
   agentBindingChannels[role]={socketPath:bindingSocket,
    secretFile:bindingSecret};
   const registry=new TrustedEffectStagingTaskRegistry();
   registries[role]=registry;
   const stageClient=await connectTrustedOwnerEffectStagingClient({
    socketPath:stageSocket,secretFile:stageSecret
   });
   const binder=await createTrustedEffectAgentBindingServer({
    socketPath:bindingSocket,secretFile:bindingSecret,
    registry,ownerStageClient:stageClient,expectedRole:role
   });
   bindingServers.push(binder);await binder.start();
  }
  const gatewayTransport=async(url,init)=>{
   const body=JSON.parse(String(init?.body));
   if(String(url).endsWith("/v1/authorization/prepare")){
    events.push("prepare_attempt_"+body.agent_role+"_"+body.tool);
    let response;
    try{
     response=prepareAuthorization(body,{
      audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo
     },{store,audit,authorityOnlyAdmissions:gate,nowMs});
    }catch(error){
     process.stderr.write(JSON.stringify({
      event:"r364_safe_gateway_prepare_rejection",
      role:body.agent_role,tool:body.tool,
      reason_class:error?.constructor?.name??"unknown",
      reason_code:typeof error?.code==="string"?error.code:null
     })+"\n");
     throw error;
    }
    prepared.push({role:body.agent_role,tool:body.tool,response});
    events.push("prepare_"+body.agent_role+"_"+body.tool);
    return Response.json(response,{status:201});
   }
   if(String(url).endsWith("/v1/authorization/execute")){
    const record=store.get(body.request_id);
    const tool=record?.request?.tool,role=record?.request?.agent_role;
    if(!["read_file","update_file"].includes(tool)||
       !["backend","frontend"].includes(role))
     throw Error("unrecognized role or native Gateway effect");
    events.push("execute_"+role+"_"+tool);
    try{return Response.json(await executeAuthorization(body,deps),{status:200});}
    catch(error){
     process.stderr.write("R364 denied "+role+" "+tool+": "+
      (error?.constructor?.name??"UnknownError")+"\n");
     return Response.json({error:"native_authorization_denied"},{status:403});
    }
   }
   throw Error("unrecognized Gateway route");
  };
  for(const role of roles){
   const opts={role,host:"127.0.0.1",port:await freeRolePort(),
    capabilityProfile:"approved-plan",delegatedAuthorization:true};
   if(role!=="test"){
    const keys=generateKeyPairSync("ed25519");
    opts.mcpTaskSigning={
     signingPrivateKeyPem:keys.privateKey.export({
      type:"pkcs8",format:"pem"}).toString(),
     signingPublicKeyPem:keys.publicKey.export({
      type:"spki",format:"pem"}).toString()
    };
    opts.adk={
     model:models[role],gatewayBaseUrl:"http://gateway.fixture.invalid",
     adapterToken:tokens[role],maxModelTurns:4,maxModelCallMs:15000,
     gatewayTimeoutMs:60000,scopeModelPaths:true,
     trustedEffectTaskRegistry:registries[role],fetchFn:gatewayTransport
    };
   }
   const server=await startSpecializedAgentServer(opts);
   roleServers.push(server);urls[role]=server.baseUrl;
  }
  owner=await startTrustedAuthorityOnlySdkA2AOwner({
   coordinator,childIssuer:issuer,gateway:gate,
   stageChannels,agentBindingChannels,agentBaseUrls:urls,
   a2aPolling:{deadlineMs:120000,initialIntervalMs:40,maxIntervalMs:250}
  });
  assert.equal(models.backend.requests.length,0);
  assert.equal(models.frontend.requests.length,0);
  // Check the original same-Task Gateway preflight without preparing/signing
  // a second request. Does not authorize or execute any provider operation.
  assert.equal(gate.preflightCanonicalRequest({
   task_id:backendRuntimeId,agent_role:"backend",tool:"read_file",
   arguments:{branch,path:backendPath}
  }).pinned_revision,baseRevision);
  assert.equal(gate.stagedCompletedTaskCount,0);
  let backendReport;
  try{
   backendReport=await owner.dispatchIssuedTask({
    taskId:backendTaskId,runtimeTaskId:backendRuntimeId,
    instruction:"Read and CAS-update only the signed Backend account source",
    effectStager:backendStager
   });
  }catch(error){
   // R364.6: after terminal A2A failure, independently probe the SAME
   // private Rust signer with the original Gateway challenge, WITHOUT
   // executing any provider call. Discard signed bytes. Return only enums.
   const firstRead=prepared.find(p=>p.role==="backend"&&
    p.tool==="read_file")?.response;
   let privateSignerProbe="not_prepared";
   if(firstRead){
    try{
     const signed=await invokeNativeCrypto({
      socketPath,token:tokens.backend,timeoutMs:60000
     },"create_presentation",{
      credential_id:backendChild.credential_id,
      disclosed_permissions:[firstRead.required_permission],
      audience:firstRead.audience,challenge:firstRead.challenge
     });
     privateSignerProbe=typeof signed?.signed_vp==="string"?
      "signed_without_provider_io":"malformed_native_result";
    }catch(signError){
     const message=String(signError?.message??"");
     privateSignerProbe=message.includes("authorization denied")?
      "native_authorization_denied":message.includes("transport unavailable")?
      "native_transport_unavailable":"native_sign_error";
    }
   }
   // No challenge, VP, credential ID, signer key or source contents in logs.
   process.stderr.write(JSON.stringify({
    event:"r364_backend_failure_stage_diagnostic",
    private_signer_probe:privateSignerProbe,
    prepared_exact_permission:!!firstRead&&
     JSON.stringify(firstRead.required_permission)===
     JSON.stringify(backendReadPermission),
    prepared_expires_in_future:!!firstRead&&
     Date.parse(firstRead.expires_at)>Date.now(),
    gateway_routes:events.slice(0,8),
    prepared_tools:prepared.map(p=>p.role+"."+p.tool),
    backend_model_turns:models.backend.requests.length,
    gateway_completed_tasks:gate.stagedCompletedTaskCount,
    gateway_sequential_tasks:gate.stagedSequentialTaskCount,
    backend_stage_events:backendStageEvents,
    private_crypto_phase_trace:cryptoTrace,
    error_class:error?.constructor?.name??"unknown"
   })+"\n");
   throw error;
  }
  assert.equal(backendReport.status,"a2a_report_not_gateway_completed");
  assert.equal(backendReport.provider_completion_attested,false);
  assert.equal(backendReport.role,"backend");
  assert.deepEqual(backendReport.artifact.files_modified,[backendPath]);
  assert.equal(models.backend.requests.length,3);
  assert.equal(models.frontend.requests.length,0);
  assert.equal(gatewayCasWrites,1);
  const backendHead=backendReport.artifact.commit_sha;
  assert.match(backendHead,/^[a-f0-9]{40}$/u);
  assert.notEqual(backendHead,baseRevision);
  assert.equal((await independentClient.readTextFile(
   branch,backendPath,backendHead)).content,backendNewContent);
  assert.equal((await independentClient.readTextFile(
   branch,mutationPath,backendHead)).content,oldContent);
  const backendConfirmed=await owner.attestIndependentGatewayCompletion(
   backendTaskId,backendRuntimeId
  );
  assert.equal(backendConfirmed.status,"owner_gateway_completion_independently_observed");
  assert.equal(gate.assertTrustedCompletedSequentialReadUpdateTask(
   backendTaskId,backendRuntimeId).status,"sequential_read_update_task_completed_staged");
  assert.equal(gate.stagedCompletedTaskCount,1);
  // Original root and Task grant do not change. The successor's Child is
  // generated and Gateway-enrolled only AFTER independent Backend evidence.
  child=await issuer.issueForRegisteredTask(taskId,
   params("urn:r364:child:frontend",29104,600));
  assert.notEqual(backendChild.credential_id,child.credential_id);
  assert.equal(child.gateway_execution_authorized,false);
  assert.equal(child.root_credential_id,operational.credential_id);
  assert.deepEqual(child.permissions,taskPermissions);
  const enrolled=await gate.enrollTrustedIssuedChild(
   taskId,runtimeTaskId,issuer);
  assert.equal(enrolled.credential_id,child.credential_id);
  assert.equal(enrolled.gateway_execution_authorized,false);
  // The predecessor's actual Gitea commit is the ONLY new Frontend HEAD.
  const frontendStager=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
   store,admissions:gate,mutation:preflight,mutationObserver:observer,
   planTaskId:taskId,runtimeTaskId,expectedHeadSha:backendHead
  });
  assert.equal(frontendStager.stagedTool,"read_then_update");
  assert.equal(gate.stagedSequentialTaskCount,2);
  // Reject both cross-role impersonation and access to the other source.
  assert.throws(()=>gate.preflightCanonicalRequest({
   task_id:runtimeTaskId,agent_role:"frontend",tool:"read_file",
   arguments:{branch,path:backendPath}
  }));
  assert.throws(()=>gate.preflightCanonicalRequest({
   task_id:backendRuntimeId,agent_role:"backend",tool:"update_file",
   arguments:{branch,path:mutationPath,content:newContent}
  }));
  const frontendReport=await owner.dispatchIssuedTask({
   taskId,runtimeTaskId,
   instruction:"Read and CAS-update Frontend after independently completed Backend",
   effectStager:frontendStager
  });
  assert.equal(frontendReport.status,"a2a_report_not_gateway_completed");
  assert.equal(frontendReport.provider_completion_attested,false);
  assert.equal(frontendReport.role,"frontend");
  assert.deepEqual(frontendReport.artifact.files_modified,[mutationPath]);
  assert.equal(models.frontend.requests.length,3);
  assert.equal(gatewayCasWrites,2);
  assert.equal(legacyWriteCalls,0);
  const frontendHead=frontendReport.artifact.commit_sha;
  assert.match(frontendHead,/^[a-f0-9]{40}$/u);
  assert.notEqual(frontendHead,backendHead);
  assert.equal((await independentClient.readTextFile(
   branch,backendPath,frontendHead)).content,backendNewContent);
  assert.equal((await independentClient.readTextFile(
   branch,mutationPath,frontendHead)).content,newContent);
  assert.deepEqual(prepared.map(p=>[p.role,p.tool]),[
   ["backend","read_file"],["backend","update_file"],
   ["frontend","read_file"],["frontend","update_file"]
  ]);
  assert.equal(new Set(prepared.map(p=>p.response.request_id)).size,4);
  for(const p of prepared)
   assert.equal(store.get(p.response.request_id).pinned_revision,
    p.role==="backend"?baseRevision:backendHead);
  assert.deepEqual(events,[
   "prepare_backend_read_file","execute_backend_read_file",
   "prepare_backend_update_file","execute_backend_update_file",
   "prepare_frontend_read_file","execute_frontend_read_file",
   "prepare_frontend_update_file","execute_frontend_update_file"
  ]);
  const frontendConfirmed=await owner.attestIndependentGatewayCompletion(
   taskId,runtimeTaskId
  );
  assert.equal(frontendConfirmed.status,"owner_gateway_completion_independently_observed");
  assert.equal(gate.stagedCompletedTaskCount,2);
  assert.equal(gate.assertTrustedCompletedSequentialReadUpdateTask(
   taskId,runtimeTaskId).status,"sequential_read_update_task_completed_staged");
  await assert.rejects(owner.attestIndependentGatewayCompletion(
   taskId,runtimeTaskId),/closed or repeated independent completion/u);
  for(const [index,role,permission] of [
   [1,"backend",backendUpdatePermission],[3,"frontend",updatePermission]
  ]){
   const request=prepared[index].response;
   const signed=await invokeNativeCrypto({
    socketPath,token:tokens[role],timeoutMs:60000
   },"create_presentation",{
    credential_id:role==="backend"?backendChild.credential_id:child.credential_id,
    disclosed_permissions:[permission],audience:request.audience,
    challenge:request.challenge
   });
   await assert.rejects(executeAuthorization({
    request_id:request.request_id,signed_vp:signed.signed_vp
   },deps),err=>err?.code==="replay_detected");
  }
  assert.equal(gatewayCasWrites,2);
  for(const role of ["backend","frontend"]){
   const prompts=JSON.stringify(models[role].requests);
   for(const forbidden of [tokens[role],backendChild.credential_id,
    child.credential_id,operational.credential_id,
    process.env["ADAPTER_EVM_PRIVATE_KEY_"+role.toUpperCase()]
   ].filter(Boolean))assert.equal(prompts.includes(forbidden),false);
  }
 }finally{
  TrustedEffectStagingTaskRegistry.prototype.selectFor=originalSelect;
  PrivateMcpTaskRegistry.prototype.stageGatewayChallenge=originalChallenge;
  PrivateMcpTaskRegistry.prototype.invokeCrypto=originalCryptoInvoke;
  PrivateMcpTaskRegistry.prototype.takeSignedPresentation=originalProofTake;
  DelegationEvidenceHandler.prototype.createPresentation=originalCreate;
  const results=await Promise.allSettled([
   owner?.close(),...bindingServers.reverse().map(b=>b.close()),
   ...roleServers.reverse().map(s=>s.close())
  ]);
  for(const result of results)
   if(result.status==="rejected")throw result.reason;
 }
 const pending=prepare("read_file"),pendingVp=await sign(pending,readPermission);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"frontend",audience:pending.audience,challenge:pending.challenge,
  required_permission:readPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(gatewayCasWrites,2);
 process.stdout.write(JSON.stringify({
  event:"r364_native_dependent_backend_frontend_sdk_a2a_adk",
  engineer_directory_scopes:4,task_leaf_permissions:4,
  native_engineer_root:true,native_child_ipc:true,
  independently_verified_rust_evm:true,real_opa:true,
  read_and_cas_evidence_attested:true,task_finalized:true,
  actual_agent_gateway_client:true,real_hmac_owner_and_agent_ipc:true,
  prebound_coordinator_and_native_child:true,remote_a2a_transport:true,
  google_adk_scripted_model:true,paid_inference:false,
  frontend_child_cannot_read_backend_source:true,
  backend_child_cannot_update_frontend_source:true,
  independently_completed_predecessor_gate:true,
  backend_to_frontend_head_rollover:true,
  two_native_children_one_engineer_root:true,
  gateway_atomic_update_calls:gatewayCasWrites,
  legacy_writes:legacyWriteCalls,paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
