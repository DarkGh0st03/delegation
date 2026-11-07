/** R384.2 — ONE DISPOSABLE, COMPLETE native CREATE_FILE chain:
 * original Engineer root -> true Rust/EVM Child -> original Coordinator
 * -> owner-private HMAC Unix -> SDK A2A HTTP -> Google ADK FunctionTool
 * -> Task-local cryptographic MCP (real native Rust VP) -> native Gateway
 * -> OPA -> real Gitea atomic CREATE HEAD CAS -> independently MAC
 * verified receipt -> original Gateway/owner Task completion.
 * No paid inference, no production credentials, no main commits.
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
import {ProviderNotFoundError} from "../../../apps/gateway/src/errors.ts";
import {TrustedAuthorityOnlyGiteaCreatePreflight} from "../../../apps/gateway/src/trusted-authority-only-create-preflight.ts";
import {DurableAuthorityOnlyGiteaCreateIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-create-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaCreateExecutor} from "../../../apps/gateway/src/trusted-authority-only-create-executor.ts";
import {TrustedGatewayGiteaCreateEvidencePublisher,
 AuthenticatedGiteaCreateCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-create-evidence.ts";
import {TrustedAuthorityOnlyCreateEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-create-effect-stager.ts";
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
const backendDid=process.env.ADAPTER_ID_BACKEND;
assert.match(engineerDid??"",/^did:/u);
for(const role of ["BACKEND","FRONTEND","TEST"])
 assert.match(process.env["ADAPTER_ID_"+role]??"",/^did:ethr:/u);
assert.match(backendDid??"",/^did:/u);
const sessionId="r3842-authority-native-e2e";
class ScriptedCreate extends BaseLlm {
 constructor(branch,path,content){
  super({model:"r3842-local-adk-create-no-paid-inference"});
  this.branch=branch;this.path=path;this.content=content;
  this.requests=[];
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const turn=this.requests.length;
  if(turn===1){
   yield {content:{role:"model",parts:[{functionCall:{
    name:"create_file",id:"r3842-create",args:{
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
    throw Error("R384.2 scripted ADK did not see actual Gateway CREATE result");
   yield {content:{role:"model",parts:[{
    text:"Authorized CREATE_FILE returned a native Gateway CAS receipt"
   }]}};
  }else{
   throw Error("R384.2 unexpected ADK turn after one-effect Task");
  }
 }
 connect(){return Promise.reject(Error("Paid model connections disabled in R384.2"));}
}
class PassiveRoleModel extends BaseLlm{
 constructor(role){super({model:"r3842-offline-passive-"+role});}
 async *generateContentAsync(){
  throw Error("R384.2 no model inference for an idle worker");
 }
 connect(){return Promise.reject(Error("R384.2 no live model connection"));}
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
const mutationPath="apps/backend/users/account-suspension-created.ts";
const newContent="export const accountSuspended = true;\n";
const baseRevision=created.commit_sha;
const mainBefore=(await client.getBranchMetadata("main")).commit_sha;
assert.match(baseRevision,/^[a-f0-9]{40}$/u);
assert.equal((await client.getBranchMetadata(branch)).commit_sha,baseRevision);
// A CREATE is valid only when absent at the exact root-approved HEAD.
await assert.rejects(
 independentClient.readTextFile(branch,mutationPath,baseRevision),
 ProviderNotFoundError
);
const requirement="R384.2 disposable Engineer approval for native Account Suspension CREATE";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const grantPermission={
 resource:resourcePrefix+"/directories/apps/backend",operation:"create_file"
};
const taskPermission={
 resource:resourcePrefix+"/files/"+mutationPath,operation:"create_file"
};
const grantPermissions=[grantPermission],taskPermissions=[taskPermission];
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r3842-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r3842-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","root-journal","coordinator-tasks","gateway-tasks",
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
  statusListCredential:"https://status.example/r3842"});
 const params=(id,index,duration)=>({
  credential_id:id,valid_from:issuedAt,validity_seconds:duration,
  credential_status:status(index)
 });
 const preliminary=params("urn:r3842:preliminary",29101,360);
 const operational=params("urn:r3842:operational",29102,1800);
 await session.startPlanning(preliminary);
 const approved=await session.approveAndIssueOperationalRoot(operational);
 assert.equal(approved.phase,"operational");
 assert.deepEqual(approved.permissions,grantPermissions);
 const coordinator=new TrustedAuthorityOnlyExecutionCoordinator({
  sessionId,engineer:session,approvals,
  journal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
  trustedAgentRegistry:{backend:{
   did:backendDid,card_ref:"trusted:r3842-backend",
   capabilities:["create_file"]
  }},nowMs
 });
 await coordinator.activate();
 const taskId="r3842-backend-task",runtimeTaskId="dispatch_"+"R".repeat(22);
 await coordinator.registerTask({
  session_id:sessionId,requirement_sha256:createHash("sha256")
   .update(requirement).digest("hex"),
  base_revision:baseRevision,branch,task_id:taskId,epoch:1,
  agent_id:"backend",depends_on:[],permissions:taskPermissions
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
  params("urn:r3842:child:backend",29103,600));
 assert.equal(child.gateway_execution_authorized,false);
 assert.equal(child.root_credential_id,operational.credential_id);
 assert.deepEqual(child.permissions,taskPermissions);
 assert.deepEqual(approved.permissions,grantPermissions);
 const evidenceKey=Buffer.alloc(32,96); // disposable CI receipt key
 const gate=new TrustedAuthorityOnlyGatewayAdmissions({
  repository:repo,engineerDid,coordinator,approvals,
  operationalSessionStore:new TrustedOperationalSessionStore(
   path("gateway-activation")),
  taskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
  childJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
  effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
  completionObserver:new AuthenticatedGiteaCreateCompletionObserver({
   directory:path("receipts"),key:evidenceKey,repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
  }).toTrustedObserver(),
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
  task_id:runtimeTaskId,agent_role:"backend",tool:"create_file",
  arguments:{branch,path:mutationPath,content:newContent}
 },{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
 {store,audit,authorityOnlyAdmissions:gate,nowMs});
 const sign=async(prepared,permission)=>{
  const signed=await invokeNativeCrypto({
   socketPath,token:tokens.backend,timeoutMs:60000
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
  registry:agentRegistry,ownerStageClient:stageClient,expectedRole:"backend"
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
     process.stderr.write("R384.2 native Gateway rejected "+tool+": "+
      (error?.constructor?.name??"UnknownError")+"\n");
     return Response.json({error:"native_authorization_rejected"},{status:403});
    }
   }
   throw Error("unexpected native Gateway transport route");
  };
  const roles=["backend","frontend","test"];
  // The original owner verifies ALL THREE live Agent Cards, including
  // the true Rust EVM signer DID for idle Frontend/Test roles. Never expose
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
     model:role==="backend"?model:new PassiveRoleModel(role),
     gatewayBaseUrl:"http://gateway.fixture.invalid",
     adapterToken:tokens[role],maxModelTurns:4,
     maxModelCallMs:15000,gatewayTimeoutMs:60000,
     scopeModelPaths:true,
     trustedEffectTaskRegistry:role==="backend"
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
  const report=await owner.dispatchIssuedTask({
   taskId,runtimeTaskId,
   instruction:"Create the one approved new Backend Account Suspension source",
   effectStager:native
  });
  assert.equal(report.status,"a2a_report_not_gateway_completed");
  assert.equal(report.provider_completion_attested,false);
  assert.equal(report.role,"backend");
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
   presenter:"backend",audience:exactChallenge.audience,
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
  assert.equal(store.get(prepared[0].response.request_id).pinned_revision,
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
   tokens.backend,child.credential_id,operational.credential_id,
   process.env.ADAPTER_EVM_PRIVATE_KEY_BACKEND
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
 // Fresh prepared VP is revoked on-chain before reaching the effect boundary.
 const pending=prepare(),pendingVp=await sign(pending,taskPermission);
 await credentialPort.revokeRoot(operational.credential_id);
 await assert.rejects(()=>verifier.verify({
  presenter:"backend",audience:pending.audience,challenge:pending.challenge,
  required_permission:taskPermission,signed_vp:pendingVp
 }));
 await assert.rejects(executeAuthorization({
  request_id:pending.request_id,signed_vp:pendingVp
 },deps),error=>error?.code==="verification_rejected");
 assert.equal(gatewayCasWrites,1);
 assert.equal((await client.getBranchMetadata("main")).commit_sha,mainBefore);
 process.stdout.write(JSON.stringify({
  event:"r3842_native_sdk_a2a_adk_atomic_create",
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
