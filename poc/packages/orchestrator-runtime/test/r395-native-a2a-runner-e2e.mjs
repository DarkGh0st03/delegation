/** R395 — ONE DISPOSABLE, COMPLETE native CREATE_FILE chain:
 * original Engineer root -> true Rust/EVM Child -> original Coordinator
 * -> owner-private HMAC Unix -> SDK A2A HTTP -> Google ADK FunctionTool
 * -> Task-local cryptographic MCP (real native Rust VP) -> native Gateway
 * -> OPA -> real Gitea atomic CREATE HEAD CAS -> independently MAC
 * verified receipt -> original Gateway/owner Task completion.
 * No paid inference, no production credentials, no main commits.
 * R395: signed Test create_file only for an exact project-test source;
 * no separate delegated run_tests Child is claimed by this fixture.
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
import {fileURLToPath} from "node:url";

import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {InMemoryAuditSink,InMemoryRequestStore,prepareAuthorization}
 from "../../../apps/gateway/src/prepare.ts";
import {executeAuthorization} from "../../../apps/gateway/src/execute.ts";
import {buildPolicyInput} from "../../../apps/gateway/src/policy-input.ts";
import {TrustedAuthorityOnlyCompletionObserver} from "../src/trusted-authority-only-completion-observer.ts";
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
import {ProviderNotFoundError} from "../../../apps/gateway/src/errors.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight} from "../../../apps/gateway/src/trusted-authority-only-create-preflight.ts";
import {TrustedAuthorityOnlyRunnerPreflight} from "../../../apps/gateway/src/trusted-authority-only-runner-preflight.ts";
import {TrustedAuthorityOnlyEffectStager} from "../../../apps/gateway/src/trusted-authority-only-effect-stager.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight} from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-mutation-intent-journal.ts";
import {DurableAuthorityOnlyRunnerIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyRunnerExecutor} from "../../../apps/gateway/src/trusted-authority-only-runner-executor.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,AuthenticatedRunnerCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-evidence.ts";
import {RunnerClient} from "../../../apps/gateway/src/runner-client.ts";
import {createRunnerHttpServer} from "../../../apps/test-runner-controller/src/http.ts";
import {stageDisposableAccountSuspensionReference}
 from "../../../apps/test-runner-controller/scripts/stage-disposable-account-suspension-reference.mjs";
import {DurableAuthorityOnlyGiteaCreateIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-create-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor} from "../../../apps/gateway/src/trusted-authority-only-create-executor.ts";
import {TrustedGatewayGiteaCreateEvidencePublisher,
 AuthenticatedGiteaCreateCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-create-evidence.ts";
import {TrustedAuthorityOnlyCreateEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-create-effect-stager.ts";
import {IsolatedDockerRunnerExecutor}
 from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {DurableAuthorityOnlyTaskFenceJournal}
 from "../src/trusted-authority-only-task-fence-journal.ts";

import {TrustedEffectStagingTaskRegistry}
 from "../../agent-runtime/src/trusted-effect-staging-task-registry.ts";
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
const testDid=process.env.ADAPTER_ID_TEST;
assert.match(engineerDid??"",/^did:/u);
for(const role of ["BACKEND","FRONTEND","TEST"])
 assert.match(process.env["ADAPTER_ID_"+role]??"",/^did:ethr:/u);
assert.match(testDid??"",/^did:/u);
assert.notEqual(testDid,process.env.ADAPTER_ID_BACKEND,
 "Test Child must never bind the Backend DID");
const sessionId="r395-authority-native-e2e";
class ScriptedCreate extends BaseLlm {
 constructor(branch,path,content){
  super({model:"r395-local-adk-create-no-paid-inference"});
  this.branch=branch;this.path=path;this.content=content;
  this.requests=[];
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const turn=this.requests.length;
  if(turn===1){
   yield {content:{role:"model",parts:[{functionCall:{
    name:"create_file",id:"r395-create",args:{
     branch:this.branch,path:this.path,content:this.content
    }
   }}]}};
  }else if(turn===2){
   // Actual ADK FunctionResponse from the native Gitea Gateway must be
   // present before the scripted agent is allowed to claim completion.
   const observed=JSON.stringify(request);
   if(!observed.includes("create_file")||
      !observed.includes("commit_sha")||
      !observed.includes("blob_sha"))
    throw Error("R395 scripted ADK did not see actual Gateway CREATE result");
   yield {content:{role:"model",parts:[{
    text:"Authorized CREATE_FILE returned a native Gateway CAS receipt"
   }]}};
  }else{
   throw Error("R395 unexpected ADK turn after one-effect Task");
  }
 }
 connect(){return Promise.reject(Error("Paid model connections disabled in R395"));}
}
class ScriptedRunner extends BaseLlm{
 constructor(branch){
  super({model:"r395-free-scripted-a2a-runner"});
  this.branch=branch;this.requests=[];
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const turn=this.requests.length;
  if(turn===1){
   yield {content:{role:"model",parts:[{functionCall:{
    name:"run_tests",id:"r395-runner",args:{
     branch:this.branch,profile:"poc-default"
    }
   }}]}};
  }else if(turn===2){
   const observed=JSON.stringify(request);
   if(!observed.includes("run_tests")||
      !observed.includes("tested_commit_sha")||
      !observed.includes("researcher_acceptance"))
    throw Error("R395 ADK Runner did not observe authenticated Gateway result");
   yield {content:{role:"model",parts:[{
    text:"Native Runner completed after independently attested Gateway result"
   }]}};
  }else{
   throw Error("R395 scripted Runner exceeded one signed Task");
  }
 }
 connect(){return Promise.reject(Error("Paid model inference forbidden in R395"));}
}
class PassiveRoleModel extends BaseLlm{
 constructor(role){super({model:"r395-offline-passive-"+role});}
 async *generateContentAsync(){
  throw Error("R395 no model inference for an idle worker");
 }
 connect(){return Promise.reject(Error("R395 no live model connection"));}
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
 async createFileWithHeadCas(input){gatewayCasWrites++;return super.createFileWithHeadCas(input);}
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
const mutationPath="tests/backend/authority-r395-created.test.ts";
const newContent="import { expect, test } from 'vitest';\ntest('signed Test Agent creates a scoped test source', () => { expect(2 + 2).toBe(4); });\n";
// CI owner stages a finished REFERENCE on the disposable feature branch
// before Engineer approval; never represents generated agent implementation.
const researcherReference=await stageDisposableAccountSuspensionReference({
 gitea:client,branch
});
assert.equal(researcherReference.engineer_approved,false);
assert.equal(researcherReference.delegated_agent_writes,0);
const baseRevision=researcherReference.base_revision;
const mainBefore=(await client.getBranchMetadata("main")).commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
// A CREATE is valid only when absent at the exact root-approved HEAD.
await assert.rejects(
 independentClient.readTextFile(branch,mutationPath,baseRevision),
 ProviderNotFoundError
);
const requirement="R395 disposable Engineer approval for native Account Suspension CREATE";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermission={
 resource:resourcePrefix+"/directories/tests/backend",operation:"create_file"
};
const taskPermission={
 resource:resourcePrefix+"/files/"+mutationPath,operation:"create_file"
};
const runnerPermission={resource:resourcePrefix,operation:"run_tests"};
const grantPermissions=[runnerPermission,grantPermission],taskPermissions=[taskPermission];
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r395-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r395-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["runner-mutation-intents","runner-receipts","runner-intents","approvals","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents","flights","intent","receipts"];
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
  statusListCredential:"https://status.example/r395"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r395:preliminary",29101,360);
 const operational=params("urn:r395:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,grantPermissions);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{test:{
   did:testDid,card_ref:"trusted:r395-test",
   capabilities:["create_file","run_tests"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r395-test-create-task",runtimeTaskId="dispatch_"+"R".repeat(22);
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"test",depends_on:[],permissions:taskPermissions
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
  params("urn:r395:child:test",29103,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 assert.deepEqual(child.permissions,taskPermissions);
 assert.deepEqual(approved.permissions,grantPermissions);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const runnerObserver=new AuthenticatedRunnerCompletionObserver({
  directory:path("runner-receipts"),key:evidenceKey,
  giteaClient:independentClient,repository:"thesis/iam-console-poc",branch,nowMs
 });
 const createCompletionObserver=new AuthenticatedGiteaCreateCompletionObserver({
  directory:path("receipts"),key:evidenceKey,repository:"thesis/iam-console-poc",
  branch,independentGiteaClient:independentClient,nowMs
 });
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:e=>e.task_id==="r395-test-runner-task"
    ?runnerObserver.observe(e):createCompletionObserver.observe(e)
  }),
  nowMs
 });
 await gate.activate(sessionId,baseRevision);
 await gate.bindTrustedTask(taskId,runtimeTaskId,"test");
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
 const journal=new DurableAuthorityOnlyGiteaCreateIntentJournal(path("intent"));
 const preflight=new TrustedAuthorityOnlyGiteaCreatePreflight({
  admissions:gate,giteaClient:client,journal,repository:"thesis/iam-console-poc",
  branch,nowMs
 });
 const observer=new AuthenticatedGiteaCreateCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,independentGiteaClient:independentClient,nowMs
 });
 const createExecutor=new TrustedAuthorityOnlyGiteaCreateExecutor({
  admissions:gate,preflight,journal,giteaClient:client,
  publisher:new TrustedGatewayGiteaCreateEvidencePublisher({
   directory:path("receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
  }),observer,repository:"thesis/iam-console-poc",branch
 });
 const native=new TrustedAuthorityOnlyCreateEffectStager({
  store,admissions:gate,preflight,giteaClient:client,
  repository:"thesis/iam-console-poc",branch,
  planTaskId:taskId,runtimeTaskId,expectedHeadSha:baseRevision
 });
 assert.equal(native.stagedTool,"create_file");
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,
  authorityOnlyCreateEnabled:true,
  authorityOnlyCreateExecutor:createExecutor
 };
 const prepare=()=>prepareAuthorization({
  task_id:runtimeTaskId,agent_role:"test",tool:"create_file",
  arguments:{branch,path:mutationPath,content:newContent}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const sign=async(prepared,permission)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.test,timeoutMs:60000
  },"create_presentation",{
   credential_id:child.credential_id,disclosed_permissions:[permission],
   audience:prepared.audience,challenge:prepared.challenge
  });
  assert.equal(typeof signed.signed_vp,"string");
  return signed.signed_vp;
 };
 // The owner creates a REAL privileged staging server. The Agent hosts
 // their own bind server and trusted registry; nothing comes from A2A data.
 const stageSecret=path("stage-secret.hex"),bindSecret=path("bind-secret.hex");
 for(const secretFile of [stageSecret,bindSecret])
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
   {mode:0o600,flag:"wx"});
 const stageSocket=path("owner-stage.sock"),bindSocket=path("agent-bind.sock");
 const agentRegistry=new TrustedEffectStagingTaskRegistry();
 const stageClient=await connectTrustedOwnerEffectStagingClient({
  socketPath:stageSocket,secretFile:stageSecret
 });
 const bindingServer=await createTrustedEffectAgentBindingServer({
  socketPath:bindSocket,secretFile:bindSecret,
  registry:agentRegistry,ownerStageClient:stageClient,expectedRole:"test"
 });
 const roleServers=[],urls={},prepared=[],events=[];
 const model=new ScriptedCreate(branch,mutationPath,newContent);
 let owner;
 try{
  await bindingServer.start();
  const gatewayTransport=async(url,init)=>{
   const body=JSON.parse(String(init?.body));
   if(String(url).endsWith("/v1/authorization/prepare")){
    const response=prepareAuthorization(body,{
     audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo
    },{store,audit,authorityOnlyAdmissions:gate,nowMs});
    prepared.push({tool:body.tool,response});
    events.push("prepare_"+body.tool);
    return Response.json(response,{status:201});
   }
   if(String(url).endsWith("/v1/authorization/execute")){
    const record=store.get(body.request_id);
    const tool=record?.request?.tool;
    if(tool!=="create_file")
     throw Error("unrecognized signed Gateway Task operation");
    events.push("execute_"+tool);
    try{
     return Response.json(await executeAuthorization(body,deps),{status:200});
    }catch(error){
     // Log class only; no provider source, credentials or signed VP.
     process.stderr.write("R395 native Gateway rejected "+tool+": "+
      (error?.constructor?.name??"UnknownError")+"\n");
     return Response.json({error:"native_authorization_rejected"},{status:403});
    }
   }
   throw Error("unexpected native Gateway transport route");
  };
  const roles=["backend","frontend","test"];
  // The original owner verifies ALL THREE live Agent Cards, including
  // the true Rust EVM signer DID for idle Backend/Frontend roles. Never expose
  // static demonstration DIDs or omit MCP pinning on those A2A hosts.
  for(const role of roles){
   const roleDid=process.env["ADAPTER_ID_"+role.toUpperCase()];
   assert.match(roleDid??"",/^did:ethr:/u);
   const keys=generateKeyPairSync("ed25519");
   const options={
    role,host:"127.0.0.1",port:await freeRolePort(),
    capabilityProfile:"approved-plan",delegatedAuthorization:true,
    nativeSignerDid:roleDid,
    mcpTaskSigning:{
     signingPrivateKeyPem:keys.privateKey.export({
      type:"pkcs8",format:"pem"
     }).toString(),
     signingPublicKeyPem:keys.publicKey.export({
      type:"spki",format:"pem"
     }).toString()
    },
    adk:{
     model:role==="test"?model:new PassiveRoleModel(role),
     gatewayBaseUrl:"http://gateway.fixture.invalid",
     adapterToken:tokens[role],maxModelTurns:4,
     maxModelCallMs:15000,gatewayTimeoutMs:60000,
     scopeModelPaths:true,
     trustedEffectTaskRegistry:role==="test"
      ?agentRegistry:new TrustedEffectStagingTaskRegistry(),
     fetchFn:gatewayTransport
    }
   };
   const server=await startSpecializedAgentServer(options);
   roleServers.push(server);urls[role]=server.baseUrl;
   assert.equal(server.card.capabilities.extensions[0].params.agentDid,roleDid);
  }
  owner=await startTrustedAuthorityOnlySdkA2AOwner({
   coordinator,childIssuer:issuer,gateway:gate,
   stageSocketPath:stageSocket,stageSecretFile:stageSecret,
   agentBindingSocketPath:bindSocket,agentBindingSecretFile:bindSecret,
   agentBaseUrls:urls,
   a2aPolling:{deadlineMs:120000,initialIntervalMs:40,maxIntervalMs:250}
  });
  assert.equal(model.requests.length,0);
  assert.equal(gatewayCasWrites,0);
  await assert.rejects(
   independentClient.readTextFile(branch,mutationPath,baseRevision),
   ProviderNotFoundError
  );
  // Only the genuine owner has the native Child and may bind then dispatch
  // via SDK A2A. Model text cannot bind a Task or stage a second operation.
  // Verify exact signed leaf denies application, acceptance and sibling test paths
   // before the first native provider CREATE effect.
   for(const deniedPath of [
    "apps/backend/src/unauthorized.test.ts",
    "tests/acceptance/unsafe.test.ts",
    "tests/backend/runner-config.ts",
    "tests/backend/other.test.ts"
   ]){
    assert.throws(()=>gate.preflightCanonicalRequest({
     task_id:runtimeTaskId,agent_role:"test",tool:"create_file",
     arguments:{branch,path:deniedPath,content:newContent}
    }),/not in exact signed Task grant/u);
   }
   assert.equal(gatewayCasWrites,0);
   const report=await owner.dispatchIssuedTask({
   taskId,runtimeTaskId,
   instruction:"Create one approved tests/backend/*.test.ts source in a signed Test-only CREATE Task",
   effectStager:native
  });
  assert.equal(report.status,"a2a_report_not_gateway_completed");
  assert.equal(report.provider_completion_attested,false);
  assert.equal(report.role,"test");
  assert.deepEqual(report.artifact.files_created,[mutationPath]);
  assert.deepEqual(report.artifact.files_modified,[]);
  assert.equal(report.artifact.commit_sha!==null,true);
  assert.equal(model.requests.length,2);
  assert.equal(gatewayCasWrites,1);
  assert.equal(legacyWriteCalls,0);
  // Critical trust boundary: an SDK A2A "COMPLETED" is NOT authoritative
  // task completion. Only the independently observed Gitea MAC below
  // may advance this original Gateway Task.
  assert.equal(gate.stagedCompletedTaskCount,0);
  const exactRecord=store.get(prepared[0]?.response?.request_id);
  assert.ok(exactRecord);
  const intent=preflight.getReservedIntent(exactRecord);
  assert.equal(intent.expected_head_sha,baseRevision);
  assert.equal(intent.old_path_absent_at_pinned_head,true);
  assert.equal("previous_blob_sha" in intent,false);
  // Independently re-verify the actual ORIGINAL native Child/VP
  // against Rust/EVM before asking the receipt observer to inspect Gitea.
  // Do not synthesize a VerifiedDelegation or trust an A2A status flag.
  const exactChallenge=prepared[0].response;
  const actualVp=await sign(exactChallenge,taskPermission);
  const verified=await verifier.verify({
   presenter:"test",audience:exactChallenge.audience,
   challenge:exactChallenge.challenge,
   required_permission:taskPermission,signed_vp:actualVp
  });
  assert.equal(verified.credential_id,child.credential_id);
  assert.equal(verified.root_credential_id,operational.credential_id);
  const independentlyObserved=await observer.observe(
   gate.assertTrustedCreateNativeAdmissionBinding(exactRecord,verified)
  );
  assert.equal(independentlyObserved.status,"owner_verified_provider_result");
  assert.equal((await independentClient.readTextFile(
   branch,mutationPath,report.artifact.commit_sha)).content,newContent);
  await assert.rejects(
   independentClient.readTextFile(branch,mutationPath,baseRevision),
   ProviderNotFoundError
  );
  assert.deepEqual(prepared.map(p=>p.tool),["create_file"]);
  // CREATE deliberately has NO UPDATE-like old-blob/pinned_revision
  // property in Prepare. Its pinned HEAD and old-file absence are
  // asserted in the original O_EXCL/fsync CREATE intent above.
  assert.equal(preflight.getReservedIntent(exactRecord).expected_head_sha,
   baseRevision);
  assert.deepEqual(events,["prepare_create_file","execute_create_file"]);
  // An A2A-completed report is not permission to dispatch the next Task.
  const confirmed=await owner.attestIndependentGatewayCompletion(
   taskId,runtimeTaskId
  );
  assert.equal(confirmed.status,"owner_gateway_completion_independently_observed");
  assert.equal(confirmed.gateway_execution_authorized,false);
  assert.equal(gate.stagedCompletedTaskCount,1);
  await assert.rejects(owner.attestIndependentGatewayCompletion(
   taskId,runtimeTaskId),/closed or repeated independent completion/u);
  assert.equal((await client.getBranchMetadata(branch)).commit_sha,
   report.artifact.commit_sha);
  assert.equal((await client.getBranchMetadata("main")).commit_sha,mainBefore);
  assert.equal(gatewayCasWrites,1);
  // No second provider operation, including reuse of the original signed VP.
  await assert.rejects(executeAuthorization({
   request_id:exactChallenge.request_id,signed_vp:actualVp
  },deps),error=>error?.code==="replay_detected");
  assert.equal(gatewayCasWrites,1);
  const prompts=JSON.stringify(model.requests);
  for(const forbidden of [
   tokens.test,child.credential_id,operational.credential_id,
   process.env.ADAPTER_EVM_PRIVATE_KEY_TEST
  ].filter(Boolean))
   assert.equal(prompts.includes(forbidden),false);
 }finally{
  const results=await Promise.allSettled([
   owner?.close(),bindingServer.close(),
   ...roleServers.reverse().map(s=>s.close())
  ]);
  for(const result of results)
   if(result.status==="rejected")throw result.reason;
 }
 // Researcher-owned Docker validation of exact, newly created test source.
 // Not a signed/delegated run_tests Task. Acceptance is intentionally not
 // invoked: the imported unsolved baseline lacks Account Suspension.
 const createdHead=(await independentClient.getBranchMetadata(branch)).commit_sha;
 assert.notEqual(createdHead,mainBefore);
 assert.equal((await independentClient.readTextFile(
  branch,mutationPath,createdHead)).content,newContent);
 const docker=new IsolatedDockerRunnerExecutor({
  gitea_base_url:process.env.GITEA_RUNNER_BASE_URL,
  gitea_owner:"thesis",gitea_repository:"iam-console-poc",
  gitea_token:process.env.GITEA_RUNNER_TOKEN,
  docker_image:"node:22.15.0-bookworm",
  phase_timeout_ms:600000,total_timeout_ms:840000,
  log_dir:path("docker-project-logs"),acceptance_enabled:true,
  acceptance_dir:fileURLToPath(new URL("../../../runner/acceptance/",import.meta.url))
 });
 const dockerResult=await docker.run({
  request_id:"r395-researcher-"+randomBytes(8).toString("hex"),
  repository:"gitea://gitea.local/thesis/iam-console-poc",
  branch,commit_sha:createdHead,profile:"poc-default"
 });
 assert.equal(dockerResult.tested_commit_sha,createdHead);
 assert.equal(dockerResult.branch,branch);
 assert.equal(dockerResult.project_tests?.status,"pass",
  JSON.stringify(dockerResult.project_tests?.phases??[]));
 assert.equal(dockerResult.status,"pass");
 assert.equal(dockerResult.researcher_acceptance?.status,"pass");
 assert.equal((await independentClient.getBranchMetadata("main")).commit_sha,mainBefore);
 process.stdout.write(JSON.stringify({
  event:"r395_exact_head_researcher_docker_project_tests",
  created_test_path:mutationPath,verified_tested_head:true,
  project_tests:dockerResult.project_tests.status,
  researcher_acceptance:"pass",signed_run_tests_child:false,
  paid_model_calls:0
 })+"\n");
 // R395: a SECOND, separately signed native Test Child is issued only
 // AFTER the independent CREATE MAC advanced the original Gateway task.
 // It receives run_tests at the feature branch (no CREATE permission).
 // The independent researcher Docker PASS above is NOT falsely claimed
 // to be a run_tests execution/receipt by this new Child.
 const runnerTaskId="r395-test-runner-task";
 const runnerRuntimeId="dispatch_"+"T".repeat(22);
 const runnerRow=await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:runnerTaskId,epoch:2,
  agent_id:"test",depends_on:[taskId],permissions:[runnerPermission]
 });
 assert.deepEqual(runnerRow.depends_on,[taskId]);
 assert.deepEqual(runnerRow.permissions,[runnerPermission]);
 // Runner Child starts NOW, not at the pre-Docker approval timestamp.
 // Its expiration must sit strictly inside the existing Engineer root.
 const rootRemainingSeconds=Math.floor(
  (Date.parse(issuedAt)+operational.validity_seconds*1000-Date.now())/1000)-30;
 assert.ok(rootRemainingSeconds>0,"operational root expired before runner issuance");
 const runnerValidFrom=new Date().toISOString().replace(/\.\d{3}Z$/u,"Z");
 const runnerChild=await issuer.issueForRegisteredTask(runnerTaskId,{
  ...params("urn:r395:child:runner",29104,
   Math.min(600,rootRemainingSeconds)),
  valid_from:runnerValidFrom
 });
 assert.notEqual(runnerChild.credential_id,child.credential_id);
 assert.deepEqual(runnerChild.permissions,[runnerPermission]);
 assert.equal(runnerChild.root_credential_id,operational.credential_id);
 await gate.bindTrustedTask(runnerTaskId,runnerRuntimeId,"test");
 const runnerEnrolled=await gate.enrollTrustedIssuedChild(
  runnerTaskId,runnerRuntimeId,issuer);
 assert.equal(runnerEnrolled.credential_id,runnerChild.credential_id);
 const runnerPrepared=prepareAuthorization({
  task_id:runnerRuntimeId,agent_role:"test",tool:"run_tests",
  arguments:{branch,profile:"poc-default"}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,
    repository:repo},{store,audit,authorityOnlyAdmissions:gate,nowMs});
 assert.deepEqual(runnerPrepared.required_permission,runnerPermission);
 const runnerRecord=store.get(runnerPrepared.request_id);
 assert.ok(runnerRecord);
 const runnerJournal=new DurableAuthorityOnlyRunnerIntentJournal(path("runner-intents"));
 const runnerPreflight=new TrustedAuthorityOnlyRunnerPreflight({
  admissions:gate,giteaClient:client,
  journal:runnerJournal,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const runnerStaged=await runnerPreflight.stageRunner(
  runnerRecord,createdHead);
 assert.equal(runnerStaged.intent.expected_head_sha,createdHead);
 assert.equal(runnerStaged.intent.credential_id,runnerChild.credential_id);
 assert.equal(runnerStaged.runner_execution_authorized,false);
 const flight=await gate.stageTrustedTaskFlight(runnerRecord);
 assert.equal(flight.status,"task_flight_reserved_no_provider_execution");
 const runnerPresentation=await invokeNativeCrypto({
  socketPath,token:tokens.test,timeoutMs:60000
 },"create_presentation",{
  credential_id:runnerChild.credential_id,
  disclosed_permissions:[runnerPermission],
  audience:runnerPrepared.audience,challenge:runnerPrepared.challenge
 });
 assert.equal(typeof runnerPresentation.signed_vp,"string");
 const runnerVerified=await verifier.verify({
  presenter:"test",audience:runnerPrepared.audience,
  challenge:runnerPrepared.challenge,
  required_permission:runnerPermission,
  signed_vp:runnerPresentation.signed_vp
 });
 assert.equal(runnerVerified.credential_id,runnerChild.credential_id);
 assert.equal(runnerVerified.root_credential_id,operational.credential_id);
 assert.deepEqual(runnerVerified.permissions,[runnerPermission]);
 const runnerPolicy=await policy.evaluate(
  buildPolicyInput(runnerRecord,repo,runnerVerified));
 assert.equal(runnerPolicy.allow,true);
 assert.equal(gate.stagedCompletedTaskCount,1,
  "Runner has no completed Task without its own independent PASS receipt");
 // R395: actual authenticated Runner HTTP, exact second native Test Child,
 // original Gateway Execute -> Docker with researcher acceptance -> private
 // MAC+two independent Gitea HEAD observations -> Gateway task completion.
 // The Runner service is a disposable local CI process, not a model tool.
 const runnerBearer=randomBytes(32).toString("hex");
 const runnerController=new IsolatedDockerRunnerExecutor({
  gitea_base_url:process.env.GITEA_RUNNER_BASE_URL,
  gitea_owner:"thesis",gitea_repository:"iam-console-poc",
  gitea_token:process.env.GITEA_RUNNER_TOKEN,
  docker_image:"node:22.15.0-bookworm",
  phase_timeout_ms:600000,total_timeout_ms:840000,
  log_dir:path("native-runner-logs"),acceptance_enabled:true,
  acceptance_dir:fileURLToPath(new URL("../../../runner/acceptance/",import.meta.url))
 });
 const runnerServer=createRunnerHttpServer({
  bind_host:"127.0.0.1",bind_port:0,gateway_token:runnerBearer,
  contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",branch}
 },runnerController);
 await new Promise((resolve,reject)=>{
  runnerServer.once("error",reject);
  runnerServer.listen(0,"127.0.0.1",resolve);
 });
 try{
  const address=runnerServer.address();
  assert.ok(address&&typeof address!=="string");
  const runnerClient=new RunnerClient({
   baseUrl:"http://127.0.0.1:"+address.port,
   gatewayToken:runnerBearer,timeoutMs:960000
  });
  const runnerPublisher=new TrustedGatewayRunnerPassEvidencePublisher({
   directory:path("runner-receipts"),key:evidenceKey,
   runnerClient,independentGiteaClient:independentClient,
   repository:"thesis/iam-console-poc",branch,nowMs
  });
  const runnerExecutor=new TrustedAuthorityOnlyRunnerExecutor({
   admissions:gate,preflight:runnerPreflight,journal:runnerJournal,
   giteaClient:client,runnerClient,publisher:runnerPublisher,
   observer:runnerObserver,repository:"thesis/iam-console-poc",branch
  });
  Object.assign(deps,{
   authorityOnlyRunnerEnabled:true,authorityOnlyRunnerExecutor:runnerExecutor
  });
  const authorizedRunner=await executeAuthorization({
   request_id:runnerPrepared.request_id,signed_vp:runnerPresentation.signed_vp
  },deps);
  assert.equal(authorizedRunner.decision,"allow");
  assert.equal(authorizedRunner.execution.provider,"runner");
  assert.equal(authorizedRunner.execution.status,"pass");
  assert.equal(authorizedRunner.execution.tested_commit_sha,createdHead);
  assert.equal(authorizedRunner.execution.project_tests?.status,"pass");
  assert.equal(authorizedRunner.execution.researcher_acceptance?.status,"pass");
  const nativePass=await gate.attestTrustedTaskCompletion(
   runnerTaskId,runnerRuntimeId);
  assert.equal(nativePass.status,"task_completion_observed_staged");
  const independentProof=await runnerObserver.observeTestedHead({
   session_id:runnerStaged.intent.session_id,
   authority_digest:runnerStaged.intent.authority_digest,
   root_credential_id:runnerStaged.intent.root_credential_id,
   task_id:runnerTaskId,runtime_task_id:runnerRuntimeId,
   epoch:runnerStaged.intent.epoch,agent_did:runnerStaged.intent.agent_did,
   credential_id:runnerChild.credential_id,
   request_id:runnerPrepared.request_id,
   request_fingerprint:runnerRecord.request_fingerprint
  });
  assert.equal(independentProof.tested_commit_sha,createdHead);
  assert.equal(independentProof.project_tests,"pass");
  assert.equal(independentProof.researcher_acceptance,"pass");
  assert.equal(gate.stagedCompletedTaskCount,2);
  // R395: THIRD independent signed Task is invoked by the actual Test ADK
  // FunctionTool through private agent binding and A2A. This exercises the
  // remote model-facing run_tests path rather than a harness-owned call.
  const a2aRunnerTaskId="r395-test-a2a-runner-task";
  const a2aRunnerRuntimeId="dispatch_"+"U".repeat(22);
  const a2aTaskRow=await coordinator.registerTask({
   session_id:sessionId,
   requirement_sha256:createHash("sha256").update(requirement).digest("hex"),
   base_revision:baseRevision,branch,task_id:a2aRunnerTaskId,epoch:3,
   agent_id:"test",depends_on:[runnerTaskId],permissions:[runnerPermission]
  });
  assert.deepEqual(a2aTaskRow.depends_on,[runnerTaskId]);
  const a2aValidFor=Math.floor(
   (Date.parse(issuedAt)+operational.validity_seconds*1000-Date.now())/1000)-30;
  assert.ok(a2aValidFor>0,"operational Root expired before ADK Runner");
  const a2aRunnerChild=await issuer.issueForRegisteredTask(a2aRunnerTaskId,{
   ...params("urn:r395:child:a2a-runner",29105,Math.min(600,a2aValidFor)),
   valid_from:new Date().toISOString().replace(/\.\d{3}Z$/u,"Z")
  });
  assert.notEqual(a2aRunnerChild.credential_id,runnerChild.credential_id);
  assert.notEqual(a2aRunnerChild.credential_id,child.credential_id);
  assert.deepEqual(a2aRunnerChild.permissions,[runnerPermission]);
  await gate.bindTrustedTask(a2aRunnerTaskId,a2aRunnerRuntimeId,"test");
  const a2aEnrolled=await gate.enrollTrustedIssuedChild(
   a2aRunnerTaskId,a2aRunnerRuntimeId,issuer);
  assert.equal(a2aEnrolled.credential_id,a2aRunnerChild.credential_id);
  const mutationPreflight=new TrustedAuthorityOnlyGiteaMutationPreflight({
   admissions:gate,giteaClient:client,
   journal:new DurableAuthorityOnlyGiteaMutationIntentJournal(
    path("runner-mutation-intents")),
   repository:"thesis/iam-console-poc",branch,nowMs
  });
  const a2aRunnerEffect=new TrustedAuthorityOnlyEffectStager({
   store,admissions:gate,mutation:mutationPreflight,
   runner:runnerPreflight,runtimeTaskId:a2aRunnerRuntimeId,
   tool:"run_tests",expectedHeadSha:createdHead
  });
  const runnerStageSecret=path("runner-stage-secret.hex"),
   runnerBindSecret=path("runner-bind-secret.hex");
  for(const secretFile of [runnerStageSecret,runnerBindSecret])
   await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
    {mode:0o600,flag:"wx"});
  const runnerStageSocket=path("runner-owner-stage.sock"),
   runnerBindSocket=path("runner-agent-bind.sock");
  const runnerRegistry=new TrustedEffectStagingTaskRegistry();
  const runnerStageClient=await connectTrustedOwnerEffectStagingClient({
   socketPath:runnerStageSocket,secretFile:runnerStageSecret
  });
  const runnerBindingServer=await createTrustedEffectAgentBindingServer({
   socketPath:runnerBindSocket,secretFile:runnerBindSecret,
   registry:runnerRegistry,ownerStageClient:runnerStageClient,
   expectedRole:"test"
  });
  const runnerModel=new ScriptedRunner(branch);
  const runnerRoleServers=[],runnerUrls={},runnerEvents=[],runnerPrepares=[];
  let runnerA2AOwner;
  try{
   await runnerBindingServer.start();
   const transport=async(url,init)=>{
    const request=JSON.parse(String(init?.body));
    if(String(url).endsWith("/v1/authorization/prepare")){
     if(request.tool!=="run_tests")
      throw Error("signed Test Runner A2A requested an unrelated effect");
     runnerEvents.push("prepare_run_tests");
     const response=prepareAuthorization(request,{
      audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo
     },{store,audit,authorityOnlyAdmissions:gate,nowMs});
     runnerPrepares.push(response);
     return Response.json(response,{status:201});
    }
    if(String(url).endsWith("/v1/authorization/execute")){
     const pending=store.get(request.request_id);
     if(pending?.request?.tool!=="run_tests")
      throw Error("A2A Runner Gateway execute is not native run_tests");
     runnerEvents.push("execute_run_tests");
     try{
      return Response.json(await executeAuthorization(request,deps),{status:200});
     }catch(error){
      // No signed VP, source, result, token or message in CI diagnostic.
      process.stderr.write(JSON.stringify({
       event:"r395_a2a_runner_execute_denied",
       type:error?.constructor?.name??"UnknownError"
      })+"\n");
      return Response.json({error:"native_authorization_rejected"},{status:403});
     }
    }
    throw Error("unexpected signed A2A Runner Gateway route");
   };
   for(const role of ["backend","frontend","test"]){
    const roleDid=process.env["ADAPTER_ID_"+role.toUpperCase()];
    const roleKeys=generateKeyPairSync("ed25519");
    const roleServer=await startSpecializedAgentServer({
     role,host:"127.0.0.1",port:await freeRolePort(),
     capabilityProfile:"approved-plan",delegatedAuthorization:true,
     nativeSignerDid:roleDid,
     mcpTaskSigning:{
      signingPrivateKeyPem:roleKeys.privateKey.export({
       type:"pkcs8",format:"pem"
      }).toString(),
      signingPublicKeyPem:roleKeys.publicKey.export({
       type:"spki",format:"pem"
      }).toString()
     },
     adk:{
      model:role==="test"?runnerModel:new PassiveRoleModel(role),
      gatewayBaseUrl:"http://gateway.fixture.invalid",
      adapterToken:tokens[role],maxModelTurns:4,
      maxModelCallMs:15000,gatewayTimeoutMs:60000,
      scopeModelPaths:true,
      trustedEffectTaskRegistry:role==="test"
       ?runnerRegistry:new TrustedEffectStagingTaskRegistry(),
      fetchFn:transport
     }
    });
    runnerRoleServers.push(roleServer);
    runnerUrls[role]=roleServer.baseUrl;
   }
   runnerA2AOwner=await startTrustedAuthorityOnlySdkA2AOwner({
    coordinator,childIssuer:issuer,gateway:gate,
    stageSocketPath:runnerStageSocket,
    stageSecretFile:runnerStageSecret,
    agentBindingSocketPath:runnerBindSocket,
    agentBindingSecretFile:runnerBindSecret,
    agentBaseUrls:runnerUrls,
    a2aPolling:{deadlineMs:960000,initialIntervalMs:50,maxIntervalMs:1000}
   });
   const a2aReport=await runnerA2AOwner.dispatchIssuedTask({
    taskId:a2aRunnerTaskId,runtimeTaskId:a2aRunnerRuntimeId,
    instruction:"Run protected native Docker+researcher acceptance at the pinned HEAD",
    effectStager:a2aRunnerEffect
   });
   assert.equal(a2aReport.status,"a2a_report_not_gateway_completed");
   assert.equal(a2aReport.role,"test");
   assert.equal(a2aReport.artifact.test_outcome,"pass");
   assert.equal(a2aReport.artifact.commit_sha,createdHead);
   assert.deepEqual(a2aReport.artifact.files_created,[]);
   assert.deepEqual(a2aReport.artifact.files_modified,[]);
   assert.equal(runnerModel.requests.length,2);
   assert.deepEqual(runnerEvents,["prepare_run_tests","execute_run_tests"]);
   assert.equal(runnerPrepares.length,1);
   assert.deepEqual(runnerPrepares[0].required_permission,runnerPermission);
   assert.equal(gate.stagedCompletedTaskCount,2,
    "model/A2A completion cannot replace independent Runner MAC receipt");
   const certified=await runnerA2AOwner.attestIndependentGatewayCompletion(
    a2aRunnerTaskId,a2aRunnerRuntimeId
   );
   assert.equal(certified.status,"owner_gateway_completion_independently_observed");
   assert.equal(gate.stagedCompletedTaskCount,3);
   const observedRunnerTask=store.get(runnerPrepares[0].request_id);
   assert.equal(runnerPreflight.getReservedIntent(observedRunnerTask)
    .expected_head_sha,createdHead);
   const runnerPrompt=JSON.stringify(runnerModel.requests);
   for(const forbidden of [
    tokens.test,a2aRunnerChild.credential_id,operational.credential_id,
    process.env.ADAPTER_EVM_PRIVATE_KEY_TEST
   ].filter(Boolean))assert.equal(runnerPrompt.includes(forbidden),false);
   process.stdout.write(JSON.stringify({
    event:"r395_native_a2a_test_runner_complete",
    signed_create_child:true,
    signed_runner_gateway_child:true,
    signed_separate_a2a_runner_child:true,
    actual_adk_function_tool_run_tests:true,
    native_rust_opa_gateway:true,
    runner_project_tests:"pass",
    runner_researcher_acceptance:"pass",
    independent_runner_receipt:true,
    created_head_pinned:true,
    authenticated_a2a_completion:true,
    paid_model_calls:0
   })+"\n");
  }finally{
   const results=await Promise.allSettled([
    runnerA2AOwner?.close(),runnerBindingServer.close(),
    ...runnerRoleServers.reverse().map(s=>s.close())
   ]);
   for(const result of results)
    if(result.status==="rejected")throw result.reason;
  }
  await assert.rejects(executeAuthorization({
   request_id:runnerPrepared.request_id,signed_vp:runnerPresentation.signed_vp
  },deps),error=>error?.code==="replay_detected");
 }finally{
  await new Promise((resolve,reject)=>runnerServer.close(err=>err?reject(err):resolve()));
 }
 assert.equal((await independentClient.getBranchMetadata(branch)).commit_sha,
  createdHead);
 assert.equal((await independentClient.getBranchMetadata("main")).commit_sha,
  mainBefore);
 process.stdout.write(JSON.stringify({
  event:"r395_signed_separate_test_runner_child_preflight",
  create_task_completed:true,
  independent_rust_runner_child:true,
  runner_depends_on_create:true,
  original_runner_head_pinned:true,
  runner_opa_allow:true,
  protected_runner_invoked:true,
  protected_runner_pass_attested:true,
  independent_researcher_project_tests:"pass",
  researcher_acceptance:"pass",
  paid_model_calls:0
 })+"\n");
 // Fresh prepared VP is revoked on-chain before reaching the effect boundary.
 const pending=prepare(),pendingVp=await sign(pending,taskPermission);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"test",audience:pending.audience,challenge:pending.challenge,
  required_permission:taskPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(gatewayCasWrites,1);
 assert.equal((await client.getBranchMetadata("main")).commit_sha,mainBefore);
 process.stdout.write(JSON.stringify({
  event:"r395_native_sdk_a2a_adk_atomic_create",
  engineer_directory_scope:true,task_leaf_permission:true,
  native_engineer_root:true,native_child_ipc:true,
  independently_verified_rust_evm:true,real_opa:true,
  independent_create_receipt_attested:true,task_finalized:true,
  actual_agent_gateway_client:true,real_hmac_owner_and_agent_ipc:true,
  prebound_coordinator_and_native_child:true,remote_a2a_transport:true,
  google_adk_scripted_model:true,task_local_crypto_mcp:true,
  original_parent_absence_verified:true,revoked_root_denied:true,
  gateway_atomic_create_calls:gatewayCasWrites,
  legacy_writes:legacyWriteCalls,paid_model_calls:0
 })+"\n");
}finally{
 await rm(parent,{recursive:true,force:true});
}
