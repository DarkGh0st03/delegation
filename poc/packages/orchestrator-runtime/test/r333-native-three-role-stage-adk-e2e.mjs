import {TrustedAuthorityOnlyEffectStager} from "../../../apps/gateway/src/trusted-authority-only-effect-stager.ts";
/** R331 disposable *real* Gitea, Rust/EVM, OPA and Docker proof.
 * Backend update is sent by the actual A2A SDK to a scripted Google ADK
 * Runner, via owner-authenticated Unix Task binding and staging, then
 * directly to native Gateway HTTP. All Backend, Frontend and Test effects now use ADK/A2A; the Test
 * still requires independent native Docker and Gateway attestation.
 * Owner fixture approval is synthetic; no Gemini or production credentials.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {BaseLlm} from "@google/adk";
import {startSpecializedAgentServer,TrustedEffectStagingTaskRegistry,
 createTrustedEffectAgentBindingServer,
 connectTrustedOwnerEffectStagingClient}
 from "../../agent-runtime/src/index.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {mkdtemp,mkdir,writeFile,rm,readdir} from "node:fs/promises";
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

import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {startTrustedAuthorityOnlyGatewayServer}
 from "../../../apps/gateway/src/trusted-authority-only-host.ts";
import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../../apps/gateway/src/gitea-executor.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight} from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-mutation-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor} from "../../../apps/gateway/src/trusted-authority-only-mutation-executor.ts";
import {TrustedGatewayGiteaMutationEvidencePublisher,
 AuthenticatedGiteaMutationCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {DurableAuthorityOnlyTaskFenceJournal} from "../src/trusted-authority-only-task-fence-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver} from "../src/trusted-authority-only-completion-observer.ts";
import {TrustedAuthorityOnlyRunnerPreflight} from "../../../apps/gateway/src/trusted-authority-only-runner-preflight.ts";
import {DurableAuthorityOnlyRunnerIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyRunnerExecutor} from "../../../apps/gateway/src/trusted-authority-only-runner-executor.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,
 AuthenticatedRunnerCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-runner-evidence.ts";
import {RunnerClient} from "../../../apps/gateway/src/runner-client.ts";
import {IsolatedDockerRunnerExecutor} from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer} from "../../../apps/test-runner-controller/src/http.ts";
import {stageDisposableAccountSuspensionReference}
 from "../../../apps/test-runner-controller/scripts/stage-disposable-account-suspension-reference.mjs";

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
const backendDid=process.env.ADAPTER_ID_BACKEND;
const frontendDid=process.env.ADAPTER_ID_FRONTEND;
const testDid=process.env.ADAPTER_ID_TEST;
assert.match(engineerDid??"",/^did:/u);
assert.match(backendDid??"",/^did:/u);
assert.match(frontendDid??"",/^did:/u);
assert.match(testDid??"",/^did:/u);
const sessionId="r331-authority-native-three-adk-a2a-e2e";
const nativeTaskRef=(symbol)=>"dispatch_"+symbol.repeat(22);
async function freeRolePort(){
 const listener=createServer();
 await new Promise((ok,bad)=>{
  listener.once("error",bad);
  listener.listen(0,"127.0.0.1",ok);
 });
 const bound=listener.address();
 if(!bound||typeof bound==="string")throw Error("No disposable A2A loopback port");
 await new Promise((ok,bad)=>listener.close(e=>e?bad(e):ok()));
 return bound.port;
}
class OfflineNativeBackendModel extends BaseLlm{
 constructor(branch,path,content){
  super({model:"r329-scripted-adk-native-gateway-no-paid-model"});
  this.branch=branch;this.path=path;this.content=content;
  this.requests=[];
 }
 async *generateContentAsync(req){
  this.requests.push(req);
  if(this.requests.length===1){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r329-native-backend-update",name:"update_file",
    args:{branch:this.branch,path:this.path,content:this.content}
   }}]}};
  }else yield {content:{role:"model",parts:[{
   text:"Completed one owner-prebound native Backend update"
  }]}};
 }
 connect(){return Promise.reject(Error("No paid model connection in R330"));}
}
class OfflineNativeFrontendModel extends BaseLlm{
 constructor(branch,path,content){
  super({model:"r330-scripted-native-frontend-adk-no-paid-model"});
  this.branch=branch;this.path=path;this.content=content;
  this.requests=[];
 }
 async *generateContentAsync(req){
  this.requests.push(req);
  if(this.requests.length===1){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r330-native-frontend-update",name:"update_file",
    args:{branch:this.branch,path:this.path,content:this.content}
   }}]}};
  }else yield {content:{role:"model",parts:[{
   text:"Completed one owner-prebound native Frontend update"
  }]}};
 }
 connect(){return Promise.reject(Error("No paid model connection in R330"));}
}
class OfflineNativeTestModel extends BaseLlm{
 constructor(branch){
  super({model:"r331-scripted-native-test-adk-no-paid-model"});
  this.branch=branch;this.requests=[];
 }
 async *generateContentAsync(req){
  this.requests.push(req);
  if(this.requests.length===1){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r331-native-test-docker",name:"run_tests",
    args:{branch:this.branch,profile:"poc-default"}
   }}]}};
  }else yield {content:{role:"model",parts:[{
   text:"Completed one owner-prebound signed Docker Test"
  }]}};
 }
 connect(){return Promise.reject(Error("No paid model connection in R331"));}
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
const originalMainSha=(await client.getBranchMetadata("main")).commit_sha;
const created=await client.createBranch("main","feature/account-suspension");
assert.match(created.commit_sha,/^[a-f0-9]{40}$/u);
const branch="feature/account-suspension";
const mutationPath="apps/backend/users/account.ts";
const frontendPath="apps/frontend/permissions/r305-staged.ts";
const originalFrontend="export const uiPending = true;\n";
const updatedFrontend="export const uiPending = false;\n";
const oldContent="export const accountSuspended = false;\n";
const newContent="export const accountSuspended = true;\n";
// Only the trusted CI owner completes the functional reference BEFORE
// the Engineer signs. Neither Backend nor Test claims this fixture as work.
const functionalFixture=await stageDisposableAccountSuspensionReference({
 gitea:client,branch
});
assert.equal(functionalFixture.engineer_approved,false);
assert.equal(functionalFixture.delegated_agent_writes,0);
// A distinct non-functional file is now provisioned for the genuine
// permission-only Backend atomic CAS Task after approval.
const seeded=await client.createFile(branch,mutationPath,oldContent,
 "R305 owner-provisioned disposable Gitea fixture");
const seededFrontend=await client.createFile(branch,frontendPath,
 originalFrontend,"R305 owner-provisioned nonfunctional Frontend proof file");
// Both owner-provisioned files must exist at the Engineer-approved baseline.
// The Frontend seed advances HEAD after the Backend seed; pin the final HEAD.
const baseRevision=seededFrontend.commit_sha;
assert.notEqual(baseRevision,seeded.commit_sha);
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
const requirement="R305 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermission={
 resource:resourcePrefix+"/directories/apps/backend",operation:"update_file"
};
const frontendGrant={
 resource:resourcePrefix+"/directories/apps/frontend",operation:"update_file"
};
const frontendTaskPermission={
 resource:resourcePrefix+"/files/"+frontendPath,operation:"update_file"
};
const testGrantPermission={resource:resourcePrefix,operation:"run_tests"};
const testTaskPermission={resource:resourcePrefix,operation:"run_tests"};
const taskPermission={
 resource:resourcePrefix+"/files/"+mutationPath,operation:"update_file"
};
assert.notEqual(grantPermission.resource,taskPermission.resource);
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r305-disposable-ed25519";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const proposed={
 schema_version:"1.0.0",session_id:sessionId,repository:repo,branch,
 base_revision:baseRevision,requirement,
 requested_permissions:[grantPermission,frontendGrant,testGrantPermission]
};
const grant=selectAuthorityOnlyGrant(proposed,[grantPermission,frontendGrant,testGrantPermission],{
 allowedOperations:new Set(RUST_OPERATIONS)
});
const receipt=signAuthorityOnlyGrant({
 authorization:grant,engineerDid,keyId:authKey,
 privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}),
 issuedAt,expiresAt:approvalExpiresAt,
 allowedOperations:new Set(RUST_OPERATIONS)
});
const parent=await mkdtemp(join(tmpdir(),"delegation-r305-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
let runnerServer;
let gatewayHost;
let a2aOwner;
let roleBindingServers=[];
let a2aRoleServers=[];
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents","flights",
 "intent","receipts","runner-intent","runner-receipts","runner-logs"];
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
  statusListCredential:"https://status.example/r305"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r305:preliminary",29101,360);
 const operational=params("urn:r305:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,grant.permissions);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{
   backend:{did:backendDid,card_ref:"trusted:r305-backend",
    capabilities:["update_file"]},
   frontend:{did:frontendDid,card_ref:"trusted:r305-frontend",
    capabilities:["update_file"]},
   test:{did:testDid,card_ref:"trusted:r305-test",
    capabilities:["run_tests"]}
  },nowMs
 });
 await coordinator.activate();
 const taskId="r305-backend-task",runtimeTaskId=nativeTaskRef("B");
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"backend",depends_on:[],permissions:[taskPermission]
 });
 const frontendTaskId="r305-frontend-task",frontendRuntimeId=nativeTaskRef("F");
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:frontendTaskId,epoch:2,
  agent_id:"frontend",depends_on:[taskId],permissions:[frontendTaskPermission]
 });
 const testTaskId="r305-test-task",testRuntimeId=nativeTaskRef("T");
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:testTaskId,epoch:3,
  agent_id:"test",depends_on:[frontendTaskId],permissions:[testTaskPermission]
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
 const child=await issuer.issueForRegisteredTask(taskId,
  params("urn:r305:child:backend",29103,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 assert.deepEqual(child.permissions,[taskPermission]);
 assert.deepEqual(approved.permissions,grant.permissions);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const runnerObserver=new AuthenticatedRunnerCompletionObserver({
  directory:path("runner-receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,
  giteaClient:independentClient,nowMs
 });
 const mutationObserver=new AuthenticatedGiteaMutationCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,
  giteaClient:independentClient,nowMs
 });
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:expected=>{
    if(expected.task_id===taskId||expected.task_id===frontendTaskId)
     return mutationObserver.observe(expected);
    if(expected.task_id===testTaskId)return runnerObserver.observe(expected);
    throw Error("Unknown Task attempted completion");
   }
  }),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"backend");
 const enrolled=await gate.enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer);
 assert.equal(enrolled.credential_id,child.credential_id);
 assert.equal(enrolled.gateway_execution_authorized,false);
 const verifier=loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true});
 assert.equal(verifier.allowsGiteaScopeCoverage,true);
 const policy=new OpaPolicyClient({baseUrl:"http://127.0.0.1:8181",
  timeoutMs:6000});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let legacyWriteCalls=0;
 class ObservedGiteaExecutor extends GiteaExecutor {
  async execute(...args){legacyWriteCalls++;return super.execute(...args);}
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
 // R308: exercise the canonical GatewayRuntime, not only its underlying
 // prepare/execute helpers. The owner-only effect ports remain private.
 const gatewayConfig={
  bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,
   repository:repo},
  verifier_mode:"core-rust",opa_url:"http://127.0.0.1:8181",
  opa_timeout_ms:6000,provider_mode:"gitea",
  gitea_base_url:process.env.GITEA_HOST_BASE_URL,
  gitea_gateway_token:process.env.GITEA_GATEWAY_TOKEN,
  gitea_timeout_ms:6000,runner_timeout_ms:900000
 };
 const runtime=new GatewayRuntime(gatewayConfig,{
  store,audit,verifier,policy,executor,authorityOnlyAdmissions:gate,
  authorityOnlyMutationEnabled:true,
  authorityOnlyMutationExecutor:mutationExecutor
 });
 assert.equal(runtime.providerLabel,"gitea");
 const runnerJournal=new DurableAuthorityOnlyRunnerIntentJournal(
  path("runner-intent"));
 const runnerPreflight=new TrustedAuthorityOnlyRunnerPreflight({
  admissions:gate,giteaClient:client,journal:runnerJournal,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 // No fake Test results and no signed-DAG/legacy provider fallback.
 const bearer=randomBytes(32).toString("hex");
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
 runnerServer=createRunnerHttpServer({
  bind_host:"127.0.0.1",bind_port:0,gateway_token:bearer,
  contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",
   branch}
 },controller);
 await new Promise((resolve,reject)=>{
  runnerServer.once("error",reject);
  runnerServer.listen(0,"127.0.0.1",resolve);
 });
 const port=runnerServer.address()?.port;
 assert.ok(port);
 let runnerCalls=0;
 class ObservedRunnerClient extends RunnerClient{
  async run(request,signal){
   runnerCalls++;
   try{
    const result=await super.run(request,signal);
    // Safe CI-only status. No application source/logs or credentials.
    process.stdout.write(JSON.stringify({
     event:"r305_runner_sanitized_result",
     status:result.status,
     project_status:result.project_tests?.status??null,
     acceptance_status:result.researcher_acceptance?.status??null,
     tested_sha_matches:result.tested_commit_sha===request.commit_sha,
     phases:result.phases.map(p=>({
      phase:p.phase,status:p.status,
      failed:Number.isSafeInteger(p.failed)?p.failed:null
     }))
    })+"\n");
    return result;
   }catch(error){
    process.stdout.write(JSON.stringify({
     event:"r305_runner_transport_failure",
     class_name:error?.constructor?.name??"unknown",
     code:typeof error?.code==="string"?error.code:"unclassified"
    })+"\n");
    throw error;
   }
  }
 }
 const runnerClient=new ObservedRunnerClient({
  baseUrl:"http://127.0.0.1:"+port,
  gatewayToken:bearer,timeoutMs:900000
 });
 const ownedRunnerExecutor=new TrustedAuthorityOnlyRunnerExecutor({
  admissions:gate,preflight:runnerPreflight,
  journal:runnerJournal,giteaClient:client,runnerClient,
  publisher:new TrustedGatewayRunnerPassEvidencePublisher({
   directory:path("runner-receipts"),key:evidenceKey,runnerClient,
   independentGiteaClient:independentClient,
   repository:"thesis/iam-console-poc",branch,nowMs
  }),observer:runnerObserver,
  repository:"thesis/iam-console-poc",branch
 });
 // R312: use one canonical owner HTTP listener for Test prepare and execute.
 // The host builds its own fixed native Rust verifier and real OPA/Gitea
 // clients; it cannot inherit the fixture's injected verifier or executor.
 // The exact private request store and both owner-bound effect executors
 // are shared, and no authority control endpoint is exposed on HTTP.
 gatewayHost=await startTrustedAuthorityOnlyGatewayServer(
  {...gatewayConfig,prepare:{...gatewayConfig.prepare,
   request_ttl_ms:1_200_000}},{
   admissions:gate,mutationExecutor,runnerExecutor:ownedRunnerExecutor,
   store,audit
  });
 const gatewayAddress=gatewayHost.server.address();
 assert.ok(gatewayAddress&&typeof gatewayAddress!=="string");

 // R329: the actual A2A Backend host runs Google ADK with a deterministic
 // model, but Gateway/OPA/Gitea and native Rust Child VP are all REAL.
 // Three independent agent bind sockets; one common trusted owner registry.
 const roleNames=["backend","frontend","test"];
 const roleTokens={backend:tokens.backend,frontend:tokens.frontend,
  test:tokens.test};
 const roleBindings={};
 const roleEndpoints={};
 const nativeBackendModel=new OfflineNativeBackendModel(branch,mutationPath,newContent);
 const nativeFrontendModel=new OfflineNativeFrontendModel(branch,frontendPath,updatedFrontend);
 const nativeTestModel=new OfflineNativeTestModel(branch);
 let runnerPreparedFromAgent,testSignedVpFromAgent,testGatewayExecution;
 let backendPreparedFromAgent,backendSignedVpFromAgent,backendGatewayExecution;
 let frontendPreparedFromAgent,frontendSignedVpFromAgent,frontendGatewayExecution;
 let backendPrepareAttempted=false,backendPrepareStatus=null;
 let backendExecuteAttempted=false,backendExecuteStatus=null;
 let backendOwnerStageAttempted=false,backendOwnerStageReserved=false;
 let backendOwnerStageFailureType=null;
 const roleStageChannels={};
 for(const role of roleNames){
  const socketPath=path("r333-stage-"+role+".sock");
  const secretFile=path("r333-stage-"+role+".hex");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
  roleStageChannels[role]={socketPath,secretFile};
 }
 const backendFetch=async(url,init)=>{
  const route=String(url);
  const preparing=route.endsWith("/v1/authorization/prepare");
  const executing=route.endsWith("/v1/authorization/execute");
  if(preparing)backendPrepareAttempted=true;
  if(executing)backendExecuteAttempted=true;
  const response=await fetch(url,init);
  if(preparing){
   backendPrepareStatus=response.status;
   if(response.ok)backendPreparedFromAgent=await response.clone().json();
  }
  if(executing){
   backendExecuteStatus=response.status;
   const sent=JSON.parse(String(init?.body));
   backendSignedVpFromAgent=sent.signed_vp;
   backendGatewayExecution=await response.clone().json();
  }
  return response;
 };
 const frontendFetch=async(url,init)=>{
  const route=String(url),response=await fetch(url,init);
  if(route.endsWith("/v1/authorization/prepare")&&response.ok)
   frontendPreparedFromAgent=await response.clone().json();
  if(route.endsWith("/v1/authorization/execute")){
   const sent=JSON.parse(String(init?.body));
   frontendSignedVpFromAgent=sent.signed_vp;
   frontendGatewayExecution=await response.clone().json();
  }
  return response;
 };
 const testFetch=async(url,init)=>{
  const route=String(url),response=await fetch(url,init);
  if(route.endsWith("/v1/authorization/prepare")&&response.ok)
   runnerPreparedFromAgent=await response.clone().json();
  if(route.endsWith("/v1/authorization/execute")){
   const sent=JSON.parse(String(init?.body));
   testSignedVpFromAgent=sent.signed_vp;
   testGatewayExecution=await response.clone().json();
  }
  return response;
 };
 const registries={};
 for(const role of roleNames){
  const stageConnector=await connectTrustedOwnerEffectStagingClient(
   roleStageChannels[role]);
  const secretFile=path("r329-bind-"+role+".hex");
  const socketPath=path("r329-bind-"+role+".sock");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
  roleBindings[role]={socketPath,secretFile};
  const registry=new TrustedEffectStagingTaskRegistry();
  registries[role]=registry;
  const bindingServer=await createTrustedEffectAgentBindingServer({
   socketPath,secretFile,registry,ownerStageClient:stageConnector,
   expectedRole:role
  });
  await bindingServer.start();
  roleBindingServers.push(bindingServer);
  const a2aOpts={
   role,host:"127.0.0.1",port:await freeRolePort(),
   capabilityProfile:"approved-plan",delegatedAuthorization:true
  };
  if(role==="backend"||role==="frontend"||role==="test"){
   const keys=generateKeyPairSync("ed25519");
   a2aOpts.mcpTaskSigning={
    signingPrivateKeyPem:keys.privateKey.export({
     type:"pkcs8",format:"pem"}).toString(),
    signingPublicKeyPem:keys.publicKey.export({
     type:"spki",format:"pem"}).toString()
   };
   a2aOpts.adk={
    model:role==="backend"?nativeBackendModel:
      role==="frontend"?nativeFrontendModel:nativeTestModel,
    gatewayBaseUrl:"http://127.0.0.1:"+gatewayAddress.port,
    adapterToken:roleTokens[role],
    maxModelTurns:4,maxModelCallMs:10000,
    gatewayTimeoutMs:120000,scopeModelPaths:true,
    trustedEffectTaskRegistry:registry,
    fetchFn:role==="backend"?backendFetch:
      role==="frontend"?frontendFetch:testFetch
   };
  }
  const server=await startSpecializedAgentServer(a2aOpts);
  a2aRoleServers.push(server);
  roleEndpoints[role]=server.baseUrl;
 }
 a2aOwner=await startTrustedAuthorityOnlySdkA2AOwner({
  coordinator,childIssuer:issuer,gateway:gate,
  stageChannels:roleStageChannels,
  agentBindingChannels:roleBindings,agentBaseUrls:roleEndpoints,
  a2aPolling:{deadlineMs:1_080_000,initialIntervalMs:50,maxIntervalMs:250}
 });
 // Actual ADK model must see no signer token or credential material.
 assert.equal(nativeBackendModel.requests.length,0);

 const httpCall=async(route,payload,expectedStatus)=>{
  const response=await fetch("http://127.0.0.1:"+gatewayAddress.port+
   "/v1/authorization/"+route,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(payload)
   });
  const result=await response.json();
  assert.equal(response.status,expectedStatus,
   "R313 Gateway HTTP "+route+" failed");
  return result;
 };
 // Exercise denial through the same public boundary as successful effects.
 const assertHttpDenied=async(payload,code)=>{
  const expected=code==="replay_detected"?409:403;
  const writesBefore=gatewayCasWrites,runnerBefore=runnerCalls;
  const result=await httpCall("execute",payload,expected);
  assert.equal(result.error,code);
  assert.equal(gatewayCasWrites,writesBefore);
  assert.equal(runnerCalls,runnerBefore);
 };
 const prepare=()=>httpCall("prepare",{
  task_id:runtimeTaskId,agent_role:"backend",tool:"update_file",
  arguments:{branch,path:mutationPath,content:newContent}
 },201);
 const sign=async(credential_id,prepared)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.backend,timeoutMs:60000
  },"create_presentation",{
   credential_id,disclosed_permissions:[taskPermission],
   audience:prepared.audience,challenge:prepared.challenge
  });
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,
  authorityOnlyMutationEnabled:true,
  authorityOnlyMutationExecutor:mutationExecutor};
 // R329: the ONLY Backend write is generated by the scripted ADK
 // FunctionTool after protected A2A SDK dispatch and private owner binding.
 // No manual Backend prepare/stage/sign/execute is allowed in this variant.
 const nativeBackendStager=new TrustedAuthorityOnlyEffectStager({
  store,admissions:gate,mutation:preflight,runner:runnerPreflight,
  runtimeTaskId,tool:"update_file",expectedHeadSha:baseRevision
 });
 let backendReport;
 try{
  backendReport=await a2aOwner.dispatchIssuedTask({
   taskId,runtimeTaskId,
   instruction:"Update the exact account suspension Backend fixture",
   effectStager:{
    async stage(requestId){
     backendOwnerStageAttempted=true;
     try{
      const result=await nativeBackendStager.stage(requestId);
      backendOwnerStageReserved=true;
      return result;
     }catch(error){
      // Never log provider paths/HEAD, native credentials or raw errors.
      backendOwnerStageFailureType=error?.constructor?.name??"unknown";
      throw error;
     }
    }
   }
  });
 }catch(error){
  process.stdout.write(JSON.stringify({
   event:"r329_native_adk_safe_boundary_diagnostic",
   prepare_attempted:backendPrepareAttempted,
   prepare_http_status:backendPrepareStatus,
   owner_stage_attempted:backendOwnerStageAttempted,
   owner_stage_reserved:backendOwnerStageReserved,
   owner_stage_error_class:backendOwnerStageFailureType,
   execute_attempted:backendExecuteAttempted,
   execute_http_status:backendExecuteStatus,
   native_vp_sent_to_gateway:typeof backendSignedVpFromAgent==="string",
   gateway_last_decision:audit.events.at(-1)?.decision??null,
   gateway_last_reason:audit.events.at(-1)?.reason??null,
   native_gateway_cas_writes:gatewayCasWrites,
   adk_model_turns:nativeBackendModel.requests.length
  })+"\n");
  throw error;
 }
 assert.equal(backendReport.status,"a2a_report_not_gateway_completed");
 assert.equal(backendReport.provider_completion_attested,false);
 assert.deepEqual(backendReport.artifact.files_modified,[mutationPath]);
 assert.equal(backendReport.artifact.test_outcome,"not_run");
 assert.equal(nativeBackendModel.requests.length,2);
 const privateModelMessages=JSON.stringify(nativeBackendModel.requests);
 for(const forbidden of [tokens.backend,child.credential_id,operational.credential_id])
  assert.equal(privateModelMessages.includes(forbidden),false);
 const good=backendPreparedFromAgent,goodVp=backendSignedVpFromAgent;
 const written=backendGatewayExecution;
 assert.ok(good&&goodVp&&written,"Native ADK used actual Gateway HTTP");
 assert.equal(written.request_id,good.request_id);
 assert.equal(written.decision,"allow");
 assert.equal(written.execution.provider,"gitea");
 assert.equal(written.execution.tool,"update_file");
 assert.equal(written.execution.commit_sha,backendReport.artifact.commit_sha);
 assert.equal(gatewayCasWrites,1);
 assert.equal(legacyWriteCalls,0);
 assert.equal((await client.getBranchMetadata(branch)).commit_sha,
  written.execution.commit_sha);
 assert.equal((await independentClient.readTextFile(
  branch,mutationPath,written.execution.commit_sha)).content,newContent);
 const originalRecord=store.get(good.request_id);
 assert.ok(originalRecord);
 // Independent Core Rust/EVM verifier reads a VP made by the actual
 // native Child signer, not a synthetic Adapter or model-provided proof.
 const valid=await verifier.verify({
  presenter:"backend",audience:good.audience,challenge:good.challenge,
  required_permission:taskPermission,signed_vp:goodVp
 });
 assert.equal(valid.presenter_id,backendDid);
 assert.equal(valid.credential_id,child.credential_id);
 assert.equal(valid.root_credential_id,operational.credential_id);
 assert.equal(valid.hierarchy_depth,1);
 assert.deepEqual(valid.permissions,[taskPermission]);
 const verifiedReceipt=await observer.observe(
  gate.assertTrustedCompletedMutationEvidenceBinding(originalRecord,valid));
 assert.equal(verifiedReceipt.status,"owner_verified_provider_result");
 const stageEffect=(runtimeTaskId,tool,expectedHeadSha,requestId)=>
  new TrustedAuthorityOnlyEffectStager({store,admissions:gate,
   mutation:preflight,runner:runnerPreflight,runtimeTaskId,tool,expectedHeadSha})
   .stage(requestId);
 await assertHttpDenied({request_id:good.request_id,signed_vp:goodVp},"replay_detected");
 const nativeBackendCompletion=await
  a2aOwner.attestIndependentGatewayCompletion(taskId,runtimeTaskId);
 assert.equal(nativeBackendCompletion.status,
  "owner_gateway_completion_independently_observed");
 assert.equal(gate.stagedCompletedTaskCount,1);
 assert.equal(gatewayCasWrites,1);

  // Frontend now executes under the SAME Engineer grant, with a separate
  // Child DC and independent authenticated commit. Test depends on Frontend.
   const frontendChild=await issuer.issueForRegisteredTask(
  frontendTaskId,params("urn:r305:child:frontend",29105,1200));
 assert.equal(frontendChild.agent_did,frontendDid);
 assert.notEqual(frontendChild.credential_id,child.credential_id);
 assert.equal(frontendChild.root_credential_id,operational.credential_id);
 assert.deepEqual(frontendChild.permissions,[frontendTaskPermission]);
 await gate.bindTrustedTask(frontendTaskId,frontendRuntimeId,"frontend");
 await gate.enrollTrustedIssuedChild(
  frontendTaskId,frontendRuntimeId,issuer);
 // R330 Frontend is a real ADK/A2A Task. The trusted owner pins the
 // next mutation to the independently observed Backend commit HEAD.
 const nativeFrontendStager=new TrustedAuthorityOnlyEffectStager({
  store,admissions:gate,mutation:preflight,runner:runnerPreflight,
  runtimeTaskId:frontendRuntimeId,tool:"update_file",
  expectedHeadSha:written.execution.commit_sha
 });
 let frontStaged;
 const frontendReport=await a2aOwner.dispatchIssuedTask({
  taskId:frontendTaskId,runtimeTaskId:frontendRuntimeId,
  instruction:"Update the exact account suspension Frontend fixture",
  effectStager:{
   async stage(requestId){
    frontStaged=await nativeFrontendStager.stage(requestId);
    return frontStaged;
   }
  }
 });
 assert.equal(frontendReport.status,"a2a_report_not_gateway_completed");
 assert.equal(frontendReport.provider_completion_attested,false);
 assert.equal(frontendReport.role,"frontend");
 assert.deepEqual(frontendReport.artifact.files_modified,[frontendPath]);
 assert.equal(nativeFrontendModel.requests.length,2);
 const frontendModelMessages=JSON.stringify(nativeFrontendModel.requests);
 for(const forbidden of [tokens.frontend,frontendChild.credential_id,
  operational.credential_id])
  assert.equal(frontendModelMessages.includes(forbidden),false);
 const frontendPrepared=frontendPreparedFromAgent;
 const frontendVp={signed_vp:frontendSignedVpFromAgent};
 const frontendWritten=frontendGatewayExecution;
 assert.ok(frontendPrepared&&frontendVp.signed_vp&&frontendWritten,
  "Native Frontend ADK used real Gateway Prepare/VP/Execute");
 assert.equal(frontendWritten.request_id,frontendPrepared.request_id);
 assert.equal(frontendWritten.decision,"allow");
 assert.equal(frontendWritten.execution.commit_sha,
  frontendReport.artifact.commit_sha);
 const frontendRecord=store.get(frontendPrepared.request_id);
 assert.ok(frontendRecord);
 assert.equal(frontStaged.intent.expected_blob_sha,seededFrontend.blob_sha);
 assert.equal(frontStaged.intent.expected_head_sha,written.execution.commit_sha);
 assert.equal(frontStaged.intent.credential_id,frontendChild.credential_id);

 const frontVerified=await verifier.verify({
  presenter:"frontend",audience:frontendPrepared.audience,
  challenge:frontendPrepared.challenge,
  required_permission:frontendTaskPermission,
  signed_vp:frontendVp.signed_vp
 });
 assert.equal(frontVerified.presenter_id,frontendDid);
 assert.equal(frontVerified.credential_id,frontendChild.credential_id);
 assert.equal(frontVerified.root_credential_id,operational.credential_id);
 assert.equal(frontVerified.hierarchy_depth,1);
 assert.deepEqual(frontVerified.permissions,[frontendTaskPermission]);
 assert.equal(frontVerified.permissions.some(p=>
  p.resource===frontendGrant.resource),false);
 for(const denied of [
  {...frontendTaskPermission,operation:"read_file"},
  {...frontendTaskPermission,
   resource:resourcePrefix+"/files/apps/backend/users/account.ts"},
  {...frontendTaskPermission,
   resource:resourcePrefix+"/files/apps/frontend/permissions/other.ts"}
 ]){
  await assert.rejects(()=>verifier.verify({
   presenter:"frontend",audience:frontendPrepared.audience,
   challenge:frontendPrepared.challenge,
   required_permission:denied,signed_vp:frontendVp.signed_vp
  }));
 }
 const frontOpa=await policy.evaluate({
  request_id:frontendPrepared.request_id,task_id:frontendRuntimeId,
  agent_role:"frontend",tool:"update_file",
  arguments:{branch,path:frontendPath,content:updatedFrontend},
  required_permission:frontendTaskPermission,repository:repo,
  verified_delegation:{
   presenter_id:frontVerified.presenter_id,
   credential_id:frontVerified.credential_id,
   issuer_id:frontVerified.issuer_id,
   hierarchy_depth:frontVerified.hierarchy_depth
  }
 });
 assert.equal(frontOpa.allow,true);
 assert.equal(frontendWritten.decision,"allow");
 assert.equal(frontendWritten.execution.provider,"gitea");
 assert.equal(frontendWritten.execution.tool,"update_file");
 assert.equal(frontendWritten.execution.branch,branch);
 assert.equal(frontendWritten.execution.path,frontendPath);
 assert.equal(gatewayCasWrites,2);
 assert.equal(legacyWriteCalls,0);
 const frontendHead=frontendWritten.execution.commit_sha;
 assert.notEqual(frontendHead,written.execution.commit_sha);
 assert.equal((await independentClient.getBranchMetadata(branch)).commit_sha,
  frontendHead);
 assert.equal((await independentClient.readTextFile(
  branch,frontendPath,frontendHead)).content,updatedFrontend);
 assert.equal((await independentClient.readTextFile(
  branch,mutationPath,frontendHead)).content,newContent);
 const frontendProof=await mutationObserver.observe(
  gate.assertTrustedCompletedMutationEvidenceBinding(
   frontendRecord,frontVerified));
 assert.equal(frontendProof.status,"owner_verified_provider_result");
 const nativeFrontendCompletion=await a2aOwner
  .attestIndependentGatewayCompletion(frontendTaskId,frontendRuntimeId);
 assert.equal(nativeFrontendCompletion.status,
  "owner_gateway_completion_independently_observed");
 assert.equal(gate.stagedCompletedTaskCount,2);
 await assertHttpDenied({
  request_id:frontendPrepared.request_id,
  signed_vp:frontendVp.signed_vp
 },"replay_detected");
 assert.equal(gatewayCasWrites,2);

 const runnerChild=await issuer.issueForRegisteredTask(
  testTaskId,params("urn:r305:child:test",29106,1200));
 assert.equal(runnerChild.agent_did,testDid);
 assert.notEqual(runnerChild.credential_id,child.credential_id);
 assert.notEqual(runnerChild.credential_id,frontendChild.credential_id);
 assert.deepEqual(runnerChild.permissions,[testTaskPermission]);
 await gate.bindTrustedTask(testTaskId,testRuntimeId,"test");
 await gate.enrollTrustedIssuedChild(testTaskId,testRuntimeId,issuer);
 const pinnedHead=frontendWritten.execution.commit_sha;
 assert.notEqual(pinnedHead,written.execution.commit_sha);
 // R331: Test joins Backend and Frontend in the real protected
 // ADK/A2A route. The Test Child and exact Frontend HEAD are pinned
 // by the owner, not accepted from A2A or the model.
 const nativeTestStager=new TrustedAuthorityOnlyEffectStager({
  store,admissions:gate,mutation:preflight,runner:runnerPreflight,
  runtimeTaskId:testRuntimeId,tool:"run_tests",expectedHeadSha:pinnedHead
 });
 let runnerStaged;
 const testReport=await a2aOwner.dispatchIssuedTask({
  taskId:testTaskId,runtimeTaskId:testRuntimeId,
  instruction:"Run the exact approved poc-default Docker acceptance suite",
  effectStager:{
   async stage(requestId){
    runnerStaged=await nativeTestStager.stage(requestId);
    return runnerStaged;
   }
  }
 });
 assert.equal(testReport.status,"a2a_report_not_gateway_completed");
 assert.equal(testReport.provider_completion_attested,false);
 assert.equal(testReport.role,"test");
 assert.equal(testReport.artifact.test_outcome,"pass");
 assert.equal(testReport.artifact.commit_sha,pinnedHead);
 // An A2A Test report cannot attest the Test HEAD; only the Gateway
 // native Runner receipt does that in the independent observer.
 assert.equal(testReport.artifact.tested_commit_sha,undefined);
 assert.equal(nativeTestModel.requests.length,2);
 const privateTestPrompt=JSON.stringify(nativeTestModel.requests);
 for(const forbidden of [tokens.test,runnerChild.credential_id,
  operational.credential_id])
  assert.equal(privateTestPrompt.includes(forbidden),false);
 const runnerPrepared=runnerPreparedFromAgent;
 const testPresentation={signed_vp:testSignedVpFromAgent};
 const testResult=testGatewayExecution;
 assert.ok(runnerPrepared&&testPresentation.signed_vp&&testResult,
  "Native Test ADK must reach actual Gateway Prepare/VP/Execute");
 assert.equal(testResult.request_id,runnerPrepared.request_id);
 assert.equal(testResult.decision,"allow");
 const runnerRecord=store.get(runnerPrepared.request_id);
 assert.ok(runnerRecord);
 assert.equal(runnerStaged.runner_execution_authorized,false);
 assert.equal(runnerStaged.intent.expected_head_sha,pinnedHead);
 assert.equal(runnerStaged.intent.credential_id,runnerChild.credential_id);
 const testVerified=await verifier.verify({
  presenter:"test",audience:runnerPrepared.audience,
  challenge:runnerPrepared.challenge,
  required_permission:testTaskPermission,
  signed_vp:testPresentation.signed_vp
 });
 assert.equal(testVerified.presenter_id,testDid);
 assert.equal(testVerified.credential_id,runnerChild.credential_id);
 assert.equal(testVerified.root_credential_id,operational.credential_id);
 const testOpa=await policy.evaluate({
  request_id:runnerPrepared.request_id,task_id:testRuntimeId,
  agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"},
  required_permission:testTaskPermission,repository:repo,
  verified_delegation:{
   presenter_id:testVerified.presenter_id,
   credential_id:testVerified.credential_id,
   issuer_id:testVerified.issuer_id,
   hierarchy_depth:testVerified.hierarchy_depth
  }
 });
 assert.equal(testOpa.allow,true);
 assert.equal(testResult.decision,"allow");
 assert.equal(testResult.execution.provider,"runner");
 assert.equal(testResult.execution.status,"pass");
 assert.equal(testResult.execution.tested_commit_sha,pinnedHead);
 assert.equal(testResult.execution.project_tests.status,"pass");
 assert.equal(testResult.execution.researcher_acceptance.status,"pass");
 assert.equal(runnerCalls,1);
 assert.equal(legacyWriteCalls,0);
 assert.equal((await client.getBranchMetadata(branch)).commit_sha,pinnedHead);
 const testWitness=await runnerObserver.observe(
  gate.assertTrustedCompletedRunnerEvidenceBinding(
   runnerRecord,testVerified));
 assert.equal(testWitness.status,"owner_verified_provider_result");
 const nativeTestCompletion=await a2aOwner
  .attestIndependentGatewayCompletion(testTaskId,testRuntimeId);
 assert.equal(nativeTestCompletion.status,
  "owner_gateway_completion_independently_observed");
 assert.equal(gate.stagedCompletedTaskCount,3);
 await assertHttpDenied({
  request_id:runnerPrepared.request_id,
  signed_vp:testPresentation.signed_vp
 },"replay_detected");
 assert.equal(runnerCalls,1);
 assert.equal(gatewayCasWrites,2);


 // An independently valid Child under the same root MUST NOT substitute
 // for the Child enrolled for this Task. This negative probe is test-only.
 const foreign=await nativePort.issueChild({
  parent_credential_id:operational.credential_id,
  credential_id:"urn:r305:child:unbound",delegatee:"backend",
  valid_from:issuedAt,validity_seconds:600,
  credential_status:status(29107),permissions:[taskPermission]
 });
 const other=await prepare(),otherVp=await sign(foreign.id,other);
 const validOther=await verifier.verify({
  presenter:"backend",audience:other.audience,challenge:other.challenge,
  required_permission:taskPermission,signed_vp:otherVp
 });
 assert.equal(validOther.root_credential_id,operational.credential_id);
 assert.throws(()=>gate.assertVerifiedVpAndPolicyForExecution(
  store.get(other.request_id),validOther),/differs from enrolled Task/u);
 await assertHttpDenied({
  request_id:other.request_id,signed_vp:otherVp
 },"authority_only_execution_not_enabled");
 assert.equal(gatewayCasWrites,2);

 // An already-prepared and signed VP MUST be denied after EVM root
 // revocation (not simply because the Task registry is still loaded).
 const pending=await prepare(),pendingVp=await sign(child.credential_id,pending);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:pending.audience,challenge:pending.challenge,
  required_permission:taskPermission,signed_vp:pendingVp
 }));
 await assertHttpDenied({
  request_id:pending.request_id,signed_vp:pendingVp
 },"verification_rejected");
 assert.equal(gatewayCasWrites,2);
 assert.equal((await client.getBranchMetadata("main")).commit_sha,
  originalMainSha);
 process.stdout.write(JSON.stringify({
  event:"r333_native_role_isolated_stage_three_adk_docker",
  engineer_directory_scope:true,child_file_scope:true,
  native_engineer_roots:true,native_child_ipc:true,
  native_signed_vp:true,independent_rust_evm_status:true,
  native_verified_root_provenance:true,real_opa_allow:true,
  scope_expansion_denied:true,unbound_child_denied:true,revoked_root_denied:true,
  provider_calls:gatewayCasWrites,gateway_atomic_update_executed:true,
  three_distinct_child_credentials:true,
  completion_attested:true,old_head_pinned:true,legacy_writes:legacyWriteCalls,
  runner_posts:runnerCalls,test_completion_attested:true,dependent_tasks:3,frontend_cas:true,
  paid_model_calls:0,canonical_gateway_runtime:true,
  role_isolated_authenticated_stage_sockets:3,
  distinct_stage_keys_per_role:true,
  canonical_gateway_http_test_execute:true,
  canonical_gateway_http_test_prepare:true,
  canonical_gateway_http_backend_frontend:true,
  canonical_gateway_http_negative_probes:true,
  native_sdk_a2a_backend:true,native_adk_backend:true,
  native_sdk_a2a_frontend:true,native_adk_frontend:true,
  native_backend_child_vp_via_local_crypto_mcp:true,
  native_frontend_child_vp_via_local_crypto_mcp:true,
  native_backend_gateway_provider_observed:true,
  native_frontend_gateway_provider_observed:true,
  native_sdk_a2a_test:true,native_adk_test:true,
  native_test_child_vp_via_local_crypto_mcp:true,
  native_test_gateway_runner_observed:true,
  test_adk:true,
  completed_app_source:"owner_only_fixture",
  delegated_functional_edits:0,fixture_files_changed:functionalFixture.files_changed
 })+"\n");
}finally{
 // Revoke private owner effect grants before closing native Gateway/Rust.
 if(a2aOwner)await a2aOwner.close();
 await Promise.allSettled([
  ...roleBindingServers.map(s=>s.close()),
  ...a2aRoleServers.map(s=>s.close())
 ]);
 if(gatewayHost)await gatewayHost.close();
 if(runnerServer)await new Promise(resolve=>runnerServer.close(resolve));
 await rm(parent,{recursive:true,force:true});
}
