/** R367.2 — free model-selected native Backend → Frontend → Test.
 * Original Rust/EVM, OPA, Gitea CAS and Docker; no pre-registered Tasks.
 * Scripted ADK model and disposable fixture, not generative Gemini proof.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {BaseLlm} from "@google/adk";
import {runTrustedAuthorityOnlyAdaptiveWorkLoop}
 from "../src/trusted-authority-only-adaptive-work-loop.mjs";
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

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
import {DurableAuthorityOnlyTaskFenceJournal}
 from "../src/trusted-authority-only-task-fence-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver}
 from "../src/trusted-authority-only-completion-observer.ts";
import {TrustedAuthorityOnlyRunnerPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-runner-preflight.ts";
import {DurableAuthorityOnlyRunnerIntentJournal}
 from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyRunnerExecutor}
 from "../../../apps/gateway/src/trusted-authority-only-runner-executor.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,
 AuthenticatedRunnerCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-evidence.ts";
import {RunnerClient} from "../../../apps/gateway/src/runner-client.ts";
import {TrustedAuthorityOnlyEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-effect-stager.ts";
import {IsolatedDockerRunnerExecutor}
 from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer}
 from "../../../apps/test-runner-controller/src/http.ts";
import {stageDisposableAccountSuspensionReference}
 from "../../../apps/test-runner-controller/scripts/stage-disposable-account-suspension-reference.mjs";
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
import {LocalCryptoMcpBridge}
 from "../../agent-runtime/src/local-crypto-mcp-bridge.ts";
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
const tokens=Object.fromEntries(["ENGINEER","ORCHESTRATOR","BACKEND","FRONTEND","TEST","GATEWAY"].map(role=>{
 const token=process.env["ADAPTER_CALLER_"+role];
 assert.ok(token,role+" private native bearer missing");
 return [role.toLowerCase(),token];
}));
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
const frontendDid=process.env.ADAPTER_ID_FRONTEND;
const backendDid=process.env.ADAPTER_ID_BACKEND;
const testDid=process.env.ADAPTER_ID_TEST;
assert.match(engineerDid??"",/^did:/u);
assert.match(frontendDid??"",/^did:/u);
assert.match(backendDid??"",/^did:/u);
assert.match(testDid??"",/^did:/u);
const sessionId="r367-authority-native-e2e";
class ScriptedReadThenCas extends BaseLlm {
 constructor(branch,path,oldContent,newContent){
  super({model:"r367-local-adk-read-then-cas-no-paid-inference"});
  this.branch=branch;this.path=path;
  this.oldContent=oldContent;this.newContent=newContent;
  this.requests=[];
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const turn=this.requests.length;
  if(turn===1){
   yield {content:{role:"model",parts:[{functionCall:{
    name:"read_file",id:"r367-read",args:{
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
    throw Error("R367 scripted ADK did not observe authenticated source bytes");
   yield {content:{role:"model",parts:[{functionCall:{
    name:"update_file",id:"r367-update",args:{
     branch:this.branch,path:this.path,content:this.newContent
    }
   }}]}};
  }else if(turn===3){
   yield {content:{role:"model",parts:[{
    text:"Native source read and CAS update completed"
   }]}};
  }else{
   throw Error("R367 unexpected ADK turn beyond the signed two-effect Task");
  }
 }
 connect(){return Promise.reject(Error("Paid model connections disabled in R367"));}
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
class ScriptedNativeDockerTest extends BaseLlm {
 constructor(branch){
  super({model:"r367-local-adk-docker-test-no-paid-inference"});
  this.branch=branch;this.requests=[];
 }
 async *generateContentAsync(req){
  this.requests.push(req);
  if(this.requests.length===1){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r367-docker-test",name:"run_tests",
    args:{branch:this.branch,profile:"poc-default"}
   }}]}};
  }else if(this.requests.length===2){
   yield {content:{role:"model",parts:[{
    text:"Completed one native Test against owner-pinned Gitea HEAD"
   }]}};
  }else throw Error("R367 Docker Test model generated extra tool turns");
 }
 connect(){return Promise.reject(Error("Paid model connections prohibited"));}
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
const disposableMainHead=(await client.getBranchMetadata("main")).commit_sha;
// CI owner only: seed fully working Account Suspension reference BEFORE
// signing. No ADK agent can create/change any fixture outside its own Child.
const functionalFixture=await stageDisposableAccountSuspensionReference({
 gitea:client,branch
});
assert.equal(functionalFixture.engineer_approved,false);
assert.equal(functionalFixture.delegated_agent_writes,0);
const backendPath="apps/backend/users/account.ts";
const mutationPath="apps/frontend/src/account/AccountSuspension.ts";
const backendOldContent="export const backendAccountSuspended = false;\n";
const backendNewContent="export const backendAccountSuspended = true;\n";
const oldContent="export const accountSuspended = false;\n";
const newContent="export const accountSuspended = true;\n";
// Owner-only disposable CI fixture, created BEFORE the Engineer root.
// No delegated write or Docker provider effect is enabled.
const backendSeed=await client.createFile(branch,backendPath,backendOldContent,
 "R367 owner-only disposable Backend fixture");
const seeded=await client.createFile(branch,mutationPath,oldContent,
 "R367 owner-only disposable Frontend fixture");
const baseRevision=seeded.commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
const requirement="R367 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const testPermission={resource:resourcePrefix,operation:"run_tests"};
// Signed grant canonicalization orders shorter branch-level Test authority
// before longer exact role-directory grants. Preserve the SAME five grants.
const grantPermissions=[
 testPermission,
 ...["backend","frontend"].flatMap(role=>
  ["read_file","update_file"].map(operation=>({
   resource:resourcePrefix+"/directories/apps/"+role,operation
  })))
];
assert.equal(grantPermissions.length,5);
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
const authKey="r367-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r367-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents",
 "sequences","flights","intent","receipts",
 "runner-intent","runner-receipts","runner-logs"];
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
  statusListCredential:"https://status.example/r367"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r367:preliminary",29101,360);
 const operational=params("urn:r367:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,grantPermissions);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{
   backend:{did:backendDid,card_ref:"trusted:r367-backend",
    capabilities:["read_file","update_file"]},
   frontend:{did:frontendDid,card_ref:"trusted:r367-frontend",
    capabilities:["read_file","update_file"]},
   test:{did:testDid,card_ref:"trusted:r367-test",
    capabilities:["run_tests"]}
  },nowMs
 });
 await coordinator.activate();
 const taskId="r367-frontend-task",runtimeTaskId="dispatch_"+"F".repeat(22);
 const backendTaskId="r367-backend-task",backendRuntimeId="dispatch_"+"B".repeat(22);
 const testTaskId="r367-test-task",testRuntimeId="dispatch_"+"T".repeat(22);
 const requirementSha=createHash("sha256").update(requirement).digest("hex");
 assert.ok(socketPath.startsWith("/"));
 const nativePort=createNativeRustChildCryptographyPort({
  bearerToken:tokens.orchestrator,timeoutMs:60000
 },socketPath);
 const issuer=new TrustedAuthorityOnlyChildIssuer({
  coordinator,nativeCryptoPort:nativePort,
  journal:new DurableAuthorityOnlyChildJournal(path("child-intents")),
  nowMs
 });
 let backendChild;
 // Dependent Frontend Child is issued only when the native Backend finishes:
 // do not activate a future Task's signer before independent predecessors.
 let child;
 assert.deepEqual(approved.permissions,grantPermissions);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const readObserver=new AuthenticatedGiteaReadCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,
  giteaClient:independentClient,nowMs
 });
 const runnerObserver=new AuthenticatedRunnerCompletionObserver({
  directory:path("runner-receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,
  giteaClient:independentClient,nowMs
 });
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(path("sequences")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:expected=>expected.task_id===testTaskId?
    runnerObserver.observe(expected):readObserver.observe(expected)
  }),nowMs
 });
 await gate.activate(sessionId,baseRevision);
 assert.equal(coordinator.registeredTaskCount,0);
 assert.equal(gate.stagedCompletedTaskCount,0);
 assert.throws(()=>gate.preflightCanonicalRequest({
  task_id:testRuntimeId,agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"}
 }));
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
 // Separate native Test Runner path, bound to the SAME trusted Gateway.
 // It makes no provider call until native Rust VP and real OPA both allow.
 const runnerJournal=new DurableAuthorityOnlyRunnerIntentJournal(
  path("runner-intent"));
 const runnerPreflight=new TrustedAuthorityOnlyRunnerPreflight({
  admissions:gate,giteaClient:client,journal:runnerJournal,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const runnerBearer=randomBytes(32).toString("hex");
 const controller=new IsolatedDockerRunnerExecutor({
  gitea_base_url:process.env.GITEA_RUNNER_BASE_URL,
  gitea_owner:"thesis",gitea_repository:"iam-console-poc",
  gitea_token:process.env.GITEA_RUNNER_TOKEN,
  docker_image:"node:22.15.0-bookworm",
  phase_timeout_ms:600000,total_timeout_ms:840000,
  log_dir:path("runner-logs"),acceptance_enabled:true,
  acceptance_dir:fileURLToPath(
   new URL("../../../runner/acceptance/",import.meta.url))
 });
 let runnerServer=createRunnerHttpServer({
  bind_host:"127.0.0.1",bind_port:0,gateway_token:runnerBearer,
  contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",branch}
 },controller);
 await new Promise((ok,bad)=>{
  runnerServer.once("error",bad);runnerServer.listen(0,"127.0.0.1",ok);
 });
 const address=runnerServer.address();
 assert.ok(address&&typeof address!=="string");
 let runnerCalls=0;
 class ObservedRunnerClient extends RunnerClient{
  async run(request,signal){
   runnerCalls++;
   const result=await super.run(request,signal);
   process.stdout.write(JSON.stringify({
    event:"r367_runner_sanitized_result",
    status:result.status,
    project_status:result.project_tests?.status??null,
    acceptance_status:result.researcher_acceptance?.status??null,
    head_matches:result.tested_commit_sha===request.commit_sha
   })+"\n");
   return result;
  }
 }
 const runnerClient=new ObservedRunnerClient({
  baseUrl:"http://127.0.0.1:"+address.port,
  gatewayToken:runnerBearer,timeoutMs:900000
 });
 const runnerExecutor=new TrustedAuthorityOnlyRunnerExecutor({
  admissions:gate,preflight:runnerPreflight,
  journal:runnerJournal,giteaClient:client,runnerClient,
  publisher:new TrustedGatewayRunnerPassEvidencePublisher({
   directory:path("runner-receipts"),key:evidenceKey,
   runnerClient,independentGiteaClient:independentClient,
   repository:"thesis/iam-console-poc",branch,nowMs
  }),observer:runnerObserver,
  repository:"thesis/iam-console-poc",branch
 });
 const readPublisher=new TrustedGatewayGiteaReadEvidencePublisher({
  directory:path("receipts"),key:evidenceKey,admissions:gate,
  // Authenticated read-only client is independent from the Gateway writer.
  independentGiteaClient:independentClient,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const backendStageEvents=[];
 const prepareBackendStager=async()=>{
 const backendStager=await TrustedAuthorityOnlySequentialReadUpdateStager.begin({
  store,admissions:gate,mutation:preflight,mutationObserver:observer,
  planTaskId:backendTaskId,runtimeTaskId:backendRuntimeId,
  expectedHeadSha:baseRevision
 });
 assert.equal(backendStager.stagedTool,"read_then_update");
 // R367.4: owner-private, test-only stage observation. This instruments the
 // original native stager INSTANCE (not a proxy), preserving Rust/Gateway
 // identity and exact signed Task pins. Export only fixed safe classifications.
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

  assert.equal(gate.stagedSequentialTaskCount,1);
  return backendStager;
 };
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:readPublisher,
  authorityOnlyMutationEnabled:true,authorityOnlyMutationExecutor:mutationExecutor,
  authorityOnlyRunnerEnabled:true,authorityOnlyRunnerExecutor:runnerExecutor};
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
 // R367: three distinct pairs of role-pinned HMAC IPC channels; separate
 // agent registries and signing keys, but one original native Engineer root.
 const roles=["backend","frontend","test"],stageChannels={},agentBindingChannels={};
 const registries={},bindingServers=[],roleServers=[],urls={},events=[],prepared=[];
 const models={
  backend:new ScriptedReadThenCas(branch,backendPath,
   backendOldContent,backendNewContent),
  frontend:new ScriptedReadThenCas(branch,mutationPath,oldContent,newContent),
  test:new ScriptedNativeDockerTest(branch)
 };
 // R367.7 diagnostic: observe internal phase ACKs without changing the
 // actual owner Stager, signed Task, crypto registry or MCP tool semantics.
 // All hooks delegate to the original implementations and are restored.
 const cryptoTrace=[];
 const recordPhase=(phase)=>{if(cryptoTrace.length<24)cryptoTrace.push(phase);};
 const originalSelect=TrustedEffectStagingTaskRegistry.prototype.selectFor;
 const originalChallenge=PrivateMcpTaskRegistry.prototype.stageGatewayChallenge;
 const originalCryptoInvoke=PrivateMcpTaskRegistry.prototype.invokeCrypto;
 const originalProofTake=PrivateMcpTaskRegistry.prototype.takeSignedPresentation;
 const originalCreate=DelegationEvidenceHandler.prototype.createPresentation;
 const originalMcpBridge=LocalCryptoMcpBridge.prototype.createSignedPresentation;
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
 LocalCryptoMcpBridge.prototype.createSignedPresentation=async function(prepared){
  recordPhase("mcp_bridge_presentation_entered");
  try{
   const signed=await originalMcpBridge.call(this,prepared);
   recordPhase(typeof signed==="string"&&signed.length>0?
    "mcp_bridge_returned_signed_string":"mcp_bridge_returned_invalid_type");
   return signed;
  }catch(error){
   recordPhase("mcp_bridge_presentation_rejected");throw error;
  }
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
  let testSignedVp=null;
  const gatewayTransport=async(url,init)=>{
   // Same original Gateway implementation. Observe the transport entry
   // BEFORE parsing or touching a signed VP; classify only the route.
   recordPhase(String(url).endsWith("/v1/authorization/execute")?
    "gateway_execute_transport_entered":
    String(url).endsWith("/v1/authorization/prepare")?
     "gateway_prepare_transport_entered":"gateway_unexpected_transport");
   const body=JSON.parse(String(init?.body));
   if(String(url).endsWith("/v1/authorization/prepare")){
    events.push("prepare_attempt_"+body.agent_role+"_"+body.tool);
    let response;
    try{
     response=prepareAuthorization(body,{
      audience:"cloud-access-gateway",request_ttl_ms:body.agent_role==="test"?1_200_000:120000,
      repository:repo
     },{store,audit,authorityOnlyAdmissions:gate,nowMs});
    }catch(error){
     process.stderr.write(JSON.stringify({
      event:"r367_safe_gateway_prepare_rejection",
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
    // PreparedRequestRecord stores the role on its TOP-LEVEL envelope.
// Reading record.request.agent_role incorrectly treats every native execute
// as unknown, masking successful owner IPC and VP as tool_unavailable.
const tool=record?.request?.tool,role=record?.agent_role;
    if(!["read_file","update_file","run_tests"].includes(tool)||
       !["backend","frontend","test"].includes(role))
     throw Error("unrecognized role or native Gateway effect");
    events.push("execute_"+role+"_"+tool);
    if(role==="test")testSignedVp=body.signed_vp;
    try{return Response.json(await executeAuthorization(body,deps),{status:200});}
    catch(error){
     process.stderr.write("R367 denied "+role+" "+tool+": "+
      (error?.constructor?.name??"UnknownError")+"\n");
     return Response.json({error:"native_authorization_denied"},{status:403});
    }
   }
   throw Error("unrecognized Gateway route");
  };
  for(const role of roles){
   const opts={role,host:"127.0.0.1",port:await freeRolePort(),
    capabilityProfile:"approved-plan",delegatedAuthorization:true};
   if(["backend","frontend","test"].includes(role)){
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
     gatewayTimeoutMs:role==="test"?900000:60000,scopeModelPaths:true,
     trustedEffectTaskRegistry:registries[role],fetchFn:gatewayTransport
    };
   }
   const server=await startSpecializedAgentServer(opts);
   roleServers.push(server);urls[role]=server.baseUrl;
  }
  owner=await startTrustedAuthorityOnlySdkA2AOwner({
   coordinator,childIssuer:issuer,gateway:gate,
   stageChannels,agentBindingChannels,agentBaseUrls:urls,
   a2aPolling:{deadlineMs:960000,initialIntervalMs:40,maxIntervalMs:1000}
  });
  assert.equal(models.backend.requests.length,0);
  assert.equal(models.frontend.requests.length,0);
  // R367.2 no registered Task nor native Child before this real SDK
  // owner starts. Every subsequent step is selected by ADK and independently
  // completed before another model turn.
  assert.equal(coordinator.registeredTaskCount,0);
  let backendHead,frontendHead,verifiedRunnerBinding;
  const attested=[];
  const choices=[
   {action:"delegate",task:{
    task_id:backendTaskId,agent_id:"backend",depends_on:[],
    permissions:backendPermissions,
    instruction:"Read then CAS-update Backend account source within granted scope"}},
   {action:"delegate",task:{
    task_id:taskId,agent_id:"frontend",depends_on:[backendTaskId],
    permissions:taskPermissions,
    instruction:"Read then CAS-update Frontend after verified Backend"}},
   {action:"delegate",task:{
    task_id:testTaskId,agent_id:"test",depends_on:[taskId],
    permissions:[testPermission],
    instruction:"Run pinned Docker suite and acceptance on latest verified HEAD"}},
   {action:"ready_for_pr",reason:"Independent latest Docker PASS confirmed by owner"}
  ];
  class FreeAdaptiveDecisionModel extends BaseLlm{
   constructor(){super({model:"r367-scripted-adaptive-owner-no-paid-model"});this.calls=0;this.requests=[];}
   async *generateContentAsync(request){
    const turn=this.calls++;
    assert.ok(turn<choices.length,"model decision exceeds four-turn test budget");
    this.requests.push(request);
    if(turn>0)assert.ok(JSON.stringify(request).includes(choices[turn-1].task.task_id),
     "next ADK decision cannot hide its independently verified predecessor");
    yield {content:{role:"model",parts:[{text:JSON.stringify(choices[turn])}]}};
   }
   connect(){throw Error("Paid streaming/model disabled");}
  }
  const adaptiveModel=new FreeAdaptiveDecisionModel();
  const modelLedger=[];
  const observeOwner=async()=>{
   const live=coordinator.assertTrustedGatewayAuthorityBinding();
   assert.equal(live.root_credential_id,operational.credential_id);
   assert.equal(live.branch,branch);
   assert.equal(gate.stagedCompletedTaskCount,attested.length);
   const head=(await independentClient.getBranchMetadata(branch)).commit_sha;
   return {
    requirement,branch,rootPermissions:grantPermissions,
    agents:{
     backend:{capabilities:["read_file","update_file"]},
     frontend:{capabilities:["read_file","update_file"]},
     test:{capabilities:["run_tests"]}
    },
    previousTasks:attested.map(p=>({task_id:p.task_id,agent_id:p.agent_id})),
    nextEpoch:coordinator.registeredTaskCount+1,
    executionProgress:{current_head_sha:head,
     completed_work:attested.map(p=>({...p}))}
   };
  };
  const observedEpochs=[];
  const nativeResult=await runTrustedAuthorityOnlyAdaptiveWorkLoop({
   model:adaptiveModel,maxSteps:4,
   hooks:{
    readContext:observeOwner,
    beforeDecision:async()=>{
     assert.equal(coordinator.registeredTaskCount,attested.length,
      "no next ADK choice while a native Task is not independently completed");
     observedEpochs.push(gate.stagedCompletedTaskCount);
    },
    executeTask:async(choice,context)=>{
     const slots={
      backend:{id:backendTaskId,runtime:backendRuntimeId},
      frontend:{id:taskId,runtime:runtimeTaskId},
      test:{id:testTaskId,runtime:testRuntimeId}
     };
     const slot=slots[choice.agent_id];
     assert.ok(slot,"unknown specialist");
     assert.equal(choice.task_id,slot.id);
     assert.equal(coordinator.registeredTaskCount,context.nextEpoch-1);
     assert.equal(gate.stagedCompletedTaskCount,attested.length);
     assert.equal((await independentClient.getBranchMetadata(branch)).commit_sha,
      context.executionProgress.current_head_sha);
     const registered=await coordinator.registerTask({
      session_id:sessionId,requirement_sha256:requirementSha,
      base_revision:baseRevision,branch,task_id:choice.task_id,
      epoch:context.nextEpoch,agent_id:choice.agent_id,
      depends_on:choice.depends_on,permissions:choice.permissions
     });
     assert.equal(registered.task_id,choice.task_id);
     if(choice.agent_id==="backend"){
      await gate.bindTrustedTask(backendTaskId,backendRuntimeId,"backend");
      backendChild=await issuer.issueForRegisteredTask(backendTaskId,
       params("urn:r367:child:backend",29103,600));
      assert.equal(backendChild.gateway_execution_authorized,false);
      assert.equal(backendChild.root_credential_id,operational.credential_id);
      assert.deepEqual(backendChild.permissions,backendPermissions);
      const backendEnrolled=await gate.enrollTrustedIssuedChild(
       backendTaskId,backendRuntimeId,issuer);
      assert.equal(backendEnrolled.credential_id,backendChild.credential_id);
  // Check the original same-Task Gateway preflight without preparing/signing
  // a second request. Does not authorize or execute any provider operation.
  assert.equal(gate.preflightCanonicalRequest({
   task_id:backendRuntimeId,agent_role:"backend",tool:"read_file",
   arguments:{branch,path:backendPath}
  }).pinned_revision,baseRevision);
  assert.equal(gate.stagedCompletedTaskCount,0);
  const backendStager=await prepareBackendStager();
  let backendReport;
  try{
   backendReport=await owner.dispatchIssuedTask({
    taskId:backendTaskId,runtimeTaskId:backendRuntimeId,
    instruction:"Read and CAS-update only the signed Backend account source",
    effectStager:backendStager
   });
  }catch(error){
   // R367.6: after terminal A2A failure, independently probe the SAME
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
    event:"r367_backend_failure_stage_diagnostic",
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
  backendHead=backendReport.artifact.commit_sha;
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

     }else if(choice.agent_id==="frontend"){
      assert.deepEqual(attested.map(p=>p.task_id),[backendTaskId]);
  // Original root and Task grant do not change. The successor's Child is
  // generated and Gateway-enrolled only AFTER independent Backend evidence.
  await gate.bindTrustedTask(taskId,runtimeTaskId,"frontend");
  assert.throws(()=>gate.assertTrustedOwnerRemoteEffectBinding(taskId,runtimeTaskId));
  child=await issuer.issueForRegisteredTask(taskId,
   params("urn:r367:child:frontend",29104,600));
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
  frontendHead=frontendReport.artifact.commit_sha;
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
  // Each signed effect must generate precisely ONE Prepare attempt,
  // ONE canonical Prepare and ONE independently verified Execute.
  // Diagnostic events are asserted, not silently filtered or ignored.
  assert.deepEqual(events,[
   "prepare_attempt_backend_read_file",
   "prepare_backend_read_file","execute_backend_read_file",
   "prepare_attempt_backend_update_file",
   "prepare_backend_update_file","execute_backend_update_file",
   "prepare_attempt_frontend_read_file",
   "prepare_frontend_read_file","execute_frontend_read_file",
   "prepare_attempt_frontend_update_file",
   "prepare_frontend_update_file","execute_frontend_update_file"
  ]);
  const frontendConfirmed=await owner.attestIndependentGatewayCompletion(
   taskId,runtimeTaskId
  );
  assert.equal(frontendConfirmed.status,"owner_gateway_completion_independently_observed");
  assert.equal(gate.stagedCompletedTaskCount,2);
  assert.equal(gate.assertTrustedCompletedSequentialReadUpdateTask(
   taskId,runtimeTaskId).status,"sequential_read_update_task_completed_staged");

     }else if(choice.agent_id==="test"){
      assert.deepEqual(attested.map(p=>p.task_id),[backendTaskId,taskId]);
  // R367.1: only NOW may the original signed DAG's Test Child be issued.
  const runnerChild=await issuer.issueForRegisteredTask(testTaskId,
   params("urn:r367:child:test",29105,1200));
  assert.equal(runnerChild.agent_did,testDid);
  assert.equal(runnerChild.root_credential_id,operational.credential_id);
  assert.deepEqual(runnerChild.permissions,[testPermission]);
  assert.notEqual(runnerChild.credential_id,backendChild.credential_id);
  assert.notEqual(runnerChild.credential_id,child.credential_id);
  await gate.bindTrustedTask(testTaskId,testRuntimeId,"test");
  const enrolledTest=await gate.enrollTrustedIssuedChild(
   testTaskId,testRuntimeId,issuer);
  assert.equal(enrolledTest.credential_id,runnerChild.credential_id);
  assert.equal(gate.assertTrustedOwnerRemoteEffectBinding(
   testTaskId,testRuntimeId).agent_id,"test");
  assert.equal(runnerCalls,0,"Test Runner cannot start before Frontend attestation");
  // Original Child Test scope covers ONLY run_tests on this feature branch.
  assert.throws(()=>gate.preflightCanonicalRequest({
   task_id:testRuntimeId,agent_role:"test",tool:"read_file",
   arguments:{branch,path:backendPath}
  }));
  assert.throws(()=>gate.preflightCanonicalRequest({
   task_id:testRuntimeId,agent_role:"backend",tool:"run_tests",
   arguments:{branch,profile:"poc-default"}
  }));
  // A2A Test completion is NOT native authorization. The original
  // owner-only stager first reserves one immutable Runner intent at the
  // independently verified Frontend CAS HEAD, before Rust VP/OPA/Docker.
  assert.equal(models.test.requests.length,0);
  const nativeTestStager=new TrustedAuthorityOnlyEffectStager({
   store,admissions:gate,mutation:preflight,runner:runnerPreflight,
   runtimeTaskId:testRuntimeId,tool:"run_tests",expectedHeadSha:frontendHead
  });
  let testStaged;
  const testReport=await owner.dispatchIssuedTask({
   taskId:testTaskId,runtimeTaskId:testRuntimeId,
   instruction:"Run exact approved Docker suite against completed Frontend HEAD",
   effectStager:{stage:async requestId=>{
    testStaged=await nativeTestStager.stage(requestId);
    return testStaged;
   }}
  });
  assert.equal(testReport.status,"a2a_report_not_gateway_completed");
  assert.equal(testReport.provider_completion_attested,false);
  assert.equal(testReport.role,"test");
  assert.equal(testReport.artifact.test_outcome,"pass");
  assert.equal(testReport.artifact.commit_sha,frontendHead);
  assert.equal(testReport.artifact.tested_commit_sha,undefined);
  assert.equal(models.test.requests.length,2);
  assert.equal(testStaged.status,"test_runner_commit_reserved_staged");
  assert.equal(testStaged.intent.expected_head_sha,frontendHead);
  assert.equal(testStaged.intent.credential_id,runnerChild.credential_id);
  assert.equal(runnerCalls,1);
  assert.equal(gatewayCasWrites,2);
  assert.equal((await independentClient.getBranchMetadata(branch)).commit_sha,frontendHead);
  assert.equal((await independentClient.getBranchMetadata("main")).commit_sha,disposableMainHead);
  assert.deepEqual(prepared.map(p=>[p.role,p.tool]),[
   ["backend","read_file"],["backend","update_file"],
   ["frontend","read_file"],["frontend","update_file"],
   ["test","run_tests"]
  ]);
  assert.equal(new Set(prepared.map(p=>p.response.request_id)).size,5);
  assert.deepEqual(events.slice(-3),[
   "prepare_attempt_test_run_tests",
   "prepare_test_run_tests","execute_test_run_tests"
  ]);
  const testPrepare=prepared[4].response;
  const testRecord=store.get(testPrepare.request_id);
  assert.equal(testRecord?.consumed,true);
  assert.equal(typeof testSignedVp,"string");
  const verifiedTest=await verifier.verify({
   presenter:"test",audience:testPrepare.audience,
   challenge:testPrepare.challenge,
   required_permission:testPermission,signed_vp:testSignedVp
  });
  assert.equal(verifiedTest.credential_id,runnerChild.credential_id);
  assert.equal(verifiedTest.root_credential_id,operational.credential_id);
  verifiedRunnerBinding=gate.assertTrustedCompletedRunnerEvidenceBinding(testRecord,verifiedTest);
  const runnerWitness=await runnerObserver.observe(verifiedRunnerBinding);
  assert.equal(runnerWitness.status,"owner_verified_provider_result");
  const completedTest=await owner.attestIndependentGatewayCompletion(
   testTaskId,testRuntimeId
  );
  assert.equal(completedTest.status,"owner_gateway_completion_independently_observed");
  assert.equal(gate.stagedCompletedTaskCount,3);
  await assert.rejects(owner.attestIndependentGatewayCompletion(
   testTaskId,testRuntimeId),/closed or repeated independent completion/u);
  await assert.rejects(executeAuthorization({
   request_id:testPrepare.request_id,signed_vp:testSignedVp
  },deps),err=>err?.code==="replay_detected");
  assert.equal(runnerCalls,1);
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
  for(const role of ["backend","frontend","test"]){
   const prompts=JSON.stringify(models[role].requests);
   for(const forbidden of [tokens[role],backendChild.credential_id,
    child.credential_id,runnerChild.credential_id,operational.credential_id,
    process.env["ADAPTER_EVM_PRIVATE_KEY_"+role.toUpperCase()]
   ].filter(Boolean))assert.equal(prompts.includes(forbidden),false);
  }

     }
     // The model ledger records ONLY the original Gateway's actual
     // independent provider completion, never an A2A or model claim.
     assert.equal(gate.stagedCompletedTaskCount,attested.length+1);
     attested.push({task_id:choice.task_id,agent_id:choice.agent_id,
      operation:choice.agent_id==="test"?"run_tests":"update_file",
      instruction:choice.instruction});
     modelLedger.push({role:choice.agent_id,epoch:context.nextEpoch});
    },
    confirmReady:async()=>{
     assert.equal(attested.at(-1)?.agent_id,"test");
     assert.ok(verifiedRunnerBinding,"original native Test PASS missing");
     const latest=await runnerObserver.observeTestedHead(verifiedRunnerBinding);
     assert.equal(latest.project_tests,"pass");
     assert.equal(latest.researcher_acceptance,"pass");
     assert.equal(latest.tested_commit_sha,
      (await independentClient.getBranchMetadata(branch)).commit_sha);
     return {status:"owner_verified_tested_head_not_pr_authorized",
      task_id:testTaskId,runtime_task_id:testRuntimeId,
      tested_commit_sha:latest.tested_commit_sha};
    },
    retire:async()=>{await credentialPort.revokeRoot(operational.credential_id);}
   }
  });
  assert.equal(nativeResult.status,"owner_adaptive_work_ready_for_pr");
  assert.equal(nativeResult.pr_created,false);
  assert.equal(nativeResult.executed_tasks,3);
  assert.equal(nativeResult.source_test_task_id,testTaskId);
  assert.equal(nativeResult.tested_commit_sha,frontendHead);
  assert.equal(adaptiveModel.calls,4);
  assert.deepEqual(modelLedger,[
   {role:"backend",epoch:1},{role:"frontend",epoch:2},{role:"test",epoch:3}
  ]);
  assert.deepEqual(observedEpochs,[0,1,2,3]);
  assert.equal(coordinator.registeredTaskCount,3);
  assert.equal(gate.stagedCompletedTaskCount,3);
  assert.equal(gatewayCasWrites,2);
  assert.equal(runnerCalls,1);
  assert.equal(legacyWriteCalls,0);
  process.stdout.write(JSON.stringify({
   event:"r367_native_adaptive_three_roles_ready",
   native_original_engineer_root:true,pre_registered_tasks:0,
   scripted_adk_model_decisions:4,model_selected_task_count:3,
   independent_gateway_completions:3,
   real_rust_evm_opa_and_a2a:true,
   native_backend_frontend_cas_writes:gatewayCasWrites,
   docker_runner_posts:runnerCalls,
   independently_reopened_latest_runner_receipt:true,
   ready_for_pr_only:true,pr_created:false,
   paid_model_calls:0
  })+"\n");
 }finally{
  TrustedEffectStagingTaskRegistry.prototype.selectFor=originalSelect;
  PrivateMcpTaskRegistry.prototype.stageGatewayChallenge=originalChallenge;
  PrivateMcpTaskRegistry.prototype.invokeCrypto=originalCryptoInvoke;
  PrivateMcpTaskRegistry.prototype.takeSignedPresentation=originalProofTake;
  DelegationEvidenceHandler.prototype.createPresentation=originalCreate;
  LocalCryptoMcpBridge.prototype.createSignedPresentation=originalMcpBridge;
  const results=await Promise.allSettled([
   owner?.close(),...bindingServers.reverse().map(b=>b.close()),
   ...roleServers.reverse().map(s=>s.close()),
   new Promise((resolve,reject)=>
    runnerServer.close(err=>err?reject(err):resolve()))
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
  event:"r367_native_three_role_adaptive_with_independent_docker_pass",
  engineer_directory_scopes:5,task_leaf_permissions:5,
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
  three_native_children_one_engineer_root:true,
  test_child_post_frontend_completion:true,
  test_docker_provider_executed:true,
  docker_runner_posts:runnerCalls,
  docker_pass_independently_attested:true,
  final_test_gitea_head_pinned:true,
  gateway_atomic_update_calls:gatewayCasWrites,
  legacy_writes:legacyWriteCalls,paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
